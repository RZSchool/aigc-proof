import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import {
  CREATION_TEMPLATE_SHA256,
  ComfyUiProviderAdapter,
  CreationCoreError,
  buildComfyUiWorkflow,
  createCreationSnapshot,
  mapCreationEvidence,
  transitionCreationSession,
  verifyCreationSnapshot,
} from "./index";
import { DeterministicTestProvider } from "./provider/deterministic-test";

const input = {
  providerVersion: "0.27.0",
  checkpointObservation: "local-model.safetensors",
  seed: 42,
  parameters: {
    width: 512,
    height: 512,
    steps: 20,
    cfg: 7,
    sampler: "euler",
    scheduler: "normal",
  },
  promptDisclosure: "included" as const,
  prompt: "a quiet mountain lake",
  negativePrompt: "text",
};

function openingWebSocketFactory(): (url: string) => WebSocket {
  return () => {
    const socket = {
      addEventListener: (
        type: string,
        listener: EventListenerOrEventListenerObject,
      ) => {
        if (type !== "open") return;
        queueMicrotask(() => {
          if (typeof listener === "function") listener(new Event("open"));
          else listener.handleEvent(new Event("open"));
        });
      },
      close: vi.fn(),
    };
    return socket as unknown as WebSocket;
  };
}

function providerRequest() {
  return {
    clientId: "client_abcdefghijkl",
    snapshot: createCreationSnapshot(input),
    filenamePrefix: "ap_session_test",
  };
}

describe("creation snapshot", () => {
  it("freezes a deterministic privacy-aware canonical snapshot", () => {
    const first = createCreationSnapshot(input);
    const second = createCreationSnapshot({
      ...input,
      parameters: { ...input.parameters },
    });
    expect(first).toEqual(second);
    expect(first.workflow_template_sha256).toBe(CREATION_TEMPLATE_SHA256);
    expect(verifyCreationSnapshot(first)).toEqual(first);
    const digestOnly = createCreationSnapshot({
      ...input,
      promptDisclosure: "digest-only",
    });
    expect(digestOnly).not.toHaveProperty("prompt");
    expect(digestOnly.prompt_sha256).toBe(first.prompt_sha256);
  });

  it("rejects mutated frozen snapshots", () => {
    const snapshot = createCreationSnapshot(input);
    expect(() => verifyCreationSnapshot({ ...snapshot, seed: 43 })).toThrow(
      CreationCoreError,
    );
  });
});

describe("fixed ComfyUI workflow", () => {
  it("maps only approved fields into the six reviewed core node classes", () => {
    const workflow = buildComfyUiWorkflow(
      createCreationSnapshot(input),
      "ap_session_test",
    );
    expect(Object.values(workflow).map((node) => node.class_type)).toEqual([
      "CheckpointLoaderSimple",
      "CLIPTextEncode",
      "CLIPTextEncode",
      "EmptyLatentImage",
      "KSampler",
      "VAEDecode",
      "SaveImage",
    ]);
    expect(workflow["5"]?.inputs.seed).toBe(42);
  });

  it("rejects arbitrary output path syntax", () => {
    expect(() =>
      buildComfyUiWorkflow(createCreationSnapshot(input), "../escape"),
    ).toThrow(CreationCoreError);
  });

  it("uses digest-checked ephemeral prompts for digest-only execution", () => {
    const snapshot = createCreationSnapshot({
      ...input,
      promptDisclosure: "digest-only",
    });
    expect(
      buildComfyUiWorkflow(snapshot, "ap_session_test", {
        prompt: input.prompt,
        negativePrompt: input.negativePrompt,
      })["2"]?.inputs.text,
    ).toBe(input.prompt);
    expect(() =>
      buildComfyUiWorkflow(snapshot, "ap_session_test", {
        prompt: "substituted",
        negativePrompt: input.negativePrompt,
      }),
    ).toThrow(CreationCoreError);
  });
});

describe("evidence mapping", () => {
  it("emits a stable successful chain and refuses incomplete relationships", () => {
    const snapshot = createCreationSnapshot(input);
    const output = {
      filename: "out.png",
      subfolder: "",
      type: "output" as const,
      mediaType: "image/png" as const,
      sizeBytes: 16,
      sha256: "a".repeat(64),
    };
    expect(
      mapCreationEvidence({
        sessionId: "session_abcdefghijkl",
        sessionState: "succeeded",
        snapshot,
        providerJobId: "job-1",
        output,
      }).map((event) => event.eventType),
    ).toEqual([
      "session.started",
      "snapshot.frozen",
      "job.requested",
      "job.completed",
      "output.ingested",
      "proof.ready",
    ]);
    expect(() =>
      mapCreationEvidence({
        sessionId: "session_abcdefghijkl",
        sessionState: "succeeded",
        snapshot,
        providerJobId: "",
        output,
      }),
    ).toThrow(CreationCoreError);
    expect(() =>
      mapCreationEvidence({
        sessionId: "session_abcdefghijkl",
        sessionState: "failed",
        snapshot,
        providerJobId: "job-1",
        output,
      }),
    ).toThrow(CreationCoreError);
  });
});

