import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
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
const secondProofWorkspace = path.join(work, "第二 工作区");
const existingTarget = path.join(work, "已存在 工作区");
const existingMarker = path.join(existingTarget, "用户 文件.txt");
const input = path.join(work, "输入 文件.txt");
const output = path.join(work, "输出 文件.txt");
const reference = path.join(work, "参考 文件.txt");
const license = path.join(work, "许可 文件.txt");
const other = path.join(work, "其他 文件.txt");
const manualInputImage = path.join(work, "手动 输入 图片.png");
const crashInput = path.join(work, "崩溃 恢复 输入.bin");
const validPackage = path.join(work, "有效 包.aigcproof");
const tamperedPackage = path.join(work, "篡改 包.aigcproof");
const malformedPackage = path.join(work, "损坏 包.aigcproof");
const report = path.join(work, "验证 报告.json");
const creationPackage = path.join(work, "创作 证明包.aigcproof");
const creationReport = path.join(work, "创作 验证报告.json");
const exportedImage = path.join(work, "保存 生成图片.png");
const mutatedImage = path.join(work, "修改后 生成图片.png");
const reopenedExportedImage = path.join(work, "重启后 生成图片.png");
const cliReport = path.join(work, "CLI 独立验证报告.json");
const comfyUiInstallation = path.resolve(
  process.env.AIGC_PROOF_COMFYUI_DIR ??
    path.join(workspaceRoot, "..", "ComfyUI_windows_portable"),
);
const selectionManifest = path.join(evidence, "qa-selections.json");
const addonPath = path.join(desktop, "native", "proof_napi.node");
const qaSignerService = `org.aigcproof.qa.ap031-${process.pid}`;
const qaSignerTarget = `current-user.${qaSignerService}`;
const steps: Array<{ name: string; result: string; detail?: string }> = [];
let launch: Launch | undefined;
let testedExecutable = "";

function record(name: string, detail?: string): void {
  steps.push({ name, result: "PASS", ...(detail ? { detail } : {}) });
}

function js(value: unknown): string {
  return JSON.stringify(value);
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function runProcess(
  executable: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: repo, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else
        reject(
          new Error(
            `${path.basename(executable)} exited ${code}: ${stderr || stdout}`,
          ),
        );
    });
  });
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

async function setChecked(
  cdp: CdpClient,
  testId: string,
  checked: boolean,
): Promise<void> {
  await cdp.evaluate(`(() => {
    const element = document.querySelector('[data-testid=${js(testId)}]');
    if (!(element instanceof HTMLInputElement) || element.type !== 'checkbox') throw new Error('Checkbox not found: ${testId}');
    if (element.checked !== ${checked}) element.click();
    if (element.checked !== ${checked}) throw new Error('Checkbox did not reach the requested state: ${testId}');
  })()`);
}

async function cleanupQaSigner(): Promise<void> {
  await runProcess("cmdkey.exe", [`/delete:${qaSignerTarget}`]);
}

async function click(cdp: CdpClient, testId: string): Promise<void> {
  await cdp.evaluate(`(() => {
    const element = document.querySelector('[data-testid=${js(testId)}]');
    if (!(element instanceof HTMLButtonElement)) throw new Error('Button not found: ${testId}');
    if (element.disabled) throw new Error('Button is disabled: ${testId}');
    element.click();
  })()`);
}

async function clickButtonContaining(
  cdp: CdpClient,
  containerTestId: string,
  text: string,
): Promise<void> {
  await cdp.evaluate(`(() => {
    const container = document.querySelector('[data-testid=${js(containerTestId)}]');
    if (!container) throw new Error('Container not found: ${containerTestId}');
    const button = [...container.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes(${js(text)}));
    if (!(button instanceof HTMLButtonElement)) throw new Error('Button containing text not found: ${text}');
    button.click();
  })()`);
}

