import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  NATIVE_API_VERSION,
  NATIVE_CAPABILITIES,
  NATIVE_ENGINE_VERSION,
  PROTOCOL_VERSION,
  RUNTIME_LIMITS,
} from "@aigc-proof/host-contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

const { forkMock } = vi.hoisted(() => ({ forkMock: vi.fn() }));

vi.mock("electron", () => ({
  app: { isPackaged: false },
  utilityProcess: { fork: forkMock },
}));

import { UTILITY_PROTOCOL_VERSION } from "../shared/utility-protocol";
import { UtilitySupervisor } from "./utility-supervisor";

class FakeUtility extends EventEmitter {
  pid: number | undefined;
  readonly messages: unknown[] = [];
  readonly kill = vi.fn(() => true);

  constructor(pid: number) {
    super();
    this.pid = pid;
  }

  postMessage(message: unknown): void {
    this.messages.push(message);
  }
}

function ready(overrides: Record<string, unknown> = {}) {
  return {
    version: UTILITY_PROTOCOL_VERSION,
    type: "ready",
    nativeApiVersion: NATIVE_API_VERSION,
    discovery: {
      apiVersion: NATIVE_API_VERSION,
      engineVersion: NATIVE_ENGINE_VERSION,
      supportedProtocolVersions: [PROTOCOL_VERSION],
      capabilities: [...NATIVE_CAPABILITIES],
      execution: {
        napiAsyncTasks: true,
        utilityProcessIsolation: true,
        progressStreaming: true,
        safeCancellation: false,
      },
      limits: RUNTIME_LIMITS,
      ...overrides,
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  forkMock.mockReset();
});

describe("Utility supervisor", () => {
  it("requires a compatible handshake and relays strict progress/result messages", async () => {
    const child = new FakeUtility(4101);
    forkMock.mockReturnValue(child);
    const supervisor = new UtilitySupervisor();
    const starting = supervisor.start();
    child.emit("message", ready());
    await expect(starting).resolves.toMatchObject({
      apiVersion: NATIVE_API_VERSION,
    });
    expect(supervisor.health()).toMatchObject({
      state: "healthy",
      generation: 1,
      processId: 4101,
    });

    const progress = vi.fn();
    const executing = supervisor.execute(
      `job_${"a".repeat(32)}`,
      { operation: "loadWorkspace", payload: { path: "C:\\workspace" } },
      progress,
    );
    await Promise.resolve();
    child.emit("message", {
      version: UTILITY_PROTOCOL_VERSION,
      type: "progress",
      jobId: `job_${"a".repeat(32)}`,
      sequence: 1,
      completedUnits: 35,
      message: "accepted",
    });
    child.emit("message", {
      version: UTILITY_PROTOCOL_VERSION,
      type: "result",
      jobId: `job_${"a".repeat(32)}`,
      envelope: { ok: true, data: { path: "C:\\workspace" } },
    });
    await expect(executing).resolves.toMatchObject({ ok: true });
    expect(progress).toHaveBeenCalledWith(1, 35, "accepted");
  });

  it("fails an in-flight job without replay and starts a fresh generation", async () => {
    const first = new FakeUtility(4201);
    const second = new FakeUtility(4202);
    forkMock.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const supervisor = new UtilitySupervisor();
    const starting = supervisor.start();
    first.emit("message", ready());
    await starting;
    const executing = supervisor.execute(
      `job_${"b".repeat(32)}`,
      { operation: "loadWorkspace", payload: { path: "C:\\workspace" } },
      vi.fn(),
    );
    await Promise.resolve();
    first.pid = undefined;
    first.emit("exit", 74);
    await expect(executing).resolves.toMatchObject({
      ok: false,
      error: { code: "UTILITY_PROCESS_LOST" },
    });
    expect(
      first.messages.filter((message) =>
        JSON.stringify(message).includes('"type":"execute"'),
      ),
    ).toHaveLength(1);

    const restarting = supervisor.start();
    second.emit("message", ready());
    await restarting;
    expect(supervisor.health()).toMatchObject({
      state: "healthy",
      generation: 2,
      processId: 4202,
    });
  });

  it("never deletes an initialize target after Utility loss", async () => {
    const child = new FakeUtility(4211);
    forkMock.mockReturnValue(child);
    const supervisor = new UtilitySupervisor();
    const target = await fs.mkdtemp(
      path.join(os.tmpdir(), "aigc-proof-owned-target-"),
    );
    const marker = path.join(target, "user-owned.txt");
    await fs.writeFile(marker, "preserve", "utf8");
    try {
      const starting = supervisor.start();
      child.emit("message", ready());
      await starting;
      const executing = supervisor.execute(
        `job_${"i".repeat(32)}`,
        { operation: "initializeWorkspace", payload: { path: target } },
        vi.fn(),
      );
      await Promise.resolve();
      child.pid = undefined;
      child.emit("exit", 74);
      await expect(executing).resolves.toMatchObject({
        ok: false,
        error: { code: "UTILITY_PROCESS_LOST" },
      });
      await expect(fs.readFile(marker, "utf8")).resolves.toBe("preserve");
    } finally {
      await fs.rm(target, { recursive: true, force: true });
    }
  });

  it("removes owned add-asset temporary files before reporting Utility loss", async () => {
    const child = new FakeUtility(4231);
    forkMock.mockReturnValue(child);
    const supervisor = new UtilitySupervisor();
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "aigc-proof-cleanup-"),
    );
    const assetDirectory = path.join(root, "assets", "other");
    const temporary = path.join(assetDirectory, ".aigc-proof-asset-fixture");
    await fs.mkdir(assetDirectory, { recursive: true });
    await fs.writeFile(temporary, "partial", "utf8");
    try {
      const starting = supervisor.start();
      child.emit("message", ready());
      await starting;
      const executing = supervisor.execute(
        `job_${"c".repeat(32)}`,
        {
          operation: "addAsset",
          payload: {
            workspace: root,
            source: path.join(root, "source.bin"),
            role: "other",
          },
        },
        vi.fn(),
      );
      await Promise.resolve();
      child.pid = undefined;
      child.emit("exit", 74);
      await expect(executing).resolves.toMatchObject({
        ok: false,
        error: { code: "UTILITY_PROCESS_LOST" },
      });
      await expect(fs.stat(temporary)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("kills a Utility that exceeds the bounded progress rate", async () => {
    const child = new FakeUtility(4251);
    forkMock.mockReturnValue(child);
    const supervisor = new UtilitySupervisor();
    const starting = supervisor.start();
    child.emit("message", ready());
    await starting;
    void supervisor.execute(
      `job_${"r".repeat(32)}`,
      { operation: "loadWorkspace", payload: { path: "C:\\workspace" } },
      vi.fn(),
    );
    await Promise.resolve();
    for (
      let sequence = 1;
      sequence <= RUNTIME_LIMITS.maxProgressEventsPerSecond + 1;
      sequence += 1
    ) {
      child.emit("message", {
        version: UTILITY_PROTOCOL_VERSION,
        type: "progress",
        jobId: `job_${"r".repeat(32)}`,
        sequence,
        completedUnits: sequence,
        message: "bounded progress",
      });
    }
    expect(child.kill).toHaveBeenCalled();
    expect(supervisor.health()).toMatchObject({
      lastFailureCode: "UTILITY_MESSAGE_INVALID",
    });
  });

  it("fails closed for an incompatible or timed-out handshake", async () => {
    const incompatible = new FakeUtility(4301);
    forkMock.mockReturnValueOnce(incompatible);
    const supervisor = new UtilitySupervisor();
    const refused = supervisor.start();
    incompatible.emit("message", ready({ apiVersion: "3.0.0" }));
    await expect(refused).rejects.toThrow(/incompatible/u);
    expect(incompatible.kill).toHaveBeenCalled();

    vi.useFakeTimers();
    const silent = new FakeUtility(4302);
    forkMock.mockReturnValueOnce(silent);
    const timed = supervisor.start();
    const timedExpectation = expect(timed).rejects.toThrow(/timed out/u);
    await vi.advanceTimersByTimeAsync(RUNTIME_LIMITS.startupTimeoutMs);
    await timedExpectation;
    expect(silent.kill).toHaveBeenCalled();
  });
});
