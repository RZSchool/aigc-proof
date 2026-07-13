import {
  CreationCoreError,
  REQUIRED_COMFYUI_NODE_CLASSES,
  buildComfyUiWorkflow,
  sha256,
  type CreationProvider,
  type ProviderInspection,
  type ProviderJobRequest,
  type ProviderObservation,
  type ProviderOutput,
} from "../index";

const MAX_JSON_BYTES = 8 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 100 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MIN_PROGRESS_INTERVAL_MS = 100;
const VERSION_PATTERN = /(?:^|[^0-9])(\d+\.\d+\.\d+)(?:$|[^0-9])/u;

type Fetch = typeof fetch;

export interface ComfyUiAdapterOptions {
  endpoint?: string;
  fetch?: Fetch;
  timeoutMs?: number;
  pollIntervalMs?: number;
  websocketProbe?: (url: string, signal?: AbortSignal) => Promise<void>;
  websocketFactory?: (url: string) => WebSocket;
  allowGlobalInterrupt?: boolean;
}

function fail(
  code: ConstructorParameters<typeof CreationCoreError>[0],
  message: string,
): never {
  throw new CreationCoreError(code, message);
}

function normalizedEndpoint(raw: string): URL {
  let endpoint: URL;
  try {
    endpoint = new URL(raw);
  } catch {
    return fail(
      "PROVIDER_ENDPOINT_INVALID",
      "Provider endpoint is not a valid URL.",
    );
  }
  const host = endpoint.hostname.toLowerCase();
  if (
    endpoint.protocol !== "http:" ||
    (host !== "127.0.0.1" &&
      host !== "localhost" &&
      host !== "[::1]" &&
      host !== "::1") ||
    endpoint.username ||
    endpoint.password ||
    (endpoint.pathname !== "/" && endpoint.pathname !== "") ||
    endpoint.search ||
    endpoint.hash
  ) {
    return fail(
      "PROVIDER_ENDPOINT_INVALID",
      "ComfyUI is restricted to a credential-free loopback HTTP origin.",
    );
  }
  endpoint.pathname = "/";
  return endpoint;
}

function safeOutputPath(value: string, allowEmpty = false): string {
  if ((allowEmpty && value === "") || /^[A-Za-z0-9._ -]{1,255}$/u.test(value)) {
    if (value !== "." && value !== "..") return value;
  }
  return fail(
    "PROVIDER_MALFORMED_OUTPUT",
    "Provider returned an unsafe output path component.",
  );
}

function mediaType(bytes: Uint8Array): ProviderOutput["mediaType"] {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return "image/png";
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  )
    return "image/jpeg";
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  )
    return "image/webp";
  return fail(
    "PROVIDER_MALFORMED_OUTPUT",
    "Provider output is not a validated PNG, JPEG, or WebP image.",
  );
}

async function boundedResponseBytes(
  response: Response,
  limit: number,
  code: ConstructorParameters<typeof CreationCoreError>[0],
  message: string,
  signal?: AbortSignal | null,
): Promise<Uint8Array> {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    if (!/^\d+$/u.test(declared) || Number(declared) > limit) {
      return fail(code, message);
    }
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        return fail(code, message);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (signal?.aborted) {
      return fail("PROVIDER_CANCELLED", "Provider request was cancelled.");
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function defaultWebsocketProbe(
  url: string,
  signal?: AbortSignal,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => {
      socket.close();
      reject(
        new CreationCoreError(
          "PROVIDER_TIMEOUT",
          "ComfyUI WebSocket probe timed out.",
        ),
      );
    }, 5_000);
    const abort = () => {
      socket.close();
      reject(
        new CreationCoreError(
          "PROVIDER_CANCELLED",
          "Provider inspection was cancelled.",
        ),
      );
    };
    signal?.addEventListener("abort", abort, { once: true });
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      socket.close();
      resolve();
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(
        new CreationCoreError(
          "PROVIDER_CAPABILITY_MISSING",
          "ComfyUI WebSocket capability is unavailable.",
        ),
      );
    });
  });
}

export class ComfyUiProviderAdapter implements CreationProvider {
  readonly #endpoint: URL;
  readonly #fetch: Fetch;
  readonly #timeoutMs: number;
  readonly #pollIntervalMs: number;
  readonly #websocketProbe: NonNullable<
    ComfyUiAdapterOptions["websocketProbe"]
  >;
  readonly #websocketFactory: NonNullable<
    ComfyUiAdapterOptions["websocketFactory"]
  >;
  readonly #allowGlobalInterrupt: boolean;

