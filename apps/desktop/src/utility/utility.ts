import {
  NATIVE_API_VERSION,
  RUNTIME_LIMITS,
  validateNativeDiscovery,
  type HostEnvelope,
} from "@aigc-proof/host-contracts";
import {
  UTILITY_PROTOCOL_VERSION,
  mainToUtilityMessageSchema,
  type UtilityJob,
  type UtilityToMainMessage,
} from "../shared/utility-protocol";
import { invokeNative, loadNativeAddon, type NativeAddon } from "./native";

const utilityParentPort = process.parentPort;
if (!utilityParentPort)
  throw new Error("AIGC-Proof Utility must be launched by Electron Main.");

const addon: NativeAddon = loadNativeAddon();
const discovery = validateNativeDiscovery(addon.getApiInfo());
let busy = false;

function send(message: UtilityToMainMessage): void {
  const encoded = JSON.stringify(message);
  if (Buffer.byteLength(encoded, "utf8") > RUNTIME_LIMITS.maxMessageBytes) {
    throw new Error("Utility response exceeded the configured message limit.");
  }
  utilityParentPort.postMessage(message);
}

function progress(
  jobId: string,
  sequence: number,
  completedUnits: number,
  message: string,
): void {
  send({
    version: UTILITY_PROTOCOL_VERSION,
    type: "progress",
    jobId,
    sequence,
    completedUnits,
    message,
  });
}

async function validateRecents(
  job: Extract<UtilityJob, { operation: "validateRecents" }>,
) {
  const valid: Array<{ kind: "workspace" | "package"; path: string }> = [];
  for (const item of job.payload.items) {
    const result = await invokeNative(
      item.kind === "workspace"
        ? addon.loadWorkspaceSummary({ path: item.path })
        : addon.inspectProofPackage({ path: item.path }),
    );
    if (result.ok) valid.push(item);
  }
  return { ok: true, data: { valid } } satisfies HostEnvelope<unknown>;
}

async function execute(job: UtilityJob): Promise<HostEnvelope<unknown>> {
  switch (job.operation) {
    case "initializeWorkspace":
      return invokeNative(
        addon.initializeWorkspace({
          path: job.payload.path,
          ...(job.payload.projectName
            ? { projectName: job.payload.projectName }
            : {}),
        }),
      );
    case "loadWorkspace":
      return invokeNative(addon.loadWorkspaceSummary(job.payload));
    case "addAsset":
      return invokeNative(addon.addWorkspaceAsset(job.payload));
    case "recordEvent":
      return invokeNative(addon.recordWorkspaceEvent(job.payload));
    case "sealPackage":
      return invokeNative(addon.sealProofPackage(job.payload));
    case "verifyPackage":
      return invokeNative(addon.verifyProofPackage(job.payload));
    case "inspectPackage":
      return invokeNative(addon.inspectProofPackage(job.payload));
    case "validateRecents":
      return validateRecents(job);
  }
}

utilityParentPort.on("message", (event: Electron.MessageEvent) => {
  const size = Buffer.byteLength(JSON.stringify(event.data), "utf8");
  if (size > RUNTIME_LIMITS.maxMessageBytes) process.exit(71);
  const parsed = mainToUtilityMessageSchema.safeParse(event.data);
  if (!parsed.success) process.exit(72);
  const message = parsed.data;
  if (message.type === "shutdown") {
    process.exit(busy ? 73 : 0);
  }
  if (message.type === "qa-crash") process.exit(74);
  if (busy) process.exit(75);
  busy = true;
  progress(message.jobId, 1, 35, "Utility 已接收并验证任务。");
  void execute(message.job)
    .then((envelope) => {
      progress(message.jobId, 2, 82, "Rust 操作已返回，等待 Main 发布结果。");
      send({
        version: UTILITY_PROTOCOL_VERSION,
        type: "result",
        jobId: message.jobId,
        envelope,
      });
    })
    .finally(() => {
      busy = false;
    });
});

send({
  version: UTILITY_PROTOCOL_VERSION,
  type: "ready",
  nativeApiVersion: NATIVE_API_VERSION,
  discovery,
});