describe("creation session lifecycle", () => {
  it("allows only truthful success, evidence, retry, cancellation, and proof transitions", () => {
    expect(transitionCreationSession("draft", "freeze")).toBe("frozen");
    expect(transitionCreationSession("frozen", "start")).toBe("running");
    expect(transitionCreationSession("running", "provider_succeeded")).toBe(
      "succeeded",
    );
    expect(transitionCreationSession("succeeded", "evidence_ready")).toBe(
      "proof_ready",
    );
    expect(transitionCreationSession("failed", "start")).toBe("running");
    expect(transitionCreationSession("running", "cancel")).toBe("cancelled");
    expect(() => transitionCreationSession("failed", "evidence_ready")).toThrow(
      CreationCoreError,
    );
    expect(() =>
      transitionCreationSession("cancelled", "proof_complete"),
    ).toThrow(CreationCoreError);
  });
});

describe("ComfyUI adapter boundary", () => {
  it("rejects remote origins and credentials", () => {
    expect(
      () => new ComfyUiProviderAdapter({ endpoint: "https://example.com" }),
    ).toThrow(CreationCoreError);
    expect(
      () =>
        new ComfyUiProviderAdapter({
          endpoint: "http://user:x@127.0.0.1:8188",
        }),
    ).toThrow(CreationCoreError);
  });

  it("inspects required capabilities without following redirects", async () => {
    const fetchMock = vi.fn(async (raw: string | URL | Request) => {
      const url = new URL(raw.toString());
      if (url.pathname === "/features")
        return Response.json({ preview_metadata: true });
      if (url.pathname === "/system_stats")
        return Response.json({ system: { comfyui_version: "0.27.0" } });
      if (url.pathname === "/object_info")
        return Response.json(
          Object.fromEntries(
            [
              "CheckpointLoaderSimple",
              "CLIPTextEncode",
              "EmptyLatentImage",
              "KSampler",
              "VAEDecode",
              "SaveImage",
            ].map((key) => [key, {}]),
          ),
        );
      if (url.pathname === "/models/checkpoints")
        return Response.json(["model.safetensors"]);
      return new Response(null, { status: 200 });
    });
    const adapter = new ComfyUiProviderAdapter({
      fetch: fetchMock as typeof fetch,
      websocketProbe: async () => undefined,
    });
    await expect(adapter.inspect()).resolves.toMatchObject({
      version: "0.27.0",
    });
    expect(
      fetchMock.mock.calls.every((call) => call[1]?.redirect === "error"),
    ).toBe(true);
  });

  it("stops an undeclared oversized JSON stream at the fixed byte limit", async () => {
    const chunk = new Uint8Array(4 * 1024 * 1024);
    const fetchMock = vi.fn(async (raw: string | URL | Request) => {
      const url = new URL(raw.toString());
      if (url.pathname === "/features") {
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(chunk);
              controller.enqueue(chunk);
              controller.enqueue(new Uint8Array([0]));
              controller.close();
            },
          }),
        );
      }
      if (url.pathname === "/system_stats")
        return Response.json({ system: { comfyui_version: "0.27.0" } });
      if (url.pathname === "/object_info") return Response.json({});
      if (url.pathname === "/models/checkpoints")
        return Response.json(["model.safetensors"]);
      return new Response(null, { status: 200 });
    });
    const adapter = new ComfyUiProviderAdapter({
      fetch: fetchMock as typeof fetch,
      websocketProbe: async () => undefined,
    });
    await expect(adapter.inspect()).rejects.toMatchObject({
      code: "PROVIDER_RESPONSE_INVALID",
      message: "Provider JSON response exceeds the fixed limit.",
    });
  });

  it("reports a provider connection loss as a failed observation", async () => {
    const fetchMock = vi.fn(async (raw: string | URL | Request) => {
      const url = new URL(raw.toString());
      if (url.pathname === "/prompt")
        return Response.json({ prompt_id: "job_12345678" });
      throw new Error("connection lost");
    });
    const observations: string[] = [];
    const adapter = new ComfyUiProviderAdapter({
      fetch: fetchMock as typeof fetch,
      websocketFactory: openingWebSocketFactory(),
      pollIntervalMs: 0,
    });
    await expect(
      adapter.run(providerRequest(), (item) => observations.push(item.state)),
    ).rejects.toMatchObject({ code: "PROVIDER_RESPONSE_INVALID" });
    expect(observations).toEqual(["accepted", "running", "failed"]);
  });

  it("times out with a failed observation and interrupts only an app-owned provider", async () => {
    const fetchMock = vi.fn(async (raw: string | URL | Request) => {
      const url = new URL(raw.toString());
      if (url.pathname === "/prompt")
        return Response.json({ prompt_id: "job_12345678" });
      return new Response(null, { status: 200 });
    });
    const observations: string[] = [];
    const adapter = new ComfyUiProviderAdapter({
      fetch: fetchMock as typeof fetch,
      websocketFactory: openingWebSocketFactory(),
      timeoutMs: 0,
      pollIntervalMs: 0,
      allowGlobalInterrupt: true,
    });
    await expect(
      adapter.run(providerRequest(), (item) => observations.push(item.state)),
    ).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
    expect(observations).toEqual(["accepted", "running", "failed"]);
    expect(
      fetchMock.mock.calls.some((call) => {
        const url = new URL(call[0].toString());
        return url.pathname === "/interrupt" && call[1]?.method === "POST";
      }),
    ).toBe(true);
  });

  it("keeps shared-provider cancellation local and records cancellation truthfully", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async (raw: string | URL | Request) => {
      const url = new URL(raw.toString());
      if (url.pathname === "/prompt")
        return Response.json({ prompt_id: "job_12345678" });
      if (url.pathname.startsWith("/history/")) {
        return new Response(
          new ReadableStream<Uint8Array>({
            start(stream) {
              controller.abort();
              stream.error(
                new DOMException(
                  "cancelled during provider wait",
                  "AbortError",
                ),
              );
            },
          }),
        );
      }
      return Response.json({});
    });
    const observations: string[] = [];
    const adapter = new ComfyUiProviderAdapter({
      fetch: fetchMock as typeof fetch,
      websocketFactory: openingWebSocketFactory(),
      pollIntervalMs: 0,
    });
    await expect(
      adapter.run(
        providerRequest(),
        (item) => observations.push(item.state),
        controller.signal,
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_CANCELLED" });
    expect(observations).toEqual(["accepted", "running", "cancelled"]);
    expect(
      fetchMock.mock.calls.some(
        (call) => new URL(call[0].toString()).pathname === "/interrupt",
      ),
    ).toBe(false);
  });

  it("rejects malformed provider output and emits no completed observation", async () => {
    const fetchMock = vi.fn(async (raw: string | URL | Request) => {
      const url = new URL(raw.toString());
      if (url.pathname === "/prompt")
        return Response.json({ prompt_id: "job_12345678" });
      if (url.pathname.startsWith("/history/")) {
        return Response.json({
          job_12345678: {
            status: { status_str: "success", completed: true },
            outputs: {
              "7": {
                images: [
                  { filename: "bad.png", subfolder: "", type: "output" },
                ],
              },
            },
          },
        });
      }
      if (url.pathname === "/view") return new Response("not an image");
      return new Response(null, { status: 200 });
    });
    const observations: string[] = [];
    const adapter = new ComfyUiProviderAdapter({
      fetch: fetchMock as typeof fetch,
      websocketFactory: openingWebSocketFactory(),
      pollIntervalMs: 0,
    });
    await expect(
      adapter.run(providerRequest(), (item) => observations.push(item.state)),
    ).rejects.toMatchObject({ code: "PROVIDER_MALFORMED_OUTPUT" });
    expect(observations).toEqual(["accepted", "running", "failed"]);
  });
});

