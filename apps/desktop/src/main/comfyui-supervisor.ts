import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";

import {
  ComfyUiProviderAdapter,
  CreationCoreError,
  type ProviderInspection,
} from "@aigc-proof/creation-core";

const BASELINE_VERSION = "0.27.0";
const GPL3_LICENSE_SHA256 =
  "230184f60bae2feaf244f10a8bac053c8ff33a183bcc365b4d8b876d2b7f4809";
const MAX_DIAGNOSTIC_BYTES = 32 * 1024;

export interface ComfyUiInstallationInspection extends ProviderInspection {
  installationPath: string;
  licenseSha256: string;
}

async function file(pathname: string): Promise<Uint8Array> {
  const stat = await fs.stat(pathname).catch(() => undefined);
  if (!stat?.isFile() || stat.size < 1 || stat.size > 2 * 1024 * 1024) {
    throw new CreationCoreError(
      "PROVIDER_CAPABILITY_MISSING",
      `Required ComfyUI installation file is unavailable: ${path.basename(pathname)}.`,
    );
  }
  return fs.readFile(pathname);
}

export class ComfyUiSupervisor {
  #managedChild: ChildProcessByStdio<null, Readable, Readable> | undefined;
  #managedRuntime: string | undefined;
  #diagnostic = "";

  constructor(private readonly runtimeRoot: string) {}

  async validateInstallation(selectedPath: string): Promise<{
    installationPath: string;
    version: string;
    licenseSha256: string;
  }> {
    const installationPath = await fs.realpath(path.resolve(selectedPath));
    const stat = await fs.stat(installationPath);
    if (!stat.isDirectory()) {
      throw new CreationCoreError(
        "PROVIDER_CAPABILITY_MISSING",
        "Selected ComfyUI installation is not a directory.",
      );
    }
    const python = path.join(installationPath, "python_embeded", "python.exe");
    const main = path.join(installationPath, "ComfyUI", "main.py");
    const versionFile = path.join(
      installationPath,
      "ComfyUI",
      "comfyui_version.py",
    );
    const license = path.join(installationPath, "ComfyUI", "LICENSE");
    await Promise.all([file(python), file(main)]);
    const versionText = Buffer.from(await file(versionFile)).toString("utf8");
    const version = /__version__\s*=\s*["'](\d+\.\d+\.\d+)["']/u.exec(
      versionText,
    )?.[1];
    if (version !== BASELINE_VERSION) {
      throw new CreationCoreError(
        "PROVIDER_VERSION_INCOMPATIBLE",
        `ComfyUI ${version ?? "unknown"} does not match the frozen ${BASELINE_VERSION} baseline.`,
      );
    }
    const licenseBytes = await file(license);
    const licenseSha256 = createHash("sha256")
      .update(licenseBytes)
      .digest("hex");
    if (licenseSha256 !== GPL3_LICENSE_SHA256) {
      throw new CreationCoreError(
        "PROVIDER_CAPABILITY_MISSING",
        "ComfyUI GPL-3.0 license inventory did not match the reviewed baseline.",
      );
    }
    return { installationPath, version, licenseSha256 };
  }

  async inspect(selectedPath: string): Promise<ComfyUiInstallationInspection> {
    const installation = await this.validateInstallation(selectedPath);
    const adapter = new ComfyUiProviderAdapter();
    let observed: ProviderInspection;
    try {
      observed = await adapter.inspect();
    } catch (error) {
      if (this.#managedChild) throw error;
      await this.#start(installation.installationPath);
      observed = await this.#waitForInspection(adapter);
    }
    if (observed.version !== installation.version) {
      throw new CreationCoreError(
        "PROVIDER_VERSION_INCOMPATIBLE",
        "The loopback ComfyUI server version does not match the selected installation.",
      );
    }
    return {
      ...observed,
      installationPath: installation.installationPath,
      licenseSha256: installation.licenseSha256,
    };
  }

  adapter(): ComfyUiProviderAdapter {
    return new ComfyUiProviderAdapter({
      allowGlobalInterrupt: Boolean(this.#managedChild),
    });
  }

  diagnostic(): string {
    return this.#diagnostic;
  }

  async close(): Promise<void> {
    const child = this.#managedChild;
    this.#managedChild = undefined;
    if (child && child.exitCode === null) {
      child.kill();
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 5_000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    const runtime = this.#managedRuntime;
    this.#managedRuntime = undefined;
    if (runtime) await fs.rm(runtime, { recursive: true, force: true });
  }

  async #start(installationPath: string): Promise<void> {
    const runId = randomUUID().replaceAll("-", "");
    const runtime = path.join(this.runtimeRoot, "comfyui-runtime", runId);
    this.#managedRuntime = runtime;
    const output = path.join(runtime, "output");
    const input = path.join(runtime, "input");
    const user = path.join(runtime, "user");
    await Promise.all(
      [runtime, output, input, user].map((directory) =>
        fs.mkdir(directory, { recursive: true }),
      ),
    );
    const python = path.join(installationPath, "python_embeded", "python.exe");
    const main = path.join(installationPath, "ComfyUI", "main.py");
    const child = spawn(
      python,
      [
        "-s",
        main,
        "--windows-standalone-build",
        "--listen",
        "127.0.0.1",
        "--port",
        "8188",
        "--disable-auto-launch",
        "--disable-all-custom-nodes",
        "--disable-api-nodes",
        "--output-directory",
        output,
        "--input-directory",
        input,
        "--user-directory",
        user,
      ],
      {
        cwd: installationPath,
        windowsHide: true,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    this.#managedChild = child;
    const append = (chunk: Buffer) => {
      this.#diagnostic = `${this.#diagnostic}${chunk.toString("utf8")}`.slice(
        -MAX_DIAGNOSTIC_BYTES,
      );
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.once("exit", () => {
      if (this.#managedChild === child) this.#managedChild = undefined;
    });
  }

  async #waitForInspection(
    adapter: ComfyUiProviderAdapter,
  ): Promise<ProviderInspection> {
    const deadline = Date.now() + 90_000;
    let lastError: unknown;
    while (Date.now() < deadline) {
      if (!this.#managedChild) {
        throw new CreationCoreError(
          "PROVIDER_PROCESS_LOST",
          `Managed ComfyUI process exited during startup. ${this.#diagnostic.slice(-2_000)}`,
        );
      }
      try {
        return await adapter.inspect();
      } catch (error) {
        lastError = error;
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    throw new CreationCoreError(
      "PROVIDER_TIMEOUT",
      lastError instanceof Error
        ? `ComfyUI startup timed out: ${lastError.message}`
        : "ComfyUI startup timed out.",
    );
  }
}