  constructor(options: ComfyUiAdapterOptions = {}) {
    this.#endpoint = normalizedEndpoint(
      options.endpoint ?? "http://127.0.0.1:8188",
    );
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#pollIntervalMs = options.pollIntervalMs ?? 500;
    this.#websocketProbe = options.websocketProbe ?? defaultWebsocketProbe;
    this.#websocketFactory =
      options.websocketFactory ?? ((url) => new WebSocket(url));
    this.#allowGlobalInterrupt = options.allowGlobalInterrupt ?? false;
  }

  async #request(pathname: string, init: RequestInit = {}): Promise<Response> {
    const target = new URL(pathname, this.#endpoint);
    if (target.origin !== this.#endpoint.origin) {
      return fail(
        "PROVIDER_ENDPOINT_INVALID",
        "Provider request escaped the loopback origin.",
      );
    }
    const response = await this.#fetch(target, {
      ...init,
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
    }).catch((error: unknown) => {
      if (error instanceof CreationCoreError) throw error;
      if (init.signal?.aborted) {
        return fail("PROVIDER_CANCELLED", "Provider request was cancelled.");
      }
      return fail(
        "PROVIDER_RESPONSE_INVALID",
        error instanceof Error ? error.message : "Provider request failed.",
      );
    });
    if (!response.ok) {
      return fail(
        "PROVIDER_RESPONSE_INVALID",
        `Provider returned HTTP ${response.status} for ${target.pathname}.`,
      );
    }
    return response;
  }

  async #json(pathname: string, init: RequestInit = {}): Promise<unknown> {
    const response = await this.#request(pathname, init);
    const bytes = await boundedResponseBytes(
      response,
      MAX_JSON_BYTES,
      "PROVIDER_RESPONSE_INVALID",
      "Provider JSON response exceeds the fixed limit.",
      init.signal,
    );
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return JSON.parse(text) as unknown;
    } catch {
      return fail(
        "PROVIDER_RESPONSE_INVALID",
        "Provider returned malformed JSON.",
      );
    }
  }

  async inspect(signal?: AbortSignal): Promise<ProviderInspection> {
    const [features, stats, objectInfo, checkpointResponse] = await Promise.all(
      [
        this.#json("/features", { signal: signal ?? null }),
        this.#json("/system_stats", { signal: signal ?? null }),
        this.#json("/object_info", { signal: signal ?? null }),
        this.#json("/models/checkpoints", { signal: signal ?? null }),
      ],
    );
    if (!features || typeof features !== "object")
      return fail(
        "PROVIDER_CAPABILITY_MISSING",
        "ComfyUI /features is unavailable.",
      );
    if (!stats || typeof stats !== "object")
      return fail(
        "PROVIDER_RESPONSE_INVALID",
        "ComfyUI system statistics are malformed.",
      );
    const rawStats = stats as Record<string, unknown>;
    const rawVersion =
      typeof rawStats.comfyui_version === "string"
        ? rawStats.comfyui_version
        : typeof rawStats.system === "object" && rawStats.system !== null
          ? (rawStats.system as Record<string, unknown>).comfyui_version
          : undefined;
    const version =
      typeof rawVersion === "string"
        ? VERSION_PATTERN.exec(rawVersion)?.[1]
        : undefined;
    if (!version)
      return fail(
        "PROVIDER_VERSION_INCOMPATIBLE",
        "ComfyUI did not report a semantic version.",
      );
    if (!objectInfo || typeof objectInfo !== "object")
      return fail(
        "PROVIDER_RESPONSE_INVALID",
        "ComfyUI node inventory is malformed.",
      );
    const nodeInventory = objectInfo as Record<string, unknown>;
    const available = Object.keys(nodeInventory);
    const missing = REQUIRED_COMFYUI_NODE_CLASSES.filter(
      (item) => !available.includes(item),
    );
    if (missing.length > 0)
      return fail(
        "PROVIDER_CAPABILITY_MISSING",
        `ComfyUI is missing required core nodes: ${missing.join(", ")}.`,
      );
    const checkpoints = Array.isArray(checkpointResponse)
      ? checkpointResponse.filter(
          (item): item is string =>
            typeof item === "string" && item.length <= 512,
        )
      : [];
    if (checkpoints.length === 0)
      return fail(
        "PROVIDER_CAPABILITY_MISSING",
        "ComfyUI reports no usable checkpoints.",
      );
    await this.#request("/upload/image", {
      method: "OPTIONS",
      signal: signal ?? null,
    });
    await this.#request("/interrupt", {
      method: "OPTIONS",
      signal: signal ?? null,
    });
    const clientId = `inspect_${crypto.randomUUID().replaceAll("-", "")}`;
    const wsUrl = new URL(`/ws?clientId=${clientId}`, this.#endpoint);
    wsUrl.protocol = "ws:";
    await this.#websocketProbe(wsUrl.href, signal);
    return {
      provider: "comfyui-local",
      version,
      endpoint: this.#endpoint.origin,
      checkpoints,
      nodeClasses: [...REQUIRED_COMFYUI_NODE_CLASSES],
      customNodeCount: Object.values(nodeInventory).filter(
        (item) =>
          item !== null &&
          typeof item === "object" &&
          typeof (item as Record<string, unknown>).python_module === "string" &&
          String((item as Record<string, unknown>).python_module).startsWith(
            "custom_nodes.",
          ),
      ).length,
      featuresAvailable: true,
      websocketAvailable: true,
    };
  }

  async run(
    request: ProviderJobRequest,
    observe: (observation: ProviderObservation) => void,
    signal?: AbortSignal,
  ): Promise<ProviderOutput> {
    if (!/^client_[A-Za-z0-9_-]{12,80}$/u.test(request.clientId))
      return fail(
        "CREATION_STATE_INVALID",
        "Provider client identity is invalid.",
      );
    const workflow = buildComfyUiWorkflow(
      request.snapshot,
      request.filenamePrefix,
      request.prompt !== undefined && request.negativePrompt !== undefined
        ? { prompt: request.prompt, negativePrompt: request.negativePrompt }
        : undefined,
    );
    let providerJobId: string | undefined;
    let terminalObserved = false;
    const socket = await this.#openProgressSocket(
      request.clientId,
      () => providerJobId,
      observe,
      signal,
    );
    try {
      const accepted = await this.#json("/prompt", {
        method: "POST",
        signal: signal ?? null,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: workflow, client_id: request.clientId }),
      });
      const rawProviderJobId =
        accepted && typeof accepted === "object"
          ? (accepted as Record<string, unknown>).prompt_id
          : undefined;
      if (
        typeof rawProviderJobId !== "string" ||
        !/^[A-Za-z0-9_-]{8,128}$/u.test(rawProviderJobId)
      )
        return fail(
          "PROVIDER_RESPONSE_INVALID",
          "ComfyUI did not return a valid prompt identity.",
        );
      providerJobId = rawProviderJobId;
      observe({ state: "accepted", providerJobId });
      observe({ state: "running", providerJobId });
      const deadline = Date.now() + this.#timeoutMs;
      let progress = 0;
      for (;;) {
        if (signal?.aborted) {
          await this.cancel().catch(() => undefined);
          observe({ state: "cancelled", providerJobId });
          terminalObserved = true;
          return fail("PROVIDER_CANCELLED", "Provider job was cancelled.");
        }
        if (Date.now() >= deadline) {
          await this.cancel().catch(() => undefined);
          observe({
            state: "failed",
            providerJobId,
            code: "PROVIDER_TIMEOUT",
            message: "Provider job timed out.",
          });
          terminalObserved = true;
          return fail("PROVIDER_TIMEOUT", "Provider job timed out.");
        }
        const history = await this.#json(
          `/history/${encodeURIComponent(providerJobId)}`,
          { signal: signal ?? null },
        );
        const job =
          history && typeof history === "object"
            ? (history as Record<string, unknown>)[providerJobId]
            : undefined;
        if (job && typeof job === "object") {
          const status = (job as Record<string, unknown>).status;
          const statusRecord =
            status && typeof status === "object"
              ? (status as Record<string, unknown>)
              : undefined;
          if (
            statusRecord?.status_str === "error" ||
            statusRecord?.completed === false
          ) {
            observe({
              state: "failed",
              providerJobId,
              code: "PROVIDER_RESPONSE_INVALID",
              message: "ComfyUI reported a failed job.",
            });
            terminalObserved = true;
            return fail(
              "PROVIDER_RESPONSE_INVALID",
              "ComfyUI reported a failed job.",
            );
          }
          const outputs = (job as Record<string, unknown>).outputs;
          const saveOutput =
            outputs && typeof outputs === "object"
              ? (outputs as Record<string, unknown>)["7"]
              : undefined;
          const images =
            saveOutput && typeof saveOutput === "object"
              ? (saveOutput as Record<string, unknown>).images
              : undefined;
          const image = Array.isArray(images) ? images[0] : undefined;
          if (image && typeof image === "object") {
            const descriptor = image as Record<string, unknown>;
            const filename = safeOutputPath(String(descriptor.filename ?? ""));
            const subfolder = safeOutputPath(
              String(descriptor.subfolder ?? ""),
              true,
            );
            if (descriptor.type !== "output")
              return fail(
                "PROVIDER_MALFORMED_OUTPUT",
                "Provider output is outside the assigned output collection.",
              );
            const query = new URLSearchParams({
              filename,
              subfolder,
              type: "output",
            });
            const response = await this.#request(`/view?${query.toString()}`, {
              signal: signal ?? null,
            });
            const bytes = await boundedResponseBytes(
              response,
              MAX_OUTPUT_BYTES,
              "PROVIDER_MALFORMED_OUTPUT",
              "Provider output exceeds the fixed size limit.",
              signal,
            );
            if (bytes.length < 1)
              return fail(
                "PROVIDER_MALFORMED_OUTPUT",
                "Provider output size is invalid.",
              );
            const output: ProviderOutput = {
              filename,
              subfolder,
              type: "output",
              mediaType: mediaType(bytes),
              sizeBytes: bytes.length,
              sha256: sha256(bytes),
              bytes,
            };
            observe({
              state: "progress",
              providerJobId,
              completedUnits: 100,
              totalUnits: 100,
            });
            observe({ state: "completed", providerJobId, output });
            terminalObserved = true;
            return output;
          }
        }
        progress = Math.min(95, progress + 5);
        observe({
          state: "progress",
          providerJobId,
          completedUnits: progress,
          totalUnits: 100,
        });
        await new Promise((resolve) =>
          setTimeout(resolve, this.#pollIntervalMs),
        );
      }
    } catch (error) {
      if (providerJobId && !terminalObserved) {
        if (
          error instanceof CreationCoreError &&
          error.code === "PROVIDER_CANCELLED"
        ) {
          await this.cancel().catch(() => undefined);
          observe({ state: "cancelled", providerJobId });
        } else {
          observe({
            state: "failed",
            providerJobId,
            code:
              error instanceof CreationCoreError
                ? error.code
                : "PROVIDER_RESPONSE_INVALID",
            message:
              error instanceof Error ? error.message : "Provider job failed.",
          });
        }
      }
      throw error;
    } finally {
      socket.close();
    }
  }

  async cancel(): Promise<void> {
    if (this.#allowGlobalInterrupt) {
      await this.#request("/interrupt", { method: "POST" });
    }
  }

  async #openProgressSocket(
    clientId: string,
    providerJobId: () => string | undefined,
    observe: (observation: ProviderObservation) => void,
    signal?: AbortSignal,
  ): Promise<WebSocket> {
    const wsUrl = new URL(
      `/ws?clientId=${encodeURIComponent(clientId)}`,
      this.#endpoint,
    );
    wsUrl.protocol = "ws:";
    const socket = this.#websocketFactory(wsUrl.href);
    let nextProgressAt = 0;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.close();
        reject(
          new CreationCoreError(
            "PROVIDER_TIMEOUT",
            "ComfyUI progress WebSocket timed out.",
          ),
        );
      }, 5_000);
      const abort = () => {
        clearTimeout(timer);
        socket.close();
        reject(
          new CreationCoreError(
            "PROVIDER_CANCELLED",
            "Provider job was cancelled before submission.",
          ),
        );
      };
      signal?.addEventListener("abort", abort, { once: true });
      socket.addEventListener(
        "open",
        () => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
          resolve();
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
          reject(
            new CreationCoreError(
              "PROVIDER_CAPABILITY_MISSING",
              "ComfyUI progress WebSocket is unavailable.",
            ),
          );
        },
        { once: true },
      );
    });
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string" || event.data.length > MAX_JSON_BYTES)
        return;
      try {
        const message = JSON.parse(event.data) as Record<string, unknown>;
        if (
          message.type !== "progress" ||
          typeof message.data !== "object" ||
          !message.data
        )
          return;
        const data = message.data as Record<string, unknown>;
        const currentJob = providerJobId();
        if (
          !currentJob ||
          (typeof data.prompt_id === "string" && data.prompt_id !== currentJob)
        )
          return;
        const completedUnits = Number(data.value);
        const totalUnits = Number(data.max);
        if (
          Number.isFinite(completedUnits) &&
          Number.isFinite(totalUnits) &&
          totalUnits > 0
        ) {
          const now = Date.now();
          if (now < nextProgressAt) return;
          nextProgressAt = now + MIN_PROGRESS_INTERVAL_MS;
          observe({
            state: "progress",
            providerJobId: currentJob,
            completedUnits: Math.max(0, Math.floor(completedUnits)),
            totalUnits: Math.max(1, Math.floor(totalUnits)),
          });
        }
      } catch {
        // Ignore bounded non-JSON binary/status frames; history remains authoritative.
      }
    });
    return socket;
  }
}
