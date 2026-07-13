import {
  sha256,
  verifyCreationSnapshot,
  type CreationProvider,
  type ProviderInspection,
  type ProviderJobRequest,
  type ProviderObservation,
  type ProviderOutput,
} from "../index";

const PNG_1X1 = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ),
);

// Explicit test-only provider. Product Main never constructs or exposes it.
export class DeterministicTestProvider implements CreationProvider {
  #cancelled = false;

  inspect(): Promise<ProviderInspection> {
    return Promise.resolve({
      provider: "comfyui-local",
      version: "0.27.0",
      endpoint: "http://127.0.0.1:8188",
      checkpoints: ["deterministic-test.safetensors"],
      nodeClasses: [
        "CheckpointLoaderSimple",
        "CLIPTextEncode",
        "EmptyLatentImage",
        "KSampler",
        "VAEDecode",
        "SaveImage",
      ],
      customNodeCount: 0,
      featuresAvailable: true,
      websocketAvailable: true,
    });
  }

  async run(
    request: ProviderJobRequest,
    observe: (observation: ProviderObservation) => void,
    signal?: AbortSignal,
  ): Promise<ProviderOutput> {
    verifyCreationSnapshot(request.snapshot);
    this.#cancelled = false;
    const providerJobId = `deterministic_${request.clientId.slice(-16)}`;
    observe({ state: "accepted", providerJobId });
    observe({ state: "running", providerJobId });
    await Promise.resolve();
    if (this.#cancelled || signal?.aborted) {
      observe({ state: "cancelled", providerJobId });
      throw new Error("DETERMINISTIC_TEST_CANCELLED");
    }
    observe({
      state: "progress",
      providerJobId,
      completedUnits: 1,
      totalUnits: 1,
    });
    const output: ProviderOutput = {
      filename: `${request.filenamePrefix}.png`,
      subfolder: "",
      type: "output",
      mediaType: "image/png",
      sizeBytes: PNG_1X1.length,
      sha256: sha256(PNG_1X1),
      bytes: PNG_1X1.slice(),
    };
    observe({ state: "completed", providerJobId, output });
    return output;
  }

  cancel(): Promise<void> {
    this.#cancelled = true;
    return Promise.resolve();
  }
}
