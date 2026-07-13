import path from "node:path";
import fs from "node:fs/promises";

import { app, utilityProcess, type UtilityProcess } from "electron";

import {
  RUNTIME_LIMITS,
  validateNativeDiscovery,
  type HostEnvelope,
  type NativeDiscovery,
} from "@aigc-proof/host-contracts";
import {
  UTILITY_PROTOCOL_VERSION,
  utilityToMainMessageSchema,
  type UtilityJob,
} from "../shared/utility-protocol";

export interface UtilityHealth {
  state: "starting" | "healthy" | "restarting" | "stopped" | "failed";
  generation: number;
  processId?: number;
  lastFailureCode?: string;
}

interface PendingExecution {
  resolve: (value: HostEnvelope<unknown>) => void;
  timer: NodeJS.Timeout;
  onProgress: (
    sequence: number,
    completedUnits: number,
    message: string,
  ) => void;
  job: UtilityJob;
  progressWindowStartedAt: number;
  progressEventsInWindow: number;
}

function utilityFailure(code: string, message: string): HostEnvelope<never> {
  return { ok: false, error: { code, kind: "utility", message } };
}

export class UtilitySupervisor {
  #child: UtilityProcess | undefined;
  #discovery: NativeDiscovery | undefined;
  #generation = 0;
  #state: UtilityHealth["state"] = "stopped";
  #lastFailureCode: string | undefined;
  #pending = new Map<string, PendingExecution>();
  #startPromise: Promise<NativeDiscovery> | undefined;
  #readyResolve: ((discovery: NativeDiscovery) => void) | undefined;
  #readyReject: ((error: Error) => void) | undefined;
  #closing = false;

  get discovery(): NativeDiscovery | undefined {
    return this.#discovery;
  }