describe("reusable consumer boundary", () => {
  it("has no Electron, React, SQLite, standalone UI, or standalone state dependency", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { dependencies?: Record<string, string> };
    expect(Object.keys(packageJson.dependencies ?? {}).sort()).toEqual([
      "@aigc-proof/host-contracts",
      "zod",
    ]);
    const sources = await Promise.all([
      readFile(new URL("./index.ts", import.meta.url), "utf8"),
      readFile(new URL("./provider/comfyui.ts", import.meta.url), "utf8"),
    ]);
    expect(sources.join("\n")).not.toMatch(
      /(?:electron|react|better-sqlite3|app-state|src\/renderer)/u,
    );
  });
});

describe("deterministic QA provider", () => {
  it("emits reproducible bytes and the complete successful observation sequence", async () => {
    const provider = new DeterministicTestProvider();
    const observations: string[] = [];
    const request = {
      clientId: "client_abcdefghijkl",
      snapshot: createCreationSnapshot({
        ...input,
        checkpointObservation: "deterministic-test.safetensors",
      }),
      filenamePrefix: "qa_output",
    };
    const first = await provider.run(request, (observation) =>
      observations.push(observation.state),
    );
    const second = await provider.run(request, () => undefined);
    expect(first.sha256).toBe(second.sha256);
    expect(observations).toEqual([
      "accepted",
      "running",
      "progress",
      "completed",
    ]);
  });
});
