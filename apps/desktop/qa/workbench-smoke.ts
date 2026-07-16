import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import https, { type Server } from "node:https";
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
interface LocalTsa {
  server: Server;
  profilePath: string;
  endpoint: string;
  firstResponsePath: string;
  requestInspections: string[];
  setMode(mode: "normal" | "wrong-media" | "delay" | "replay-first"): void;
  close(): Promise<void>;
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
const timestampedCreationPackage = path.join(
  work,
  "创作 可信时间证明包.aigcproof",
);
const cancelledTimestampPackage = path.join(
  work,
  "取消 可信时间证明包.aigcproof",
);
const failedTimestampPackage = path.join(work, "失败 可信时间证明包.aigcproof");
const substitutedTimestampPackage = path.join(
  work,
  "替换响应 可信时间证明包.aigcproof",
);
const exportedImage = path.join(work, "保存 生成图片.png");
const mutatedImage = path.join(work, "修改后 生成图片.png");
const reopenedExportedImage = path.join(work, "重启后 生成图片.png");
const cliReport = path.join(work, "CLI 独立验证报告.json");
const cliTimestampRequest = path.join(work, "CLI 时间戳请求.tsq");
const cliTimestampPackage = path.join(work, "CLI 可信时间证明包.aigcproof");
const cliTimestampReport = path.join(work, "CLI 可信时间验证报告.json");
const c2paCorpus = path.resolve(
  process.env.AIGC_PROOF_C2PA_CORPUS_DIR ??
    path.join(workspaceRoot, "test-results", "AP-033", "corpus", "generated"),
);
const c2paTrustProfile = path.join(c2paCorpus, "trust-profile.json");
const c2paEmbeddedImages = ["jpg", "png", "webp"].map((extension) =>
  path.join(c2paCorpus, `embedded-v2.${extension}`),
);
const c2paSidecarImages = ["jpg", "png", "webp"].map((extension) =>
  path.join(c2paCorpus, `sidecar-source.${extension}`),
);
const c2paSidecars = ["jpg", "png", "webp"].map((extension) =>
  path.join(c2paCorpus, `explicit-v2-${extension}.c2pa`),
);
const c2paRemoteImage = path.join(c2paCorpus, "remote-reference.png");
const c2paUnsupported = path.join(c2paCorpus, "unsupported.pdf");
const c2paSoftBinding = path.join(c2paCorpus, "soft-binding.jpg");
const c2paFutureClaim = path.join(c2paCorpus, "future-claim.jpg");
const c2paAttackImage = path.resolve(
  c2paCorpus,
  "..",
  "attacks",
  "title_xss_0_xss.jpg",
);
const comfyUiInstallation = path.resolve(
  process.env.AIGC_PROOF_COMFYUI_DIR ??
    path.join(workspaceRoot, "..", "ComfyUI_windows_portable"),
);
const selectionManifest = path.join(evidence, "qa-selections.json");
const addonPath = path.join(desktop, "native", "proof_napi.node");
const qaSignerService = `org.aigcproof.qa.ap032-${process.pid}`;
const qaSignerTarget = `current-user.${qaSignerService}`;
const steps: Array<{ name: string; result: string; detail?: string }> = [];
let launch: Launch | undefined;
let localTsa: LocalTsa | undefined;
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

function opensslMessageImprint(inspection: string): string {
  const block = inspection
    .split("Message data:", 2)[1]
    ?.split("Policy OID:", 1)[0];
  if (!block) return "";
  return block
    .split(/\r?\n/u)
    .map((line) =>
      line
        .replace(/^\s*[0-9a-f]+\s*-\s*/iu, "")
        .split(/\s{2,}/u, 1)[0]!
        .replace(/[^0-9a-f]/giu, ""),
    )
    .join("")
    .toLowerCase();
}

async function expectFileAbsent(filePath: string): Promise<void> {
  try {
    await fsp.access(filePath);
  } catch {
    return;
  }
  throw new Error(`Failed or cancelled acquisition published ${filePath}.`);
}

async function runProcess(
  executable: string,
  args: string[],
  cwd = repo,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, windowsHide: true });
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