async function inspectWorkflowStructure(cdp: CdpClient): Promise<void> {
  const structure = await cdp.evaluate<{
    advancedClosed: boolean;
    advancedLast: boolean;
    stepBadges: string[];
    completeActionText: string;
    completeActionPrimary: boolean;
    manualSealSecondary: boolean;
  }>(`(() => {
    const advanced = document.querySelector('[data-region="manual-proof-tools"]');
    const regions = [...document.querySelectorAll('#root main > [data-region]')];
    const complete = document.querySelector('[data-testid="complete-creation-proof"]');
    const manualSeal = document.querySelector('[data-testid="seal-package"]');
    return {
      advancedClosed: advanced instanceof HTMLDetailsElement && !advanced.open,
      advancedLast: advanced instanceof HTMLElement && Number.parseInt(getComputedStyle(advanced).order, 10) > Math.max(...regions.filter((region) => region !== advanced).map((region) => Number.parseInt(getComputedStyle(region).order, 10) || 0)),
      stepBadges: [...document.querySelectorAll('.panel-title > span')].map((item) => item.textContent ?? ''),
      completeActionText: complete?.textContent ?? '',
      completeActionPrimary: complete?.classList.contains('primary') ?? false,
      manualSealSecondary: manualSeal?.classList.contains('secondary') ?? false,
    };
  })()`);
  if (
    !structure.advancedClosed ||
    !structure.advancedLast ||
    JSON.stringify(structure.stepBadges) !==
      JSON.stringify(["01", "02", "03"]) ||
    !structure.completeActionText.includes("封装 → 验证 → 保存报告") ||
    !structure.completeActionPrimary ||
    !structure.manualSealSecondary
  ) {
    throw new Error(
      `Workflow structure is invalid: ${JSON.stringify(structure)}`,
    );
  }
  record(
    "creation-first-and-manual-tools-collapsed",
    JSON.stringify(structure),
  );
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

async function waitForEnabled(
  cdp: CdpClient,
  testId: string,
  timeout = 30_000,
): Promise<void> {
  await waitFor(
    () =>
      cdp.evaluate<boolean>(
        `document.querySelector('[data-testid=${js(testId)}]') instanceof HTMLButtonElement && !document.querySelector('[data-testid=${js(testId)}]').disabled`,
      ),
    (enabled) => enabled,
    `${testId} to become enabled`,
    timeout,
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

async function confirmClickAndWait(
  cdp: CdpClient,
  testId: string,
  expected: string,
  timeout = 120_000,
): Promise<string> {
  const dialog = cdp.waitForEvent<{ message?: string }>(
    "Page.javascriptDialogOpening",
    timeout,
  );
  const clicking = click(cdp, testId);
  await dialog;
  await cdp.send("Page.handleJavaScriptDialog", { accept: true });
  await clicking;
  return waitFor(
    () => resultText(cdp),
    (value) => value.includes(expected),
    `${testId} confirmed result containing ${expected}`,
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
      AIGC_PROOF_QA_SIGNER_SERVICE: qaSignerService,
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
  if (version !== "Workbench 0.6.0")
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
      layout.regions !== 10 ||
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
  await cleanupQaSigner().catch(() => undefined);
  await fsp.rm(evidence, { recursive: true, force: true });
  await fsp.mkdir(work, { recursive: true });
  await Promise.all([
    fsp.access(path.join(comfyUiInstallation, "python_embeded", "python.exe")),
    fsp.access(path.join(comfyUiInstallation, "ComfyUI", "main.py")),
    fsp.access(path.join(comfyUiInstallation, "ComfyUI", "LICENSE")),
  ]);
  await fsp.mkdir(existingTarget);
  await fsp.writeFile(existingMarker, "must remain unchanged", "utf8");
  await fsp.writeFile(input, "desktop bridge input", "utf8");
  await fsp.writeFile(output, "desktop bridge output", "utf8");
  await fsp.writeFile(reference, "desktop bridge reference", "utf8");
  await fsp.writeFile(license, "desktop bridge license", "utf8");
  await fsp.writeFile(other, "desktop bridge other", "utf8");
  await fsp.writeFile(
    manualInputImage,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  await fsp.writeFile(crashInput, Buffer.alloc(128 * 1024 * 1024, 0x61));
  await fsp.writeFile(malformedPackage, "not a zip package", "utf8");
  await fsp.writeFile(
    selectionManifest,
    `${JSON.stringify(
      {
        workspaceParents: [work],
        existingWorkspaces: [proofWorkspace, proofWorkspace],
        assets: [
          manualInputImage,
          input,
          output,
          reference,
          license,
          other,
          crashInput,
        ],
        images: [mutatedImage, manualInputImage, exportedImage, exportedImage],
        imageOutputs: [exportedImage, exportedImage],
        packages: [
          creationPackage,
          creationPackage,
          creationPackage,
          validPackage,
          tamperedPackage,
          malformedPackage,
          tamperedPackage,
          malformedPackage,
          validPackage,
        ],
        packageOutputs: [creationPackage, validPackage, validPackage],
        reportOutputs: [creationReport, report, report],
        providerInstallations: [comfyUiInstallation],
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
  await setControl(cdp, "signer-display-label", "AP-031 QA local creator");
  await clickAndWait(cdp, "create-signer", "本地签名身份已创建");
  const signerFingerprint = await controlValue(cdp, "signer-fingerprint");
  if (!/^[0-9a-f]{64}$/u.test(signerFingerprint.trim())) {
    throw new Error(
      `Local signer fingerprint is invalid: ${signerFingerprint}`,
    );
  }
  record("os-credential-signer-created", signerFingerprint.trim());
  await clickAndWait(cdp, "copy-signer-fingerprint", "完整 SHA-256 指纹已复制");
  record("signer-fingerprint-copied", signerFingerprint.trim());
  record("menu-free-unified-page");
  await inspectWorkflowStructure(cdp);
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
  await setControl(cdp, "project-name", "AP-027 工作区状态自动验收");
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

  await cdp.evaluate(`(() => {
    const advanced = document.querySelector('[data-region="manual-proof-tools"]');
    if (!(advanced instanceof HTMLDetailsElement)) throw new Error('Advanced proof tools are not a native details disclosure.');
    advanced.querySelector('summary')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    if (!advanced.open) throw new Error('Advanced proof tools did not open from its native summary.');
  })()`);
  record("manual-proof-tools-explicitly-opened");

  for (const [source, role] of [
    [manualInputImage, "input"],
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

  await click(cdp, "choose-provider");
  await waitFor(
    () => controlValue(cdp, "provider-path"),
    (value) => value.includes(comfyUiInstallation),
    "Host-issued ComfyUI installation",
  );
  await clickAndWait(
    cdp,
    "inspect-provider",
    "本地 ComfyUI 已通过冻结能力检查",
    120_000,
  );
  const providerText = await controlText(cdp, "provider-card");
  if (
    !providerText.includes("ComfyUI 0.27.0") ||
    !providerText.includes("GPL-3.0-only")
  ) {
    throw new Error(`Provider inventory is incomplete: ${providerText}`);
  }
  record("comfyui-v0.27.0-capability-license-inspection", providerText);

  await setControl(cdp, "creation-title", "AP-027 真实本地创作");
  await clickAndWait(cdp, "create-creation-session", "创作会话已创建");
  await setControl(
    cdp,
    "creation-prompt",
    "a small red paper boat on a quiet lake, minimal composition",
  );
  await setControl(cdp, "creation-negative-prompt", "text, watermark, logo");
  await setControl(cdp, "creation-seed", "240724");
  await setControl(cdp, "creation-width", "512");
  await setControl(cdp, "creation-height", "512");
  await setControl(cdp, "creation-steps", "12");
  await setControl(cdp, "creation-cfg", "7");
  await setControl(cdp, "creation-disclosure", "included");
  await clickAndWait(cdp, "freeze-creation-session", "创作快照已冻结");
  record("immutable-creation-snapshot-frozen");
  await clickAndWait(
    cdp,
    "run-creation-session",
    "生成输出已自动接入",
    10 * 60 * 1000,
  );
  const creationOutputText = await controlText(cdp, "creation-output");
  if (!creationOutputText.includes("自动加入证明工作区")) {
    throw new Error("Generated output was not automatically ingested.");
  }
  record("real-comfyui-output-auto-ingested", creationOutputText);

  await click(cdp, "choose-creation-package-output");
  await waitFor(
    () => controlValue(cdp, "creation-package-path"),
    (value) => value.includes(creationPackage),
    "Host-issued creation package output",
  );
  await click(cdp, "choose-creation-report-output");
  await waitFor(
    () => controlValue(cdp, "creation-report-path"),
    (value) => value.includes(creationReport),
    "Host-issued creation report output",
  );
  await setChecked(cdp, "confirm-creation-signature", true);
  await waitForEnabled(cdp, "complete-creation-proof");
  await clickAndWait(
    cdp,
    "complete-creation-proof",
    "创作证明已完成并独立验证",
    180_000,
  );
  await Promise.all([fsp.access(creationPackage), fsp.access(creationReport)]);
  const completedCreation = await cdp.evaluate<{
    state: string;
    status?: string;
    output?: string;
    snapshot?: string;
    checkpoint?: string;
    providerVersion?: string;
    preview: boolean;
    proofId?: string;
  }>(`(async () => {
    const state = await window.aigcProof.getState();
    const workspace = state.ok ? state.data.recentWorkspaces.find((item) => item.displayPath === ${js(proofWorkspace)}) : undefined;
    if (!workspace) throw new Error('Current workspace reference missing.');
    const sessions = await window.aigcProof.getCreationSessions({ workspace: workspace.reference });
    if (!sessions.ok || !sessions.data[0]) throw new Error('Creation session missing.');
    return {
      state: sessions.data[0].state,
      status: sessions.data[0].verification?.status,
      output: sessions.data[0].output?.sha256,
      snapshot: sessions.data[0].snapshot?.snapshot_sha256,
      checkpoint: sessions.data[0].snapshot?.checkpoint_observation,
      providerVersion: sessions.data[0].providerVersion,
      preview: Boolean(sessions.data[0].output?.previewDataUrl),
      proofId: sessions.data[0].verification?.proof_id,
    };
  })()`);
  if (
    completedCreation.state !== "complete" ||
    completedCreation.status !== "valid" ||
    !completedCreation.output ||
    !completedCreation.snapshot ||
    completedCreation.providerVersion !== "0.27.0" ||
    !completedCreation.preview ||
    !completedCreation.proofId
  ) {
    throw new Error(
      `Creation proof completion is invalid: ${JSON.stringify(completedCreation)}`,
    );
  }
  await cdp.evaluate(
    `document.querySelector('[data-testid="creation-review"]')?.scrollIntoView({ block: "center" })`,
  );
  await delay(100);
  await fsp.writeFile(
    path.join(evidence, "creation-proof-complete.png"),
    await cdp.screenshot(),
  );
  record("creation-seal-verify-report", JSON.stringify(completedCreation));
  const signatureEvidence = await controlText(cdp, "signature-evidence");
  for (const expected of [
    "AP-031 QA local creator",
    signerFingerprint.trim(),
    "aigc-proof.creator-signature.cose-ed25519.v1",
    "自我声明",
  ]) {
    if (!signatureEvidence.includes(expected)) {
      throw new Error(`Creator signature evidence omitted ${expected}.`);
    }
  }
  record("creator-signature-evidence-is-truthful", signatureEvidence);

  await setControl(cdp, "signer-display-label", "AP-031 QA rotated creator");
  await confirmClickAndWait(cdp, "rotate-signer", "本地签名密钥已轮换");
  const rotatedSignerFingerprint = (
    await controlValue(cdp, "signer-fingerprint")
  ).trim();
  if (
    !/^[0-9a-f]{64}$/u.test(rotatedSignerFingerprint) ||
    rotatedSignerFingerprint === signerFingerprint.trim()
  ) {
    throw new Error(
      `Rotated signer fingerprint is invalid: ${rotatedSignerFingerprint}`,
    );
  }
  record("os-credential-signer-rotated", rotatedSignerFingerprint);

  await click(cdp, "choose-package");
  await waitFor(
    () => controlValue(cdp, "package-path"),
    (value) => value.includes(creationPackage),
    "Host-issued pre-rotation package",
  );
  const historicalVerification = await clickAndWait(
    cdp,
    "verify-package",
    '"digital_signature": "valid_untrusted"',
  );
  if (!historicalVerification.includes('"status": "valid"')) {
    throw new Error("Pre-rotation package lost cryptographic validity.");
  }
  record("pre-rotation-package-remains-valid-untrusted");

  await clickAndWait(
    cdp,
    "export-creation-output",
    "生成图片副本已保存，可直接与证明包核验",
  );
  const exportedBytes = await fsp.readFile(exportedImage);
  const exportedDigest = sha256(exportedBytes);
  if (exportedDigest !== completedCreation.output) {
    throw new Error(
      `Exported image digest ${exportedDigest} differs from recorded output ${completedCreation.output}.`,
    );
  }
  record("creation-output-visible-and-exact-export", exportedDigest);
  await clickAndWait(cdp, "export-creation-output", "OUTPUT_ALREADY_EXISTS");
  record("creation-output-export-no-clobber");
  await clickAndWait(
    cdp,
    "match-image-package",
    "图片与有效证明包中的生成输出完全一致",
  );
  const matchedOutputCard = await controlText(cdp, "image-match-result");
  if (
    !matchedOutputCard.includes("图片与包内生成输出完全一致") ||
    !matchedOutputCard.includes("output") ||
    !matchedOutputCard.includes(completedCreation.proofId)
  ) {
    throw new Error(
      `Output-match result card is incomplete: ${matchedOutputCard}`,
    );
  }
  await cdp.evaluate(
    `document.querySelector('[data-testid="image-match-result"]')?.scrollIntoView({ block: "center" })`,
  );
  await delay(100);
  await fsp.writeFile(
    path.join(evidence, "image-output-match.png"),
    await cdp.screenshot(),
  );
  record("exported-image-verified-output-match", matchedOutputCard);

  await setControl(cdp, "creation-title", "AP-027 新建空白会话");
  await clickAndWait(cdp, "create-creation-session", "创作会话已创建");
  const freshSessionState = await cdp.evaluate<{
    state: string;
    outputPresent: boolean;
    packagePath: string;
    imagePath: string;
    reportPresent: boolean;
    imageResultPresent: boolean;
  }>(`(() => ({
    state: document.querySelector('[data-testid="creation-state"]')?.textContent ?? '',
    outputPresent: Boolean(document.querySelector('[data-testid="creation-output"]')),
    packagePath: document.querySelector('[data-testid="package-path"]') instanceof HTMLInputElement ? document.querySelector('[data-testid="package-path"]').value : '',
    imagePath: document.querySelector('[data-testid="image-path"]') instanceof HTMLInputElement ? document.querySelector('[data-testid="image-path"]').value : '',
    reportPresent: Boolean(document.querySelector('[data-testid="verification-card"]')),
    imageResultPresent: Boolean(document.querySelector('[data-testid="image-match-result"]')),
  }))()`);
  if (
    !freshSessionState.state.includes("draft") ||
    freshSessionState.outputPresent ||
    freshSessionState.packagePath ||
    freshSessionState.imagePath ||
    freshSessionState.reportPresent ||
    freshSessionState.imageResultPresent
  ) {
    throw new Error(
      `New creation session retained stale state: ${JSON.stringify(freshSessionState)}`,
    );
  }
  record(
    "new-session-clears-previous-proof-state",
    JSON.stringify(freshSessionState),
  );

  await clickButtonContaining(cdp, "creation-sessions", "AP-027 真实本地创作");
  await waitFor(
    () => controlText(cdp, "creation-output"),
    (value) => value.includes("自动加入证明工作区"),
    "explicit historical creation restore",
  );
  const restoredSessionState = await cdp.evaluate<{
    packagePath: string;
    imagePath: string;
    reportPresent: boolean;
  }>(`(() => ({
    packagePath: document.querySelector('[data-testid="package-path"]') instanceof HTMLInputElement ? document.querySelector('[data-testid="package-path"]').value : '',
    imagePath: document.querySelector('[data-testid="image-path"]') instanceof HTMLInputElement ? document.querySelector('[data-testid="image-path"]').value : '',
    reportPresent: Boolean(document.querySelector('[data-testid="verification-card"]')),
  }))()`);
  if (
    !restoredSessionState.packagePath.includes(creationPackage) ||
    restoredSessionState.imagePath ||
    !restoredSessionState.reportPresent
  ) {
    throw new Error(
      `Explicit historical restore did not isolate image state: ${JSON.stringify(restoredSessionState)}`,
    );
  }
  record(
    "explicit-history-restores-proof-without-image-prefill",
    JSON.stringify(restoredSessionState),
  );

  await fsp.copyFile(exportedImage, mutatedImage);
  await fsp.appendFile(mutatedImage, Buffer.from([0]));
  await click(cdp, "choose-image");
  await waitFor(
    () => controlValue(cdp, "image-path"),
    (value) => value.includes(mutatedImage),
    "Host-issued mutated image",
  );
  await click(cdp, "choose-image-package");
  await waitFor(
    () => controlValue(cdp, "image-package-path"),
    (value) => value.includes(creationPackage),
    "Host-issued creation package for mismatch",
  );
  await clickAndWait(cdp, "match-image-package", "图片不在该证明包中");
  record("mutated-image-not-in-package");

  await click(cdp, "choose-image");
  await waitFor(
    () => controlValue(cdp, "image-path"),
    (value) => value.includes(manualInputImage),
    "Host-issued non-output image",
  );
  await click(cdp, "choose-image-package");
  await waitFor(
    () => controlValue(cdp, "image-package-path"),
    (value) => value.includes(creationPackage),
    "Host-issued creation package for non-output match",
  );
  await clickAndWait(
    cdp,
    "match-image-package",
    "文件存在于包中，但不是生成输出",
  );
  record("matched-non-output-distinction");

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
  await setChecked(cdp, "confirm-seal-signature", true);
  await waitForEnabled(cdp, "seal-package");
  await clickAndWait(cdp, "seal-package", "证明包已封装");
  record("seal-package");
  await click(cdp, "choose-package-output");
  await waitFor(
    () => controlValue(cdp, "seal-output"),
    (value) => value.includes(validPackage),
    "Host-issued duplicate package output",
  );
  await setChecked(cdp, "confirm-seal-signature", true);
  await waitForEnabled(cdp, "seal-package");
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

  const zip = new AdmZip(creationPackage);
  const signature = zip.getEntry("security/signatures/creator.cose");
  if (!signature)
    throw new Error("Acceptance package had no creator signature to tamper.");
  const bytes = signature.getData();
  const lastIndex = bytes.length - 1;
  bytes[lastIndex] = (bytes[lastIndex] ?? 0) ^ 1;
  zip.updateFile(signature.entryName, bytes);
  zip.writeZip(tamperedPackage);
  await click(cdp, "choose-package");
  await waitFor(
    () => controlValue(cdp, "package-path"),
    (value) => value.includes(tamperedPackage),
    "Host-issued tampered package",
  );
  const tamperedResult = await clickAndWait(
    cdp,
    "verify-package",
    '"status": "invalid"',
  );
  if (!tamperedResult.includes('"code": "CREATOR_SIGNATURE_INVALID"')) {
    throw new Error(
      "Creator signature tampering did not report CREATOR_SIGNATURE_INVALID.",
    );
  }
  record("creator-signature-tamper-rejection");
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

  for (const [selectedPackage, expectedLabel] of [
    [tamperedPackage, "tampered"],
    [malformedPackage, "malformed"],
  ] as const) {
    await click(cdp, "choose-image");
    await waitFor(
      () => controlValue(cdp, "image-path"),
      (value) => value.includes(exportedImage),
      `Host-issued image for ${expectedLabel} package`,
    );
    await click(cdp, "choose-image-package");
    await waitFor(
      () => controlValue(cdp, "image-package-path"),
      (value) => value.includes(selectedPackage),
      `Host-issued ${expectedLabel} package for image matching`,
    );
    await clickAndWait(
      cdp,
      "match-image-package",
      "证明包无效，未作图片对应性判断",
    );
    const invalidCard = await controlText(cdp, "image-match-result");
    if (!invalidCard.includes("证明包无效，不能判断图片对应关系")) {
      throw new Error(
        `${expectedLabel} package produced an unexpected image result: ${invalidCard}`,
      );
    }
    record(`${expectedLabel}-package-no-image-match-claim`);
  }

  await confirmClickAndWait(cdp, "disable-signer", "本地签名身份已禁用");
  if ((await controlText(cdp, "signer-state")).trim() !== "disabled") {
    throw new Error("Disabled signer state was not rendered truthfully.");
  }
  await click(cdp, "choose-package");
  await waitFor(
    () => controlValue(cdp, "package-path"),
    (value) => value.includes(validPackage),
    "Host-issued package signed by disabled key",
  );
  const disabledKeyVerification = await clickAndWait(
    cdp,
    "verify-package",
    '"digital_signature": "disabled"',
  );
  if (!disabledKeyVerification.includes('"status": "valid"')) {
    throw new Error("Disabled signer caused historical signature rejection.");
  }
  record("disabled-key-package-remains-cryptographically-valid");

  await setControl(cdp, "workspace-folder-name", "第二 工作区");
  await setControl(cdp, "project-name", "AP-027 工作区 B");
  await waitFor(
    () => controlText(cdp, "workspace-target-preview"),
    (value) => value.includes(secondProofWorkspace),
    "second workspace target preview",
  );
  await clickAndWait(cdp, "init-workspace", "工作区已创建，创作状态已重置");
  const secondWorkspaceState = await cdp.evaluate<{
    sessionList: string;
    creationReviewPresent: boolean;
    packagePath: string;
    imagePath: string;
    reportPresent: boolean;
  }>(`(() => ({
    sessionList: document.querySelector('[data-testid="creation-sessions"]')?.textContent ?? '',
    creationReviewPresent: Boolean(document.querySelector('[data-testid="creation-review"]')),
    packagePath: document.querySelector('[data-testid="package-path"]') instanceof HTMLInputElement ? document.querySelector('[data-testid="package-path"]').value : '',
    imagePath: document.querySelector('[data-testid="image-path"]') instanceof HTMLInputElement ? document.querySelector('[data-testid="image-path"]').value : '',
    reportPresent: Boolean(document.querySelector('[data-testid="verification-card"]')),
  }))()`);
  if (
    !secondWorkspaceState.sessionList.includes("当前工作区暂无历史创作会话") ||
    secondWorkspaceState.sessionList.includes("AP-027 真实本地创作") ||
    secondWorkspaceState.creationReviewPresent ||
    secondWorkspaceState.packagePath ||
    secondWorkspaceState.imagePath ||
    secondWorkspaceState.reportPresent
  ) {
    throw new Error(
      `Workspace B inherited workspace A state: ${JSON.stringify(secondWorkspaceState)}`,
    );
  }
  record(
    "workspace-b-starts-with-empty-creation-scope",
    JSON.stringify(secondWorkspaceState),
  );

  await setControl(cdp, "creation-title", "AP-027 B 空白会话");
  await clickAndWait(cdp, "create-creation-session", "创作会话已创建");
  const secondWorkspaceSessions = await controlText(cdp, "creation-sessions");
  if (
    !secondWorkspaceSessions.includes("AP-027 B 空白会话") ||
    secondWorkspaceSessions.includes("AP-027 真实本地创作")
  ) {
    throw new Error(
      `Workspace B session list leaked another workspace: ${secondWorkspaceSessions}`,
    );
  }
  record("workspace-b-session-list-is-scoped");

  await click(cdp, "choose-open-workspace");
  await waitFor(
    () => controlValue(cdp, "open-workspace-path"),
    (value) => value.includes(proofWorkspace),
    "Host-issued workspace A for scope return",
  );
  await clickAndWait(cdp, "open-workspace", "工作区已打开，创作状态已重置");
  await waitFor(
    () => controlText(cdp, "creation-sessions"),
    (value) => value.includes("AP-027 真实本地创作"),
    "workspace A scoped session list",
  );
  const returnedWorkspaceState = await cdp.evaluate<{
    sessions: string;
    previewPresent: boolean;
    packagePath: string;
    imagePath: string;
    reportPresent: boolean;
  }>(`(() => ({
    sessions: document.querySelector('[data-testid="creation-sessions"]')?.textContent ?? '',
    previewPresent: Boolean(document.querySelector('[data-testid="creation-review"]')),
    packagePath: document.querySelector('[data-testid="package-path"]') instanceof HTMLInputElement ? document.querySelector('[data-testid="package-path"]').value : '',
    imagePath: document.querySelector('[data-testid="image-path"]') instanceof HTMLInputElement ? document.querySelector('[data-testid="image-path"]').value : '',
    reportPresent: Boolean(document.querySelector('[data-testid="verification-card"]')),
  }))()`);
  if (
    returnedWorkspaceState.sessions.includes("AP-027 B 空白会话") ||
    returnedWorkspaceState.previewPresent ||
    returnedWorkspaceState.packagePath ||
    returnedWorkspaceState.imagePath ||
    returnedWorkspaceState.reportPresent
  ) {
    throw new Error(
      `Returning to workspace A restored stale state automatically: ${JSON.stringify(returnedWorkspaceState)}`,
    );
  }
  record(
    "workspace-a-return-requires-explicit-history-restore",
    JSON.stringify(returnedWorkspaceState),
  );
  await fsp.writeFile(
    path.join(evidence, "workspace-scope-reset.png"),
    await cdp.screenshot(),
  );

  await clickButtonContaining(cdp, "creation-sessions", "AP-027 真实本地创作");
  await waitFor(
    () => controlText(cdp, "creation-output"),
    (value) => value.includes("自动加入证明工作区"),
    "workspace A explicit history restore after scope switch",
  );
  record("workspace-a-history-explicitly-restored-after-switch");

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
    "0.3.0",
    "1.5.0",
    "1.4.0",
    "proof.asset.export",
    "proof.asset.match",
    "creation.comfyui-local",
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

  await fsp.writeFile(
    selectionManifest,
    `${JSON.stringify(
      {
        workspaceParents: [],
        existingWorkspaces: [],
        assets: [],
        images: [],
        imageOutputs: [reopenedExportedImage],
        packages: [],
        packageOutputs: [],
        reportOutputs: [],
        providerInstallations: [],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

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
  const startupCreationPresent = await launch.cdp.evaluate<boolean>(
    `Boolean(document.querySelector('[data-testid="creation-review"]'))`,
  );
  if (startupCreationPresent) {
    throw new Error(
      "Restart restored a creation session before opening a workspace.",
    );
  }
  await clickButtonContaining(launch.cdp, "recent-workspaces", proofWorkspace);
  await waitFor(
    () => controlText(launch!.cdp, "creation-sessions"),
    (value) => value.includes("AP-027 真实本地创作"),
    "restart workspace session list",
  );
  const restartWorkspaceState = await launch.cdp.evaluate<{
    previewPresent: boolean;
    packagePath: string;
    imagePath: string;
    reportPresent: boolean;
  }>(`(() => ({
    previewPresent: Boolean(document.querySelector('[data-testid="creation-review"]')),
    packagePath: document.querySelector('[data-testid="package-path"]') instanceof HTMLInputElement ? document.querySelector('[data-testid="package-path"]').value : '',
    imagePath: document.querySelector('[data-testid="image-path"]') instanceof HTMLInputElement ? document.querySelector('[data-testid="image-path"]').value : '',
    reportPresent: Boolean(document.querySelector('[data-testid="verification-card"]')),
  }))()`);
  if (
    restartWorkspaceState.previewPresent ||
    restartWorkspaceState.packagePath ||
    restartWorkspaceState.imagePath ||
    restartWorkspaceState.reportPresent
  ) {
    throw new Error(
      `Opening a recent workspace restored stale creation state: ${JSON.stringify(restartWorkspaceState)}`,
    );
  }
  record(
    "restart-workspace-open-has-no-automatic-session-restore",
    JSON.stringify(restartWorkspaceState),
  );
  await clickButtonContaining(
    launch.cdp,
    "creation-sessions",
    "AP-027 真实本地创作",
  );
  await waitFor(
    () => controlText(launch!.cdp, "creation-output"),
    (value) => value.includes("自动加入证明工作区"),
    "restart explicit historical creation restore",
  );
  record("restart-history-restored-only-after-explicit-selection");
  const reopenedCreation = await launch.cdp.evaluate<{
    state: string;
    status?: string;
    packageStatus?: string;
  }>(`(async () => {
    const state = await window.aigcProof.getState();
    const workspace = state.ok ? state.data.recentWorkspaces.find((item) => item.displayPath === ${js(proofWorkspace)}) : undefined;
    if (!workspace) throw new Error('Restart workspace reference missing.');
    const sessions = await window.aigcProof.getCreationSessions({ workspace: workspace.reference });
    const session = sessions.ok ? sessions.data.find((item) => item.title === 'AP-027 真实本地创作') : undefined;
    if (!session?.package) throw new Error('Persisted creation package reference missing.');
    const verified = await window.aigcProof.verifyPackage({ package: session.package });
    if (!verified.ok) throw new Error(verified.error.code);
    return {
      state: session.state,
      status: session.verification?.status,
      packageStatus: verified.data.status,
    };
  })()`);
  if (
    reopenedCreation.state !== "complete" ||
    reopenedCreation.status !== "valid" ||
    reopenedCreation.packageStatus !== "valid"
  ) {
    throw new Error(
      `Restarted creation verification failed: ${JSON.stringify(reopenedCreation)}`,
    );
  }
  record(
    "creation-restart-reopen-and-reverify",
    JSON.stringify(reopenedCreation),
  );
  await clickAndWait(
    launch.cdp,
    "export-creation-output",
    "生成图片副本已保存，可直接与证明包核验",
  );
  const reopenedDigest = sha256(await fsp.readFile(reopenedExportedImage));
  if (reopenedDigest !== completedCreation.output) {
    throw new Error(
      `Restarted export digest ${reopenedDigest} differs from ${completedCreation.output}.`,
    );
  }
  await clickAndWait(
    launch.cdp,
    "match-image-package",
    "图片与有效证明包中的生成输出完全一致",
  );
  record("restart-export-and-output-match", reopenedDigest);
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

  const cliExecutable = path.join(
    repo,
    "target",
    "windows-msvc",
    "release",
    "aigc-proof.exe",
  );
  await fsp.access(cliExecutable);
  const cliVerification = await runProcess(cliExecutable, [
    "verify",
    creationPackage,
    "--json",
    cliReport,
  ]);
  const cliReportValue = JSON.parse(await fsp.readFile(cliReport, "utf8")) as {
    status?: string;
    proof_id?: string;
  };
  const manifest = JSON.parse(
    new AdmZip(creationPackage).readAsText("manifest.json"),
  ) as {
    assets?: Array<{ role?: string; sha256?: string }>;
  };
  const recordedOutputDigest = manifest.assets?.find(
    (candidate) =>
      candidate.role === "output" &&
      candidate.sha256 === completedCreation.output,
  )?.sha256;
  if (
    cliReportValue.status !== "valid" ||
    cliReportValue.proof_id !== completedCreation.proofId ||
    recordedOutputDigest !== completedCreation.output ||
    !cliVerification.stdout.includes('"status": "valid"')
  ) {
    throw new Error(
      `Independent CLI verification disagreed: ${JSON.stringify({ cliReportValue, recordedOutputDigest })}`,
    );
  }
  record("independent-native-cli-verification-and-output-digest");

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
    workbenchVersion: "0.6.0",
    contractVersion: "1.5.0",
    nativeApiVersion: "1.4.0",
    engineVersion: "0.3.0",
    protocolVersion: "0.3.0",
    executable: testedExecutable,
    protocol: "file:",
    nativeAddon: testedAddon,
    database,
    workspace: proofWorkspace,
    secondWorkspace: secondProofWorkspace,
    package: validPackage,
    creationPackage,
    tamperedPackage,
    report,
    creationReport,
    exportedImage,
    mutatedImage,
    reopenedExportedImage,
    exportedDigest,
    reopenedDigest,
    cliExecutable,
    cliReport,
    recordedOutputDigest,
    comfyUiInstallation,
    nativeDiscovery,
    providerInventory: providerText,
    completedCreation,
    signerFingerprint: signerFingerprint.trim(),
    rotatedSignerFingerprint,
    reopenedCreation,
    steps,
    recoveryState,
    recoveredFiles,
  };
  await fsp.writeFile(
    path.join(evidence, "qa-result.json"),
    `${JSON.stringify(evidenceObject, null, 2)}\n`,
    "utf8",
  );
  await cleanupQaSigner();
  console.log(JSON.stringify({ result: "PASS", evidence }, null, 2));
}

main().catch(async (error) => {
  if (launch) {
    launch.process.kill();
    launch.cdp.close();
  }
  await cleanupQaSigner().catch(() => undefined);
  await fsp.mkdir(evidence, { recursive: true });
  await fsp.writeFile(
    path.join(evidence, "qa-failure.txt"),
    error instanceof Error ? (error.stack ?? error.message) : String(error),
    "utf8",
  );
  console.error(error);
  process.exitCode = 1;
});
