import fs from "node:fs/promises";
import path from "node:path";

import { extractFile, listPackage } from "@electron/asar";

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

async function main(): Promise<void> {
  await Promise.all([fs.access(executable), fs.access(asar), fs.access(addon)]);
  const files = listPackage(asar, { isPack: false }).map((file) =>
    file.replaceAll("\\", "/"),
  );
  for (const required of [
    "/dist/main/main.js",
    "/dist/preload/preload.js",
    "/dist/renderer/index.html",
  ]) {
    if (!files.includes(required)) {
      throw new Error(`Packaged app is missing ${required}.`);
    }
  }
  if (
    files.some((file) => file.endsWith(".map") || file.includes("qa-results"))
  ) {
    throw new Error("Package contains source maps or QA output.");
  }
  const mainSource = extractFile(asar, "dist\\main\\main.js").toString("utf8");
  const renderer = extractFile(asar, "dist\\renderer\\index.html").toString(
    "utf8",
  );
  const packagedManifest = JSON.parse(
    extractFile(asar, "package.json").toString("utf8"),
  ) as { version?: string };
  if (packagedManifest.version !== "0.1.1") {
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
  if (!renderer.includes("connect-src 'none'")) {
    throw new Error("Packaged renderer CSP is not offline-only.");
  }
  const result = {
    result: "PASS",
    packageRoot,
    executable,
    asar,
    addon,
    workbenchVersion: packagedManifest.version,
    protocolVersion: "0.2.0",
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
