import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import AdmZip from "adm-zip";

import { CdpClient, delay, waitFor } from "./cdp";

type Mode = "dev" | "packaged";
interface Launch {
  process: ChildProcess;
  cdp: CdpClient;
  protocol: string;
  executable: string;
}

const requireNative = createRequire(__filename);
const desktop = path.resolve(__dirname, "..");
const repo = path.resolve(desktop, "../..");
const workspaceRoot = path.resolve(repo, "..");
const mode = (process.argv
  .find((value) => value.startsWith("--mode="))
  ?.split("=")[1] ?? "dev") as Mode;
if (!(["dev", "packaged"] as const).includes(mode))
  throw new Error(`Unsupported mode: ${mode}`);

const evidence = path.resolve(
  process.env.AIGC_PROOF_QA_EVIDENCE ?? path.join(desktop, "qa-results", mode),
);
const userData = path.join(evidence, "user data");
const work = path.join(evidence, "工作 流程");
const proofWorkspace = path.join(work, "项目 工作区");
const existingTarget = path.join(work, "已存在 工作区");
const existingMarker = path.join(existingTarget, "用户 文件.txt");
const input = path.join(work, "输入 文件.txt");
const output = path.join(work, "输出 文件.txt");
const validPackage = path.join(work, "有效 包.aigcproof");
const tamperedPackage = path.join(work, "篡改 包.aigcproof");
const report = path.join(work, "验证 报告.json");
const addonPath = path.join(desktop, "native", "proof_napi.node");
const steps: Array<{ name: string; result: string; detail?: string }> = [];
let launch: Launch | undefined;
let testedExecutable = "";

function record(name: string, detail?: string): void {
  steps.push({ name, result: "PASS", ...(detail ? { detail } : {}) });
}

function js(value: unknown): string {
  return JSON.stringify(value);
}

