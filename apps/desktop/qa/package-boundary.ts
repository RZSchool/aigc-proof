import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";

import { extractFile, listPackage } from "@electron/asar";
import {
  NATIVE_API_VERSION,
  NATIVE_CAPABILITIES,
  NATIVE_ENGINE_VERSION,
  PROTOCOL_VERSION,
  validateNativeDiscovery,
} from "@aigc-proof/host-contracts";

const desktop = path.resolve(__dirname, "..");
const repo = path.resolve(desktop, "../..");
const workspaceRoot = path.resolve(repo, "..");
const packageRoot = path.resolve(
  process.env.AIGC_PROOF_PACKAGE_DIR ??
    path.join(workspaceRoot, "app", "AIGC-Proof-Workbench"),
);
const executable = path.join(packageRoot, "AIGC-Proof.exe");
const asar = path.join(packageRoot, "resources", "app.asar");
const addon = path.join(packageRoot, "resources", "native", "proof_napi.node");
const requireNative = createRequire(__filename);

async function main(): Promise<void> {
  await Promise.all([fs.access(executable), fs.access(asar), fs.access(addon)]);
  const files = listPackage(asar, { isPack: false }).map((file) =>
    file.replaceAll("\\", "/"),
  );
  for (const required of [
    "/dist/main/main.js",
    "/dist/preload/preload.js",
    "/dist/renderer/index.html",
    "/dist/utility/utility.js",
    "/dist/utility/native.js",
  ]) {
    if (!files.includes(required)) {
      throw new Error(`Packaged app is missing ${required}.`);
    }
  }
  if (
    files.some(
      (file) =>
        file.endsWith(".map") ||
        file.includes("qa-results") ||
        file.endsWith("deterministic-test.js") ||
        /\.(?:ts|tsx|rs|cc|cpp|py|pdb)$/iu.test(file),
    )
  ) {
    throw new Error("Package contains source maps or QA output.");
  }
  const mainSource = extractFile(asar, "dist\\main\\main.js").toString("utf8");
  const utilitySource = extractFile(asar, "dist\\utility\\native.js").toString(
    "utf8",
  );
  const renderer = extractFile(asar, "dist\\renderer\\index.html").toString(
    "utf8",
  );
  const packagedManifest = JSON.parse(
    extractFile(asar, "package.json").toString("utf8"),
  ) as { version?: string };
  if (packagedManifest.version !== "0.4.0") {
    throw new Error(
      `Packaged Workbench version is ${packagedManifest.version ?? "missing"}.`,
    );
  }
  if (
    !mainSource.includes("nodeIntegration: false") ||
    !mainSource.includes("contextIsolation: true")
  ) {
    throw new Error("Packaged Main security defaults are missing.");
  }
  if (
    files.some((file) =>
      /(?:python_embeded\/|comfyui\/main\.py$|\.safetensors$|custom_nodes\/)/iu.test(
        file,
      ),
    )
  ) {
    throw new Error(
      "Package improperly redistributes ComfyUI, Python, model weights, or custom nodes.",
    );
  }
  if (!renderer.includes("connect-src 'none'")) {
    throw new Error("Packaged renderer CSP is not offline-only.");
  }
  if (!mainSource.includes("setApplicationMenu(null)")) {
    throw new Error(
      "Packaged Main did not remove the Electron application menu.",
    );
  }
  const packagedMainSources = files
    .filter((file) => file.startsWith("/dist/main/") && file.endsWith(".js"))
    .map((file) =>
      extractFile(asar, file.slice(1).replaceAll("/", "\\")).toString("utf8"),
    )
    .join("\n");
  if (/createRequire|loadNativeAddon/u.test(packagedMainSources)) {
    throw new Error("Packaged Main contains a production native-addon loader.");
  }
  if (
    !utilitySource.includes("createRequire") ||
    !utilitySource.includes("loadNativeAddon")
  ) {
    throw new Error(
      "Packaged Utility is missing the exclusive native-addon loader.",
    );
  }
  const native = requireNative(addon) as { getApiInfo(): unknown };
  const discovery = validateNativeDiscovery(native.getApiInfo());
  if (
    discovery.apiVersion !== NATIVE_API_VERSION ||
    discovery.engineVersion !== NATIVE_ENGINE_VERSION ||
    discovery.supportedProtocolVersions.join(",") !== PROTOCOL_VERSION ||
    discovery.capabilities.join(",") !== NATIVE_CAPABILITIES.join(",")
  ) {
    throw new Error(
      "Packaged native discovery does not match the reviewed contract.",
    );
  }
  const result = {
    result: "PASS",
    packageRoot,
    executable,
    asar,
    addon,
    workbenchVersion: packagedManifest.version,
    contractVersion: "1.2.0",
    nativeApiVersion: discovery.apiVersion,
    engineVersion: discovery.engineVersion,
    protocolVersion: "0.2.0",
    utilityOnlyAddonLoading: true,
    capabilities: discovery.capabilities,
    packagedFiles: files.length,
    sourceMaps: 0,
  };
  const rendered = `${JSON.stringify(result, null, 2)}\n`;
  const evidencePath = process.env.AIGC_PROOF_BOUNDARY_EVIDENCE;
  if (evidencePath) {
    await fs.mkdir(path.dirname(evidencePath), { recursive: true });
    await fs.writeFile(evidencePath, rendered, "utf8");
  }
  console.log(rendered.trimEnd());
}

void main();