  health(): UtilityHealth {
    return {
      state: this.#state,
      generation: this.#generation,
      ...(this.#child?.pid ? { processId: this.#child.pid } : {}),
      ...(this.#lastFailureCode
        ? { lastFailureCode: this.#lastFailureCode }
        : {}),
    };
  }

  async start(): Promise<NativeDiscovery> {
    if (this.#state === "healthy" && this.#discovery) return this.#discovery;
    if (this.#startPromise) return this.#startPromise;
    this.#closing = false;
    this.#state = this.#generation === 0 ? "starting" : "restarting";
    let handshakeTimer: NodeJS.Timeout | undefined;
    this.#startPromise = new Promise<NativeDiscovery>((resolve, reject) => {
      this.#readyResolve = resolve;
      this.#readyReject = reject;
      const child = utilityProcess.fork(
        path.join(__dirname, "../utility/utility.js"),
        [],
        {
          env: {
            ...process.env,
            AIGC_PROOF_NATIVE_PATH: this.#addonPath(),
          },
          serviceName: "AIGC-Proof Utility",
          stdio: "ignore",
        },
      );
      this.#child = child;
      child.on("message", (message: unknown) =>
        this.#handleMessage(child, message),
      );
      child.once("exit", (code) => this.#handleExit(child, code));
      handshakeTimer = setTimeout(() => {
        if (this.#child !== child || this.#state === "healthy") return;
        this.#lastFailureCode = "UTILITY_HANDSHAKE_FAILED";
        child.kill();
        this.#failStart(new Error("Utility handshake timed out."));
      }, RUNTIME_LIMITS.startupTimeoutMs);
    }).finally(() => {
      if (handshakeTimer) clearTimeout(handshakeTimer);
      this.#startPromise = undefined;
      this.#readyResolve = undefined;
      this.#readyReject = undefined;
    });
    return this.#startPromise;
  }

  async execute(
    jobId: string,
    job: UtilityJob,
    onProgress: PendingExecution["onProgress"],
  ): Promise<HostEnvelope<unknown>> {
    await this.start();
    if (!this.#child || this.#state !== "healthy") {
      return utilityFailure("UTILITY_PROCESS_LOST", "Utility is not healthy.");
    }
    if (this.#pending.size !== 0) {
      return utilityFailure(
        "JOB_TRANSITION_INVALID",
        "The single-concurrency Utility already has a running job.",
      );
    }
    const message = {
      version: UTILITY_PROTOCOL_VERSION,
      type: "execute" as const,
      jobId,
      job,
    };
    if (
      Buffer.byteLength(JSON.stringify(message), "utf8") >
      RUNTIME_LIMITS.maxMessageBytes
    ) {
      return utilityFailure(
        "UTILITY_MESSAGE_INVALID",
        "Utility request exceeded the message limit.",
      );
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#pending.delete(jobId);
        this.#lastFailureCode = "JOB_TIMEOUT";
        this.#child?.kill();
        void this.#cleanupAfterLoss(job).finally(() =>
          resolve(
            utilityFailure(
              "JOB_TIMEOUT",
              "The proof operation exceeded its timeout.",
            ),
          ),
        );
      }, RUNTIME_LIMITS.operationTimeoutMs);
      this.#pending.set(jobId, {
        resolve,
        timer,
        onProgress,
        job,
        progressWindowStartedAt: Date.now(),
        progressEventsInWindow: 0,
      });
      this.#child!.postMessage(message);
    });
  }

  async crashForQa(): Promise<void> {
    await this.start();
    this.#child?.postMessage({
      version: UTILITY_PROTOCOL_VERSION,
      type: "qa-crash",
    });
  }

  async shutdown(): Promise<void> {
    this.#closing = true;
    const child = this.#child;
    if (!child) {
      this.#state = "stopped";
      return;
    }
    await new Promise<void>((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        resolve();
      };
      child.once("exit", finish);
      child.postMessage({
        version: UTILITY_PROTOCOL_VERSION,
        type: "shutdown",
      });
      setTimeout(() => {
        if (!finished) {
          this.#lastFailureCode = "UTILITY_SHUTDOWN_TIMEOUT";
          child.kill();
          finish();
        }
      }, RUNTIME_LIMITS.shutdownTimeoutMs);
    });
    this.#state = "stopped";
  }

  #handleMessage(child: UtilityProcess, raw: unknown): void {
    if (child !== this.#child) return;
    if (
      Buffer.byteLength(JSON.stringify(raw), "utf8") >
      RUNTIME_LIMITS.maxMessageBytes
    ) {
      this.#lastFailureCode = "UTILITY_MESSAGE_INVALID";
      child.kill();
      return;
    }
    const parsed = utilityToMainMessageSchema.safeParse(raw);
    if (!parsed.success) {
      this.#lastFailureCode = "UTILITY_MESSAGE_INVALID";
      child.kill();
      this.#failStart(new Error("Utility sent a malformed message."));
      return;
    }
    const message = parsed.data;
    if (message.type === "ready") {
      try {
        this.#discovery = validateNativeDiscovery(message.discovery);
        this.#generation += 1;
        this.#state = "healthy";
        this.#lastFailureCode = undefined;
        this.#readyResolve?.(this.#discovery);
      } catch (error) {
        this.#lastFailureCode = "UTILITY_HANDSHAKE_FAILED";
        child.kill();
        this.#failStart(
          error instanceof Error
            ? error
            : new Error("Utility handshake failed."),
        );
      }
      return;
    }
    const pending = this.#pending.get(message.jobId);
    if (!pending) return;
    if (message.type === "progress") {
      const currentTime = Date.now();
      if (currentTime - pending.progressWindowStartedAt >= 1_000) {
        pending.progressWindowStartedAt = currentTime;
        pending.progressEventsInWindow = 0;
      }
      pending.progressEventsInWindow += 1;
      if (
        pending.progressEventsInWindow >
        RUNTIME_LIMITS.maxProgressEventsPerSecond
      ) {
        this.#lastFailureCode = "UTILITY_MESSAGE_INVALID";
        child.kill();
        return;
      }
      pending.onProgress(
        message.sequence,
        message.completedUnits,
        message.message,
      );
      return;
    }
    clearTimeout(pending.timer);
    this.#pending.delete(message.jobId);
    pending.resolve(message.envelope as HostEnvelope<unknown>);
  }

  #handleExit(child: UtilityProcess, code: number): void {
    if (child !== this.#child) return;
    this.#child = undefined;
    this.#discovery = undefined;
    if (!this.#closing) {
      this.#state = "failed";
      this.#lastFailureCode ??= "UTILITY_PROCESS_LOST";
    } else {
      this.#state = "stopped";
    }
    this.#failStart(
      new Error(`Utility exited before handshake with code ${code}.`),
    );
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      void this.#cleanupAfterLoss(pending.job).finally(() =>
        pending.resolve(
          utilityFailure(
            "UTILITY_PROCESS_LOST",
            `Utility exited with code ${code}; the job was not replayed.`,
          ),
        ),
      );
    }
    this.#pending.clear();
  }

  #failStart(error: Error): void {
    this.#readyReject?.(error);
  }

  #addonPath(): string {
    const override = process.env.AIGC_PROOF_NATIVE_PATH;
    if (override) return path.resolve(override);
    return app.isPackaged
      ? path.join(process.resourcesPath, "native", "proof_napi.node")
      : path.resolve(__dirname, "../../native/proof_napi.node");
  }

  async #cleanupAfterLoss(job: UtilityJob): Promise<void> {
    if (job.operation === "addAsset") {
      await this.#removeKnownTemporaryFiles(
        path.join(job.payload.workspace, "assets", job.payload.role),
        ".aigc-proof-asset-",
      );
      return;
    }
    if (job.operation === "sealPackage") {
      await this.#removeKnownTemporaryFiles(
        path.dirname(job.payload.output),
        ".aigc-proof-package-",
      );
    }
  }

  async #removeKnownTemporaryFiles(
    directory: string,
    prefix: string,
  ): Promise<void> {
    const entries = await fs
      .readdir(directory, { withFileTypes: true })
      .catch(() => []);
    await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.startsWith(prefix))
        .slice(0, 256)
        .map((entry) =>
          fs.unlink(path.join(directory, entry.name)).catch(() => undefined),
        ),
    );
  }
}