async function setControl(
  cdp: CdpClient,
  testId: string,
  value: string,
): Promise<void> {
  await cdp.evaluate(`(() => {
    const element = document.querySelector('[data-testid=${js(testId)}]');
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) throw new Error('Control not found: ${testId}');
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    setter?.call(element, ${js(value)});
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
}

async function click(cdp: CdpClient, testId: string): Promise<void> {
  await cdp.evaluate(`(() => {
    const element = document.querySelector('[data-testid=${js(testId)}]');
    if (!(element instanceof HTMLButtonElement)) throw new Error('Button not found: ${testId}');
    element.click();
  })()`);
}

async function resultText(cdp: CdpClient): Promise<string> {
  return cdp.evaluate(
    `document.querySelector('[data-testid="result-text"]')?.textContent ?? ''`,
  );
}

async function controlText(cdp: CdpClient, testId: string): Promise<string> {
  return cdp.evaluate(
    `document.querySelector('[data-testid=${js(testId)}]')?.textContent ?? ''`,
  );
}

async function clickAndWait(
  cdp: CdpClient,
  testId: string,
  expected: string,
  timeout = 120_000,
): Promise<string> {
  await click(cdp, testId);
  return waitFor(
    () => resultText(cdp),
    (value) => value.includes(expected),
    `${testId} result containing ${expected}`,
    timeout,
  );
}

async function navigate(cdp: CdpClient, section: string): Promise<void> {
  await click(cdp, `nav-${section}`);
  await delay(100);
}

async function launchApp(port: number): Promise<Launch> {
  const executable =
    mode === "packaged"
      ? path.resolve(
          process.env.AIGC_PROOF_PACKAGED_EXE ??
            path.join(
              workspaceRoot,
              "app",
              "AIGC-Proof-Workbench",
              "AIGC-Proof.exe",
            ),
        )
      : path.join(desktop, "node_modules", "electron", "dist", "electron.exe");
  await fsp.access(executable);
  testedExecutable = executable;
  const args = [
    ...(mode === "dev" ? [desktop] : []),
    `--aigc-proof-qa-port=${port}`,
    `--user-data-dir=${userData}`,
  ];
  const stdout = fs.createWriteStream(
    path.join(evidence, `electron-${port}.stdout.log`),
  );
  const stderr = fs.createWriteStream(
    path.join(evidence, `electron-${port}.stderr.log`),
  );
  const child = spawn(executable, args, {
    cwd: mode === "dev" ? desktop : path.dirname(executable),
    env: {
      ...process.env,
      AIGC_PROOF_NATIVE_PATH: mode === "dev" ? addonPath : "",
      ELECTRON_ENABLE_LOGGING: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: false,
  });
  child.stdout?.pipe(stdout);
  child.stderr?.pipe(stderr);
  const earlyExit = new Promise<never>((_resolve, reject) =>
    child.once("exit", (code) =>
      reject(new Error(`Electron exited early with code ${code}.`)),
    ),
  );
  const cdp = await Promise.race([CdpClient.connect(port, 45_000), earlyExit]);
  await waitFor(
    () => cdp.evaluate("document.readyState"),
    (value) => value === "complete",
    "renderer ready state",
  );
  const protocol = await cdp.evaluate<string>("location.protocol");
  if (protocol !== "file:")
    throw new Error(`Production renderer did not load from file: ${protocol}`);
  const api = await cdp.evaluate<string>("typeof window.aigcProof");
  if (api !== "object") throw new Error("Typed preload API is unavailable.");
  const version = await cdp.evaluate<string>(
    `document.querySelector('[data-testid="workbench-version"]')?.textContent ?? ''`,
  );
  if (version !== "Workbench 0.1.1")
    throw new Error(`Unexpected Workbench version: ${version}`);
  return { process: child, cdp, protocol, executable };
}

async function closeApp(active: Launch): Promise<void> {
  await active.cdp
    .evaluate("window.aigcProof.closeApp()")
    .catch(() => undefined);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Electron did not exit cleanly.")),
      10_000,
    );
    active.process.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
  active.cdp.close();
}

async function main(): Promise<void> {
  await fsp.rm(evidence, { recursive: true, force: true });
  await fsp.mkdir(work, { recursive: true });
  await fsp.mkdir(existingTarget);
  await fsp.writeFile(existingMarker, "must remain unchanged", "utf8");
  await fsp.writeFile(input, "desktop bridge input", "utf8");
  await fsp.writeFile(output, "desktop bridge output", "utf8");

  launch = await launchApp(mode === "dev" ? 9321 : 9322);
  record("packaged-window-and-file-url", launch.protocol);
  const { cdp } = launch;
  await navigate(cdp, "workspace");
  await setControl(cdp, "create-parent", work);
  await setControl(cdp, "workspace-folder-name", "已存在 工作区");
  await waitFor(
    () => controlText(cdp, "workspace-target-preview"),
    (value) => value.includes("目标已存在，不会被修改"),
    "existing create target guidance",
  );
  const createDisabled = await cdp.evaluate<boolean>(
    `document.querySelector('[data-testid="init-workspace"]')?.hasAttribute('disabled') ?? false`,
  );
  if (!createDisabled)
    throw new Error("Existing workspace target did not disable creation.");
  if (
    (await fsp.readFile(existingMarker, "utf8")) !== "must remain unchanged"
  ) {
    throw new Error("Existing workspace target was modified.");
  }
  record("existing-target-safe-guidance");
  await fsp.writeFile(
    path.join(evidence, "workspace-create-existing-guidance.png"),
    await cdp.screenshot(),
  );

  await setControl(cdp, "workspace-folder-name", "项目 工作区");
  await waitFor(
    () => controlText(cdp, "workspace-target-preview"),
    (value) => value.includes(proofWorkspace),
    "new workspace target preview",
  );
  await setControl(cdp, "project-name", "AP-016 Electron 自动验收");
  await clickAndWait(cdp, "init-workspace", "工作区已创建");
  record("initialize-workspace");

  await setControl(cdp, "open-workspace-path", proofWorkspace);
  await clickAndWait(cdp, "open-workspace", "工作区已打开");
  record("open-existing-workspace-separate-flow");
  await cdp.evaluate(
    `document.querySelector('[data-testid="open-workspace"]')?.scrollIntoView({ block: "center" })`,
  );
  await delay(100);
  await fsp.writeFile(
    path.join(evidence, "workspace-created-and-opened.png"),
    await cdp.screenshot(),
  );

  for (const [source, role] of [
    [input, "input"],
    [output, "output"],
  ] as const) {
    await setControl(cdp, "asset-path", source);
    await setControl(cdp, "asset-role", role);
    await clickAndWait(cdp, "add-asset", "资产已添加");
  }
  record("add-input-output");

  await navigate(cdp, "event");
  await setControl(cdp, "event-type", "generation");
  await setControl(
    cdp,
    "event-payload",
    '{"model":"electron-cdp","prompt":"local-only"}',
  );
  await clickAndWait(cdp, "record-event", "事件已写入哈希链");
  record("record-event");

  await navigate(cdp, "seal");
  await setControl(cdp, "seal-output", validPackage);
  await clickAndWait(cdp, "seal-package", "证明包已封装");
  record("seal-package");
  await clickAndWait(cdp, "seal-package", "OUTPUT_ALREADY_EXISTS");
  record("seal-no-clobber");

  await navigate(cdp, "verify");
  await setControl(cdp, "package-path", validPackage);
  await clickAndWait(cdp, "verify-package", '"status": "valid"');
  record("verify-valid");
  await setControl(cdp, "report-path", report);
  await clickAndWait(cdp, "save-report", "验证报告已保存");
  await clickAndWait(cdp, "save-report", "REPORT_ALREADY_EXISTS");
  record("report-save-no-clobber");
  await clickAndWait(cdp, "inspect-package", "未执行完整性验证");
  record("inspect-metadata-only");

  const zip = new AdmZip(validPackage);
  const asset = zip
    .getEntries()
    .find((entry) => entry.entryName.startsWith("assets/"));
  if (!asset) throw new Error("Acceptance package had no asset to tamper.");
  const bytes = asset.getData();
  bytes[0] = (bytes[0] ?? 0) ^ 1;
  zip.updateFile(asset.entryName, bytes);
  zip.writeZip(tamperedPackage);
  await setControl(cdp, "package-path", tamperedPackage);
  await clickAndWait(cdp, "verify-package", '"status": "invalid"');
  record("tamper-rejection");
  await fsp.writeFile(
    path.join(evidence, "tamper-rejection.png"),
    await cdp.screenshot(),
  );

  await closeApp(launch);
  launch = undefined;
  record("clean-exit-first-run");

  launch = await launchApp(mode === "dev" ? 9323 : 9324);
  await navigate(launch.cdp, "home");
  const recentWorkspace = await launch.cdp.evaluate<string>(
    `document.querySelector('[data-testid="recent-workspaces"]')?.textContent ?? ''`,
  );
  const recentPackage = await launch.cdp.evaluate<string>(
    `document.querySelector('[data-testid="recent-packages"]')?.textContent ?? ''`,
  );
  if (
    !recentWorkspace.includes(proofWorkspace) ||
    !recentPackage.includes(validPackage)
  ) {
    throw new Error("SQLite recent items did not persist across restart.");
  }
  record("sqlite-restart-persistence");
  await navigate(launch.cdp, "settings");
  await clickAndWait(
    launch.cdp,
    "rebuild-recents",
    "最近项索引已从可携带文件重建",
  );
  record("sqlite-index-rebuild");
  await fsp.writeFile(
    path.join(evidence, "reopened-workbench.png"),
    await launch.cdp.screenshot(),
  );
  await closeApp(launch);
  launch = undefined;
  record("clean-exit-second-run");

  const database = path.join(userData, "workbench.sqlite3");
  const addon = requireNative(addonPath) as {
    getAppState(request: { database: string }): Promise<string>;
  };
  const persisted = JSON.parse(
    await addon.getAppState({ database }),
  ) as unknown;
  const evidenceObject = {
    result: "PASS",
    mode,
    workbenchVersion: "0.1.1",
    protocolVersion: "0.2.0",
    executable: testedExecutable,
    protocol: "file:",
    nativeAddon:
      mode === "dev"
        ? addonPath
        : path.join(
            workspaceRoot,
            "app",
            "AIGC-Proof-Workbench",
            "resources",
            "native",
            "proof_napi.node",
          ),
    database,
    workspace: proofWorkspace,
    package: validPackage,
    tamperedPackage,
    report,
    steps,
    persisted,
  };
  await fsp.writeFile(
    path.join(evidence, "qa-result.json"),
    `${JSON.stringify(evidenceObject, null, 2)}\n`,
    "utf8",
  );
  console.log(JSON.stringify({ result: "PASS", evidence }, null, 2));
}

main().catch(async (error) => {
  if (launch) {
    launch.process.kill();
    launch.cdp.close();
  }
  await fsp.mkdir(evidence, { recursive: true });
  await fsp.writeFile(
    path.join(evidence, "qa-failure.txt"),
    error instanceof Error ? (error.stack ?? error.message) : String(error),
    "utf8",
  );
  console.error(error);
  process.exitCode = 1;
});