async function createLocalTsa(): Promise<LocalTsa> {
  const directory = path.join(evidence, "local-rfc3161-tsa");
  const openssl =
    process.env.OPENSSL ?? "C:\\Program Files\\Git\\usr\\bin\\openssl.exe";
  await fsp.mkdir(directory, { recursive: true });
  const runOpenSsl = (args: string[]) => runProcess(openssl, args, directory);
  await runOpenSsl([
    "req",
    "-x509",
    "-newkey",
    "ec",
    "-pkeyopt",
    "ec_paramgen_curve:P-256",
    "-nodes",
    "-keyout",
    "root.key",
    "-out",
    "root.pem",
    "-days",
    "3650",
    "-subj",
    "/CN=AIGC Proof Packaged QA Root",
    "-addext",
    "basicConstraints=critical,CA:TRUE",
    "-addext",
    "keyUsage=critical,keyCertSign,cRLSign",
  ]);
  await runOpenSsl([
    "genpkey",
    "-algorithm",
    "EC",
    "-pkeyopt",
    "ec_paramgen_curve:P-256",
    "-out",
    "tsa.key",
  ]);
  await runOpenSsl([
    "req",
    "-new",
    "-key",
    "tsa.key",
    "-out",
    "tsa.csr",
    "-subj",
    "/CN=AIGC Proof Packaged QA TSA",
  ]);
  await fsp.writeFile(
    path.join(directory, "tsa.ext"),
    "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=critical,timeStamping\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n",
    "utf8",
  );
  await runOpenSsl([
    "x509",
    "-req",
    "-in",
    "tsa.csr",
    "-CA",
    "root.pem",
    "-CAkey",
    "root.key",
    "-CAcreateserial",
    "-out",
    "tsa.pem",
    "-days",
    "3650",
    "-sha256",
    "-extfile",
    "tsa.ext",
  ]);
  await runOpenSsl([
    "genpkey",
    "-algorithm",
    "EC",
    "-pkeyopt",
    "ec_paramgen_curve:P-256",
    "-out",
    "server.key",
  ]);
  await runOpenSsl([
    "req",
    "-new",
    "-key",
    "server.key",
    "-out",
    "server.csr",
    "-subj",
    "/CN=localhost",
  ]);
  await fsp.writeFile(
    path.join(directory, "server.ext"),
    "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1\n",
    "utf8",
  );
  await runOpenSsl([
    "x509",
    "-req",
    "-in",
    "server.csr",
    "-CA",
    "root.pem",
    "-CAkey",
    "root.key",
    "-CAserial",
    "root.srl",
    "-out",
    "server.pem",
    "-days",
    "3650",
    "-sha256",
    "-extfile",
    "server.ext",
  ]);
  await runOpenSsl([
    "x509",
    "-in",
    "root.pem",
    "-outform",
    "DER",
    "-out",
    "root.der",
  ]);
  await fsp.writeFile(path.join(directory, "tsaserial"), "01\n", "utf8");
  const portable = directory.replaceAll("\\", "/");
  await fsp.writeFile(
    path.join(directory, "tsa.conf"),
    `dir=${portable}\n[tsa]\ndefault_tsa=tsa_config1\n[tsa_config1]\nserial=$dir/tsaserial\ncrypto_device=builtin\nsigner_cert=$dir/tsa.pem\ncerts=$dir/root.pem\nsigner_key=$dir/tsa.key\nsigner_digest=sha256\ndefault_policy=1.2.3.4.1\nother_policies=1.2.3.4.2\ndigests=sha256\naccuracy=secs:1\nordering=no\ntsa_name=yes\ness_cert_id_chain=no\ness_cert_id_alg=sha256\n`,
    "utf8",
  );

  let sequence = 0;
  let responseMode: "normal" | "wrong-media" | "delay" | "replay-first" =
    "normal";
  let firstResponse: Buffer | undefined;
  const requestInspections: string[] = [];
  const server = https.createServer(
    {
      key: await fsp.readFile(path.join(directory, "server.key")),
      cert: await fsp.readFile(path.join(directory, "server.pem")),
    },
    (request, response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      request.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 1024 * 1024) request.destroy();
        else chunks.push(chunk);
      });
      request.on("end", () => {
        void (async () => {
          if (
            request.method !== "POST" ||
            request.url !== "/rfc3161" ||
            request.headers["content-type"] !== "application/timestamp-query"
          ) {
            response.writeHead(400).end();
            return;
          }
          if (responseMode === "delay") return;
          if (responseMode === "wrong-media") {
            response.writeHead(200, { "content-type": "application/json" });
            response.end("{}");
            return;
          }
          sequence += 1;
          const requestName = `request-${sequence}.tsq`;
          const responseName = `response-${sequence}.tsr`;
          await fsp.writeFile(
            path.join(directory, requestName),
            Buffer.concat(chunks),
          );
          const inspection = await runOpenSsl([
            "ts",
            "-query",
            "-in",
            requestName,
            "-text",
          ]);
          requestInspections.push(inspection.stdout);
          await fsp.writeFile(
            path.join(directory, `request-${sequence}-openssl.txt`),
            inspection.stdout,
            "utf8",
          );
          if (responseMode === "replay-first") {
            if (!firstResponse)
              throw new Error(
                "No earlier TSA response exists for substitution.",
              );
            response.writeHead(200, {
              "content-type": "application/timestamp-reply",
              "content-length": String(firstResponse.length),
            });
            response.end(firstResponse);
            return;
          }
          await runOpenSsl([
            "ts",
            "-reply",
            "-config",
            "tsa.conf",
            "-section",
            "tsa_config1",
            "-queryfile",
            requestName,
            "-out",
            responseName,
          ]);
          const bytes = await fsp.readFile(path.join(directory, responseName));
          firstResponse ??= bytes;
          response.writeHead(200, {
            "content-type": "application/timestamp-reply",
            "content-length": String(bytes.length),
          });
          response.end(bytes);
        })().catch((error) => {
          response.writeHead(500, { "content-type": "text/plain" });
          response.end(error instanceof Error ? error.message : String(error));
        });
      });
    },
  );
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "localhost", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Local TSA did not expose a TCP port.");
  }
  const endpoint = `https://localhost:${address.port}/rfc3161`;
  const rootDer = await fsp.readFile(path.join(directory, "root.der"));
  const profilePath = path.join(directory, "tsa-profile.json");
  await fsp.writeFile(
    profilePath,
    `${JSON.stringify(
      {
        profile: "aigc-proof.tsa-trust-profile.v1",
        source_label: "AP-032 packaged QA local TSA",
        endpoint,
        endpoint_scope: "loopback_test",
        allowed_policy_oids: ["1.2.3.4.1", "1.2.3.4.2"],
        roots_der_base64: [rootDer.toString("base64")],
        intermediates_der_base64: [],
        https_roots_der_base64: [rootDer.toString("base64")],
        revocation: {
          crls_der_base64: [],
          ocsp_responses_der_base64: [],
          required: false,
        },
        effective_at: "2026-01-01T00:00:00Z",
        expires_at: "2035-01-01T00:00:00Z",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  let closed = false;
  return {
    server,
    profilePath,
    endpoint,
    firstResponsePath: path.join(directory, "response-1.tsr"),
    requestInspections,
    setMode: (mode) => {
      responseMode = mode;
    },
    close: () => {
      if (closed) return Promise.resolve();
      closed = true;
      return new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
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
    `[...document.querySelectorAll('[data-testid=${js(testId)}]')].map((element) => element.textContent ?? '').join('\\n')`,
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
  const previous = await resultText(cdp);
  await click(cdp, testId);
  return waitFor(
    () => resultText(cdp),
    (value) => value !== previous && value.includes(expected),
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
  if (version !== "Workbench 0.8.0")
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
  localTsa = await createLocalTsa();
  await Promise.all([
    fsp.access(path.join(comfyUiInstallation, "python_embeded", "python.exe")),
    fsp.access(path.join(comfyUiInstallation, "ComfyUI", "main.py")),
    fsp.access(path.join(comfyUiInstallation, "ComfyUI", "LICENSE")),
    fsp.access(c2paTrustProfile),
    ...c2paEmbeddedImages.map((candidate) => fsp.access(candidate)),
    ...c2paSidecarImages.map((candidate) => fsp.access(candidate)),
    ...c2paSidecars.map((candidate) => fsp.access(candidate)),
    fsp.access(c2paRemoteImage),
    fsp.access(c2paUnsupported),
    fsp.access(c2paSoftBinding),
    fsp.access(c2paFutureClaim),
    fsp.access(c2paAttackImage),
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
          c2paEmbeddedImages[0],
          crashInput,
        ],
        images: [mutatedImage, manualInputImage, exportedImage, exportedImage],
        imageOutputs: [exportedImage, exportedImage],
        packages: [
          creationPackage,
          creationPackage,
          creationPackage,
          creationPackage,
          creationPackage,
          creationPackage,
          validPackage,
          validPackage,
          tamperedPackage,
          malformedPackage,
          tamperedPackage,
          malformedPackage,
          validPackage,
        ],
        packageOutputs: [creationPackage, validPackage, validPackage],
        tsaProfiles: [localTsa.profilePath],
        c2paTrustProfiles: [c2paTrustProfile],
        c2paImages: [
          ...c2paEmbeddedImages,
          ...c2paSidecarImages,
          c2paRemoteImage,
          c2paUnsupported,
          c2paSoftBinding,
          c2paFutureClaim,
          c2paAttackImage,
          c2paEmbeddedImages[0],
        ],
        c2paSidecars,
        timestampPackageOutputs: [
          timestampedCreationPackage,
          cancelledTimestampPackage,
          failedTimestampPackage,
          substitutedTimestampPackage,
        ],
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
  await clickAndWait(cdp, "import-tsa-profile", "TSA trust snapshot imported");
  const tsaProfileText = await controlText(cdp, "tsa-profile-summary");
  if (
    !tsaProfileText.includes("AP-032 packaged QA local TSA") ||
    !tsaProfileText.includes(localTsa.endpoint)
  ) {
    throw new Error(
      `TSA trust snapshot summary is incomplete: ${tsaProfileText}`,
    );
  }
  record("explicit-portable-tsa-trust-snapshot-imported", tsaProfileText);
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

  await click(cdp, "choose-asset");
  await waitFor(
    () => controlValue(cdp, "asset-path"),
    (value) => value.includes(c2paEmbeddedImages[0]!),
    "Host-issued C2PA image asset",
  );
  await setControl(cdp, "asset-role", "output");
  await clickAndWait(cdp, "add-asset", "资产已添加");
  record("c2pa-image-ingested-before-observation");

  await clickAndWait(cdp, "import-c2pa-profile", "C2PA trust profile imported");
  const c2paProfileText = await controlText(cdp, "c2pa-profile-summary");
  if (
    !c2paProfileText.includes("Pinned c2pa-rs 0.85.0 test signer roots") ||
    !c2paProfileText.includes("Pinned c2pa-rs 0.85.0 test timestamp roots")
  ) {
    throw new Error(`C2PA profile summary is incomplete: ${c2paProfileText}`);
  }
  record("explicit-c2pa-trust-profile-imported", c2paProfileText);

  for (const [index, image] of c2paEmbeddedImages.entries()) {
    await click(cdp, "choose-c2pa-image");
    await waitFor(
      () => controlValue(cdp, "c2pa-image-path"),
      (value) => value.includes(image),
      `Host-issued embedded C2PA image ${path.extname(image)}`,
    );
    await clickAndWait(cdp, "inspect-c2pa", "C2PA observation preview created");
    const inspection = await controlText(cdp, "c2pa-inspection");
    if (
      !inspection.includes("trusted") ||
      !inspection.includes("claim v2") ||
      !inspection.includes("来源：embedded")
    ) {
      throw new Error(`Embedded C2PA result is invalid: ${inspection}`);
    }
    if (index === 0) {
      await cdp.evaluate(
        `document.querySelector('[data-testid="c2pa-inspection"]')?.scrollIntoView({ block: "center" })`,
      );
      await delay(100);
      await fsp.writeFile(
        path.join(evidence, "c2pa-embedded-valid.png"),
        await cdp.screenshot(),
      );
    }
  }
  record("c2pa-embedded-jpeg-png-webp-valid");

  for (const [index, image] of c2paSidecarImages.entries()) {
    await click(cdp, "choose-c2pa-image");
    await waitFor(
      () => controlValue(cdp, "c2pa-image-path"),
      (value) => value.includes(image),
      `Host-issued C2PA sidecar source ${path.extname(image)}`,
    );
    await click(cdp, "choose-c2pa-sidecar");
    await waitFor(
      () => controlValue(cdp, "c2pa-sidecar-path"),
      (value) => value.endsWith(".c2pa"),
      "Host-issued explicit C2PA sidecar",
    );
    await clickAndWait(cdp, "inspect-c2pa", "C2PA observation preview created");
    const inspection = await controlText(cdp, "c2pa-inspection");
    if (
      !inspection.includes("trusted") ||
      !inspection.includes("claim v2") ||
      !inspection.includes("来源：sidecar")
    ) {
      throw new Error(`Sidecar C2PA result is invalid: ${inspection}`);
    }
    if (index === c2paSidecarImages.length - 1) {
      await cdp.evaluate(
        `document.querySelector('[data-testid="c2pa-inspection"]')?.scrollIntoView({ block: "center" })`,
      );
      await delay(100);
      await fsp.writeFile(
        path.join(evidence, "c2pa-sidecar-valid.png"),
        await cdp.screenshot(),
      );
    }
    await click(cdp, "clear-c2pa-sidecar");
  }
  record("c2pa-sidecar-jpeg-png-webp-valid");

  for (const [candidate, expected] of [
    [c2paRemoteImage, "C2PA_MANIFEST_NOT_FOUND"],
    [c2paUnsupported, "IMAGE_TYPE_UNSUPPORTED"],
    [c2paSoftBinding, "C2PA_SOFT_BINDING_UNSUPPORTED"],
    [c2paFutureClaim, "C2PA_CLAIM_VERSION_UNSUPPORTED"],
  ] as const) {
    await click(cdp, "choose-c2pa-image");
    await waitFor(
      () => controlValue(cdp, "c2pa-image-path"),
      (value) => value.includes(candidate),
      `Host-issued C2PA negative ${path.basename(candidate)}`,
    );
    await clickAndWait(cdp, "inspect-c2pa", expected);
    record(`c2pa-negative-${expected.toLowerCase()}`);
  }

  await click(cdp, "choose-c2pa-image");
  await waitFor(
    () => controlValue(cdp, "c2pa-image-path"),
    (value) => value.includes(c2paAttackImage),
    "Host-issued official C2PA attack-corpus image",
  );
  await clickAndWait(cdp, "inspect-c2pa", "C2PA observation preview created");
  const attackInspection = await controlText(cdp, "c2pa-inspection");
  if (
    !attackInspection.includes("claim v2") ||
    attackInspection.length >= 2_048 ||
    /<|>|javascript:/iu.test(attackInspection)
  ) {
    throw new Error(
      `C2PA attack-corpus result crossed the bounded UI boundary: ${attackInspection}`,
    );
  }
  record("c2pa-official-attack-content-rejected-at-ui-boundary");

  await click(cdp, "choose-c2pa-image");
  await waitFor(
    () => controlValue(cdp, "c2pa-image-path"),
    (value) => value.includes(c2paEmbeddedImages[0]!),
    "Host-issued C2PA observation source image",
  );
  await clickAndWait(cdp, "inspect-c2pa", "C2PA observation preview created");
  record("c2pa-observation-source-restored-to-workspace-asset");

  const c2paAssetId = await cdp.evaluate<string>(`(() => {
    const select = document.querySelector('[data-testid="c2pa-workspace-asset"]');
    if (!(select instanceof HTMLSelectElement)) throw new Error('C2PA workspace asset selector is missing.');
    const option = [...select.options].find((candidate) => candidate.textContent?.includes('embedded-v2.jpg'));
    if (!option) throw new Error('Ingested C2PA image option is missing.');
    return option.value;
  })()`);
  await setControl(cdp, "c2pa-workspace-asset", c2paAssetId);
  await clickAndWait(
    cdp,
    "create-c2pa-observation",
    "Digest-bound C2PA observation recorded",
  );
  await cdp.evaluate(
    `document.querySelector('[data-testid="result-text"]')?.scrollIntoView({ block: "center" })`,
  );
  await delay(100);
  await fsp.writeFile(
    path.join(evidence, "c2pa-observation-recorded.png"),
    await cdp.screenshot(),
  );
  record("digest-bound-c2pa-observation-recorded", c2paAssetId);

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
    "aigc-proof.creator-signature.cose-ed25519.v3",
    "自我声明",
  ]) {
    if (!signatureEvidence.includes(expected)) {
      throw new Error(`Creator signature evidence omitted ${expected}.`);
    }
  }
  record("creator-signature-evidence-is-truthful", signatureEvidence);

  const originalProtectedEntries = new Map(
    new AdmZip(creationPackage)
      .getEntries()
      .filter(
        (entry) =>
          entry.entryName === "manifest.json" ||
          entry.entryName.startsWith("security/keys/") ||
          entry.entryName.startsWith("security/signatures/"),
      )
      .map((entry) => [entry.entryName, sha256(entry.getData())]),
  );
  await click(cdp, "choose-package");
  await waitFor(
    () => controlValue(cdp, "package-path"),
    (value) => value.includes(creationPackage),
    "Host-issued protocol 0.4 package for trusted time",
  );
  await click(cdp, "choose-timestamp-output");
  await waitFor(
    () => controlValue(cdp, "timestamp-output-path"),
    (value) => value.includes(timestampedCreationPackage),
    "Host-issued timestamped package output",
  );
  const acquisitionResult = await clickAndWait(
    cdp,
    "request-trusted-time",
    "Trusted timestamp attached and verified",
    180_000,
  );
  await fsp.access(timestampedCreationPackage);
  const trustedTimeReport = await cdp.evaluate<{
    status?: string;
    signature?: string;
    trustedTime?: string;
    revocation?: string;
    timestampPath?: string;
  }>(`(async () => {
    const state = await window.aigcProof.getState();
    const candidate = state.ok ? state.data.recentPackages.find((item) => item.displayPath === ${js(timestampedCreationPackage)}) : undefined;
    if (!candidate) throw new Error('Timestamped package is absent from recents.');
    const verified = await window.aigcProof.verifyPackage({ package: candidate.reference });
    if (!verified.ok) throw new Error(verified.error.code);
    return {
      status: verified.data.status,
      signature: verified.data.assurance.digital_signature,
      trustedTime: verified.data.assurance.trusted_time,
      revocation: verified.data.trusted_time?.revocation,
      timestampPath: verified.data.trusted_time?.timestamp_path,
    };
  })()`);
  if (
    trustedTimeReport.status !== "valid" ||
    trustedTimeReport.trustedTime !== "valid_trusted" ||
    !["valid_locally_trusted", "valid_untrusted"].includes(
      trustedTimeReport.signature ?? "",
    ) ||
    trustedTimeReport.revocation !== "not_provided" ||
    !trustedTimeReport.timestampPath?.startsWith("security/timestamps/")
  ) {
    throw new Error(
      `Timestamped package evidence is invalid: ${JSON.stringify(trustedTimeReport)}`,
    );
  }
  const timestampedZip = new AdmZip(timestampedCreationPackage);
  for (const [entryName, digest] of originalProtectedEntries) {
    const entry = timestampedZip.getEntry(entryName);
    if (!entry || sha256(entry.getData()) !== digest) {
      throw new Error(
        `Trusted-time attachment changed protected entry ${entryName}.`,
      );
    }
  }
  const signatureEntry = new AdmZip(creationPackage).getEntry(
    "security/signatures/creator.cose",
  );
  if (!signatureEntry)
    throw new Error("Protocol 0.4 package omitted creator signature.");
  const signatureDigest = sha256(signatureEntry.getData());
  const disclosedDigest = /"message_imprint_sha256":\s*"([0-9a-f]{64})"/u.exec(
    acquisitionResult,
  )?.[1];
  const disclosedNonce = /"nonce":\s*"([0-9a-f]{32})"/u.exec(
    acquisitionResult,
  )?.[1];
  const disclosedPolicy = /"requested_policy":\s*"([^"]+)"/u.exec(
    acquisitionResult,
  )?.[1];
  const requestInspection = localTsa.requestInspections[0] ?? "";
  if (
    disclosedDigest !== signatureDigest ||
    !disclosedNonce ||
    disclosedPolicy !== "any" ||
    !requestInspection.includes("Hash Algorithm: sha256") ||
    !requestInspection.includes("Policy OID: unspecified") ||
    !requestInspection.includes("Certificate required: yes") ||
    !requestInspection.toLowerCase().includes(disclosedNonce) ||
    opensslMessageImprint(requestInspection) !== signatureDigest
  ) {
    throw new Error(
      `OpenSSL request inspection disagreed with disclosure: ${JSON.stringify({ signatureDigest, disclosedDigest, disclosedNonce, disclosedPolicy, requestInspection })}`,
    );
  }
  const trustedTimeEvidence = await controlText(cdp, "trusted-time-evidence");
  if (
    !trustedTimeEvidence.includes("AP-032 packaged QA local TSA") ||
    !trustedTimeEvidence.includes("not_provided")
  ) {
    throw new Error(
      `Trusted-time UI evidence is incomplete: ${trustedTimeEvidence}`,
    );
  }
  await fsp.writeFile(
    path.join(evidence, "trusted-time-valid.png"),
    await cdp.screenshot(),
  );
  record(
    "rfc3161-https-attach-offline-verify-and-byte-preservation",
    JSON.stringify(trustedTimeReport),
  );
  record(
    "openssl-request-inspection-matches-disclosure",
    JSON.stringify({
      signatureDigest,
      disclosedNonce,
      requestedPolicy: "any",
      grantedPolicy: "1.2.3.4.1",
    }),
  );

  localTsa.setMode("delay");
  await click(cdp, "choose-package");
  await waitFor(
    () => controlValue(cdp, "package-path"),
    (value) => value.includes(creationPackage),
    "Host-issued package for cancellation",
  );
  await click(cdp, "choose-timestamp-output");
  await waitFor(
    () => controlValue(cdp, "timestamp-output-path"),
    (value) => value.includes(cancelledTimestampPackage),
    "Host-issued cancelled timestamp output",
  );
  await click(cdp, "request-trusted-time");
  await delay(500);
  await click(cdp, "cancel-trusted-time");
  await waitFor(
    () => resultText(cdp),
    (value) => value.includes("ABORT_ERR"),
    "trusted-time request cancellation",
    30_000,
  );
  await expectFileAbsent(cancelledTimestampPackage);
  await waitFor(
    () => controlText(cdp, "signature-assurance"),
    (value) => value.includes("acquisition_failed"),
    "cancelled acquisition assurance",
  );
  const afterCancellation = await clickAndWait(
    cdp,
    "verify-package",
    '"status": "valid"',
  );
  if (afterCancellation.includes('"digital_signature": "invalid"')) {
    throw new Error("Cancelled acquisition invalidated the creator signature.");
  }
  record("cancelled-acquisition-preserves-valid-signature");

  localTsa.setMode("wrong-media");
  await click(cdp, "choose-package");
  await waitFor(
    () => controlValue(cdp, "package-path"),
    (value) => value.includes(creationPackage),
    "Host-issued package for failed acquisition",
  );
  await click(cdp, "choose-timestamp-output");
  await waitFor(
    () => controlValue(cdp, "timestamp-output-path"),
    (value) => value.includes(failedTimestampPackage),
    "Host-issued failed timestamp output",
  );
  await clickAndWait(
    cdp,
    "request-trusted-time",
    "TSA_CONTENT_TYPE_INVALID",
    30_000,
  );
  await expectFileAbsent(failedTimestampPackage);
  await waitFor(
    () => controlText(cdp, "signature-assurance"),
    (value) => value.includes("acquisition_failed"),
    "failed acquisition assurance",
  );
  const afterFailure = await clickAndWait(
    cdp,
    "verify-package",
    '"status": "valid"',
  );
  if (afterFailure.includes('"digital_signature": "invalid"')) {
    throw new Error("Failed acquisition invalidated the creator signature.");
  }
  localTsa.setMode("normal");
  record("failed-acquisition-preserves-valid-signature");

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

  localTsa.setMode("replay-first");
  await click(cdp, "choose-package");
  await waitFor(
    () => controlValue(cdp, "package-path"),
    (value) => value.includes(validPackage),
    "Host-issued package for substituted TSA response",
  );
  await click(cdp, "choose-timestamp-output");
  await waitFor(
    () => controlValue(cdp, "timestamp-output-path"),
    (value) => value.includes(substitutedTimestampPackage),
    "Host-issued substituted-response output",
  );
  await click(cdp, "request-trusted-time");
  const substitutedResponseFailure = await waitFor(
    () => resultText(cdp),
    (value) =>
      value.includes("TRUSTED_TIMESTAMP_") ||
      value.includes("TIMESTAMPED_PACKAGE_SELF_CHECK_FAILED"),
    "substituted timestamp response rejection",
    30_000,
  );
  await expectFileAbsent(substitutedTimestampPackage);
  const afterSubstitution = await clickAndWait(
    cdp,
    "verify-package",
    '"status": "valid"',
  );
  if (afterSubstitution.includes('"digital_signature": "invalid"')) {
    throw new Error(
      "Substituted TSA response invalidated the creator signature.",
    );
  }
  localTsa.setMode("normal");
  record(
    "substituted-response-rejected-with-signature-preserved",
    substitutedResponseFailure,
  );

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
    "0.5.0",
    "1.7.0",
    "1.6.0",
    "c2pa.image.inspect",
    "c2pa.observation.create",
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
        tsaProfiles: [],
        c2paTrustProfiles: [],
        c2paImages: [],
        c2paSidecars: [],
        timestampPackageOutputs: [],
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

  await localTsa.close();
  record("tsa-stopped-before-offline-cli-verification");

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

  await runProcess(cliExecutable, [
    "timestamp",
    "profile",
    localTsa.profilePath,
  ]);
  await runProcess(cliExecutable, [
    "timestamp",
    "request",
    creationPackage,
    "--tsa-profile",
    localTsa.profilePath,
    "--output",
    cliTimestampRequest,
  ]);
  const firstNetworkRequest = path.join(
    evidence,
    "local-rfc3161-tsa",
    "request-1.tsq",
  );
  if (
    !(await fsp.readFile(cliTimestampRequest)).equals(
      await fsp.readFile(firstNetworkRequest),
    )
  ) {
    throw new Error(
      "CLI timestamp request differs from the Main-sent DER request.",
    );
  }
  await runProcess(cliExecutable, [
    "timestamp",
    "attach",
    creationPackage,
    "--response",
    localTsa.firstResponsePath,
    "--tsa-profile",
    localTsa.profilePath,
    "--output",
    cliTimestampPackage,
  ]);
  const cliTrustedVerification = await runProcess(cliExecutable, [
    "verify",
    cliTimestampPackage,
    "--tsa-profile",
    localTsa.profilePath,
    "--json",
    cliTimestampReport,
  ]);
  const cliTrustedReport = JSON.parse(
    await fsp.readFile(cliTimestampReport, "utf8"),
  ) as {
    status?: string;
    assurance?: { trusted_time?: string; digital_signature?: string };
  };
  if (
    cliTrustedReport.status !== "valid" ||
    cliTrustedReport.assurance?.trusted_time !== "valid_trusted" ||
    !cliTrustedVerification.stdout.includes('"trusted_time": "valid_trusted"')
  ) {
    throw new Error(
      `CLI trusted-time verification disagreed: ${JSON.stringify(cliTrustedReport)}`,
    );
  }
  record("native-cli-request-attach-and-offline-trusted-verify");

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
    workbenchVersion: "0.8.0",
    contractVersion: "1.7.0",
    nativeApiVersion: "1.6.0",
    engineVersion: "0.5.0",
    protocolVersion: "0.5.0",
    executable: testedExecutable,
    protocol: "file:",
    nativeAddon: testedAddon,
    database,
    workspace: proofWorkspace,
    secondWorkspace: secondProofWorkspace,
    package: validPackage,
    creationPackage,
    timestampedCreationPackage,
    trustedTimeReport,
    tsaProfile: localTsa.profilePath,
    tsaEndpoint: localTsa.endpoint,
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
    cliTimestampRequest,
    cliTimestampPackage,
    cliTimestampReport,
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
  await localTsa.close();
  localTsa = undefined;
  console.log(JSON.stringify({ result: "PASS", evidence }, null, 2));
}

main().catch(async (error) => {
  if (launch) {
    launch.process.kill();
    launch.cdp.close();
  }
  if (localTsa) {
    await localTsa.close().catch(() => undefined);
    localTsa = undefined;
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
