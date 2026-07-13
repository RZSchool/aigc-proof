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
const reference = path.join(work, "参考 文件.txt");
const license = path.join(work, "许可 文件.txt");
const other = path.join(work, "其他 文件.txt");
const crashInput = path.join(work, "崩溃 恢复 输入.bin");
const validPackage = path.join(work, "有效 包.aigcproof");
const tamperedPackage = path.join(work, "篡改 包.aigcproof");
const malformedPackage = path.join(work, "损坏 包.aigcproof");
const report = path.join(work, "验证 报告.json");
const selectionManifest = path.join(evidence, "qa-selections.json");
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

async function controlValue(cdp: CdpClient, testId: string): Promise<string> {
  return cdp.evaluate(
    `document.querySelector('[data-testid=${js(testId)}]') instanceof HTMLInputElement ? document.querySelector('[data-testid=${js(testId)}]').value : ''`,
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
    `--qa-selection-manifest=${selectionManifest}`,
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
  if (version !== "Workbench 0.3.0")
    throw new Error(`Unexpected Workbench version: ${version}`);
  const qaApi = await cdp.evaluate<string>("typeof window.aigcProofQa");
  if (qaApi !== "object")
    throw new Error("Explicitly gated QA surface is unavailable.");
  return { process: child, cdp, protocol, executable };
}

async function captureLayoutEvidence(cdp: CdpClient): Promise<void> {
  for (const [width, height] of [
    [1320, 880],
    [1040, 720],
  ] as const) {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const layout = await cdp.evaluate<{
      horizontalOverflow: boolean;
      regions: number;
      navs: number;
      clippedActions: number;
    }>(`(() => ({
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      regions: document.querySelectorAll('[data-region]').length,
      navs: document.querySelectorAll('nav, .sidebar').length,
      clippedActions: [...document.querySelectorAll('button.primary')].filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width <= 0 || rect.right > document.documentElement.scrollWidth + 1;
      }).length,
    }))()`);
    if (
      layout.horizontalOverflow ||
      layout.regions !== 8 ||
      layout.navs !== 0 ||
      layout.clippedActions !== 0
    ) {
      throw new Error(
        `Unified layout failed at ${width}x${height}: ${JSON.stringify(layout)}`,
      );
    }
    const positions = [
      [
        "top",
        "document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, 0)",
      ],
      [
        "middle",
        "window.scrollTo(0, Math.max(0, document.documentElement.scrollHeight / 2 - innerHeight / 2))",
      ],
      ["lower", "window.scrollTo(0, document.documentElement.scrollHeight)"],
    ] as const;
    for (const [name, expression] of positions) {
      await cdp.evaluate(expression);
      await delay(100);
      await fsp.writeFile(
        path.join(evidence, `layout-${width}x${height}-${name}.png`),
        await cdp.screenshot(),
      );
    }
    record(`layout-${width}x${height}`, JSON.stringify(layout));
  }
  await cdp.send("Emulation.clearDeviceMetricsOverride");
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
  await fsp.writeFile(reference, "desktop bridge reference", "utf8");
  await fsp.writeFile(license, "desktop bridge license", "utf8");
  await fsp.writeFile(other, "desktop bridge other", "utf8");
  await fsp.writeFile(crashInput, Buffer.alloc(128 * 1024 * 1024, 0x61));
  await fsp.writeFile(malformedPackage, "not a zip package", "utf8");
  await fsp.writeFile(
    selectionManifest,
    `${JSON.stringify(
      {
        workspaceParents: [work],
        existingWorkspaces: [proofWorkspace],
        assets: [input, output, reference, license, other, crashInput],
        packages: [validPackage, tamperedPackage, malformedPackage],
        packageOutputs: [validPackage, validPackage],
        reportOutputs: [report, report],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  launch = await launchApp(mode === "dev" ? 9321 : 9322);
  record("packaged-window-and-file-url", launch.protocol);
  const { cdp } = launch;
  await captureLayoutEvidence(cdp);
  record("menu-free-unified-page");
  await click(cdp, "choose-create-parent");
  await waitFor(
    () => controlValue(cdp, "create-parent"),
    (value) => value.includes(work),
    "Host-issued workspace parent",
  );
  await setControl(cdp, "workspace-folder-name", "已存在 工作区");
  await waitFor(
    () => controlText(cdp, "workspace-target-preview"),
    (value) => value.includes("目标已存在且不会修改"),
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
  await setControl(cdp, "project-name", "AP-022 Electron 自动验收");
  await clickAndWait(cdp, "init-workspace", "工作区已创建");
  record("initialize-workspace");

  await click(cdp, "choose-open-workspace");
  await waitFor(
    () => controlValue(cdp, "open-workspace-path"),
    (value) => value.includes(proofWorkspace),
    "Host-issued existing workspace",
  );
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
    [reference, "reference"],
    [license, "license"],
    [other, "other"],
  ] as const) {
    await click(cdp, "choose-asset");
    await waitFor(
      () => controlValue(cdp, "asset-path"),
      (value) => value.includes(source),
      `Host-issued ${role} asset`,
    );
    await setControl(cdp, "asset-role", role);
    await clickAndWait(cdp, "add-asset", "资产已添加");
  }
  record("add-all-five-asset-roles");

  await setControl(cdp, "event-type", "generation");
  await setControl(
    cdp,
    "event-payload",
    '{"model":"electron-cdp","prompt":"local-only"}',
  );
  await clickAndWait(cdp, "record-event", "事件已写入哈希链");
  record("record-event");

  await click(cdp, "choose-package-output");
  await waitFor(
    () => controlValue(cdp, "seal-output"),
    (value) => value.includes(validPackage),
    "Host-issued package output",
  );
  await clickAndWait(cdp, "seal-package", "证明包已封装");
  record("seal-package");
  await click(cdp, "choose-package-output");
  await waitFor(
    () => controlValue(cdp, "seal-output"),
    (value) => value.includes(validPackage),
    "Host-issued duplicate package output",
  );
  await clickAndWait(cdp, "seal-package", "OUTPUT_ALREADY_EXISTS");
  record("seal-no-clobber");

  await click(cdp, "choose-package");
  await waitFor(
    () => controlValue(cdp, "package-path"),
    (value) => value.includes(validPackage),
    "Host-issued valid package",
  );
  await clickAndWait(cdp, "verify-package", '"status": "valid"');
  record("verify-valid");
  await click(cdp, "choose-report-output");
  await waitFor(
    () => controlValue(cdp, "report-path"),
    (value) => value.includes(report),
    "Host-issued report output",
  );
  await clickAndWait(cdp, "save-report", "验证报告已保存");
  await click(cdp, "choose-report-output");
  await waitFor(
    () => controlValue(cdp, "report-path"),
    (value) => value.includes(report),
    "Host-issued duplicate report output",
  );
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
  await click(cdp, "choose-package");
  await waitFor(
    () => controlValue(cdp, "package-path"),
    (value) => value.includes(tamperedPackage),
    "Host-issued tampered package",
  );
  await clickAndWait(cdp, "verify-package", '"status": "invalid"');
  record("tamper-rejection");
  await fsp.writeFile(
    path.join(evidence, "tamper-rejection.png"),
    await cdp.screenshot(),
  );
  await click(cdp, "choose-package");
  await waitFor(
    () => controlValue(cdp, "package-path"),
    (value) => value.includes(malformedPackage),
    "Host-issued malformed package",
  );
  const malformedResult = await clickAndWait(
    cdp,
    "verify-package",
    '"status": "invalid"',
  );
  if (!malformedResult.includes('"code": "MALFORMED_ZIP"')) {
    throw new Error("Malformed package did not report MALFORMED_ZIP.");
  }
  record("malformed-package-rejection");

  const beforeCrash = await cdp.evaluate<{
    generation: number;
    processId?: number;
  }>(
    `(async () => {
      const diagnostics = await window.aigcProof.getDiagnostics();
      if (!diagnostics.ok) throw new Error(diagnostics.error.code);
      return diagnostics.data.utility;
    })()`,
  );
  const crashJobs = await cdp.evaluate<{
    runningId: string;
    queuedId: string;
  }>(`(async () => {
    const state = await window.aigcProof.getState();
    if (!state.ok || !state.data.recentWorkspaces[0]) throw new Error('Recent workspace unavailable.');
    const asset = await window.aigcProof.chooseAsset();
    if (!asset) throw new Error('Crash-test asset unavailable.');
    const started = await window.aigcProof.startJob({
      operation: 'addAsset',
      input: {
        workspace: state.data.recentWorkspaces[0].reference,
        source: asset,
        role: 'other',
      },
    });
    if (!started.ok) throw new Error(started.error.code);
    const queued = await window.aigcProof.startJob({
      operation: 'loadWorkspace',
      input: { workspace: state.data.recentWorkspaces[0].reference },
    });
    if (!queued.ok) throw new Error(queued.error.code);
    const cancelled = await window.aigcProof.cancelJob({ job: queued.data.reference });
    if (!cancelled.ok || cancelled.data.state !== 'cancelled') throw new Error('Queued cancellation failed.');
    return { runningId: started.data.reference.id, queuedId: queued.data.reference.id };
  })()`);
  await waitFor(
    () =>
      cdp.evaluate<{ running?: string; queued?: string }>(`(async () => {
        const jobs = await window.aigcProof.getJobs();
        if (!jobs.ok) throw new Error(jobs.error.code);
        return {
          running: jobs.data.find((job) => job.reference.id === ${js(crashJobs.runningId)})?.state,
          queued: jobs.data.find((job) => job.reference.id === ${js(crashJobs.queuedId)})?.state,
        };
      })()`),
    (value) => value.running === "running" && value.queued === "cancelled",
    "running job and queued cancellation",
  );
  const cancelRequested = await cdp.evaluate<string>(`(async () => {
    const jobs = await window.aigcProof.getJobs();
    if (!jobs.ok) throw new Error(jobs.error.code);
    const running = jobs.data.find((job) => job.reference.id === ${js(crashJobs.runningId)});
    if (!running) throw new Error('Running job missing.');
    const cancelled = await window.aigcProof.cancelJob({ job: running.reference });
    if (!cancelled.ok) throw new Error(cancelled.error.code);
    return cancelled.data.state;
  })()`);
  if (cancelRequested !== "cancel_requested") {
    throw new Error(`Running cancellation was not honest: ${cancelRequested}`);
  }
  record("queued-cancel-and-running-cancel-request", JSON.stringify(crashJobs));
  await cdp.evaluate("window.aigcProofQa.crashUtility()");
  const crashedJobId = crashJobs.runningId;
  const crashedJob = await waitFor(
    () =>
      cdp.evaluate<{ state?: string; code?: string }>(`(async () => {
        const jobs = await window.aigcProof.getJobs();
        if (!jobs.ok) throw new Error(jobs.error.code);
        const job = jobs.data.find((candidate) => candidate.reference.id === ${js(crashedJobId)});
        return { state: job?.state, code: job?.error?.code };
      })()`),
    (value) => value.state === "failed",
    "Utility crash converted to failed job",
  );
  if (crashedJob.code !== "UTILITY_PROCESS_LOST") {
    throw new Error(
      `Utility crash had unexpected code ${crashedJob.code ?? "missing"}.`,
    );
  }
  const otherAssetDirectory = path.join(proofWorkspace, "assets", "other");
  const leftovers = (await fsp.readdir(otherAssetDirectory)).filter((name) =>
    name.startsWith(".aigc-proof-asset-"),
  );
  if (leftovers.length > 0) {
    throw new Error(
      `Utility crash left temporary asset files: ${leftovers.join(", ")}`,
    );
  }
  record("utility-crash-no-replay-and-cleanup", crashedJobId);

  await clickAndWait(cdp, "rebuild-recents", "最近项索引已从可携带文件重建");
  const afterCrash = await cdp.evaluate<{
    state: string;
    generation: number;
    processId?: number;
  }>(
    `(async () => {
      const diagnostics = await window.aigcProof.getDiagnostics();
      if (!diagnostics.ok) throw new Error(diagnostics.error.code);
      return diagnostics.data.utility;
    })()`,
  );
  if (
    afterCrash.state !== "healthy" ||
    afterCrash.generation <= beforeCrash.generation ||
    afterCrash.processId === beforeCrash.processId
  ) {
    throw new Error(
      `Utility did not restart safely: ${JSON.stringify({ beforeCrash, afterCrash })}`,
    );
  }
  record(
    "utility-compatible-restart",
    JSON.stringify({ beforeCrash, afterCrash }),
  );

  const diagnostics = await controlText(cdp, "diagnostics-card");
  for (const expected of [
    "0.2.0",
    "1.1.0",
    "integration.aigcstudio",
    "execution.utility-process",
    "operation.safe-cancellation",
  ]) {
    if (!diagnostics.includes(expected))
      throw new Error(`Diagnostics omitted ${expected}.`);
  }
  record("version-capability-diagnostics");
  await fsp.writeFile(
    path.join(evidence, "capability-diagnostics.png"),
    await cdp.screenshot(),
  );

  await closeApp(launch);
  launch = undefined;
  record("clean-exit-first-run");

  launch = await launchApp(mode === "dev" ? 9323 : 9324);
  await waitFor(
    () =>
      launch!.cdp.evaluate<string>(
        `document.querySelector('[data-testid="recent-workspaces"]')?.textContent ?? ''`,
      ),
    (value) => value.includes(proofWorkspace),
    "persisted recent workspace",
  );
  await waitFor(
    () =>
      launch!.cdp.evaluate<string>(
        `document.querySelector('[data-testid="recent-packages"]')?.textContent ?? ''`,
      ),
    (value) => value.includes(validPackage),
    "persisted recent package",
  );
  record("sqlite-restart-persistence");
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
  await fsp.writeFile(database, "corrupt disposable state", "utf8");
  launch = await launchApp(mode === "dev" ? 9325 : 9326);
  const recoveryState = await launch.cdp.evaluate<unknown>(`(async () => {
    const state = await window.aigcProof.getState();
    if (!state.ok) throw new Error(state.error.code);
    return state.data;
  })()`);
  const recoveredFiles = (await fsp.readdir(userData)).filter((name) =>
    name.startsWith("workbench.sqlite3.corrupt-"),
  );
  if (recoveredFiles.length === 0) {
    throw new Error(
      "Corrupt disposable SQLite state was not isolated and rebuilt.",
    );
  }
  await closeApp(launch);
  launch = undefined;
  record("sqlite-corruption-recovery", recoveredFiles.join(","));

  const testedAddon =
    mode === "dev"
      ? addonPath
      : path.join(
          workspaceRoot,
          "app",
          "AIGC-Proof-Workbench",
          "resources",
          "native",
          "proof_napi.node",
        );
  const addon = requireNative(testedAddon) as { getApiInfo(): unknown };
  const nativeDiscovery = addon.getApiInfo();
  await fsp.rm(crashInput, { force: true });
  const evidenceObject = {
    result: "PASS",
    mode,
    workbenchVersion: "0.3.0",
    contractVersion: "1.1.0",
    nativeApiVersion: "1.1.0",
    engineVersion: "0.2.0",
    protocolVersion: "0.2.0",
    executable: testedExecutable,
    protocol: "file:",
    nativeAddon: testedAddon,
    database,
    workspace: proofWorkspace,
    package: validPackage,
    tamperedPackage,
    report,
    nativeDiscovery,
    steps,
    recoveryState,
    recoveredFiles,
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
