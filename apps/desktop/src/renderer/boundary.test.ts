import fs from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("renderer dependency boundary", () => {
  it("cannot import Node, Electron, filesystem, SQLite, native modules, or IPC", async () => {
    const renderer = path.resolve(process.cwd(), "src/renderer");
    const names = (await fs.readdir(renderer)).filter(
      (name) =>
        /\.(ts|tsx)$/u.test(name) &&
        !name.endsWith(".test.ts") &&
        !name.endsWith(".test.tsx"),
    );
    const sources = await Promise.all(
      names.map((name) => fs.readFile(path.join(renderer, name), "utf8")),
    );
    const combined = sources.join("\n");
    expect(combined).not.toMatch(
      /from\s+["'](?:node:|electron|better-sqlite|sqlite)/u,
    );
    expect(combined).not.toMatch(
      /ipcRenderer|createRequire|\.node["']|child_process/u,
    );
    expect(combined).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket/u);
    expect(combined).not.toMatch(/src\/(?:main|preload)\//u);
  });

  it("keeps production native loading exclusively in the Utility source", async () => {
    const mainDirectory = path.resolve(process.cwd(), "src/main");
    const mainNames = (await fs.readdir(mainDirectory)).filter(
      (name) => name.endsWith(".ts") && !name.endsWith(".test.ts"),
    );
    const mainSources = await Promise.all(
      mainNames.map((name) =>
        fs.readFile(path.join(mainDirectory, name), "utf8"),
      ),
    );
    const utility = await fs.readFile(
      path.resolve(process.cwd(), "src/utility/native.ts"),
      "utf8",
    );
    expect(mainNames).not.toContain("native.ts");
    expect(mainSources.join("\n")).not.toMatch(
      /createRequire|loadNativeAddon/u,
    );
    expect(utility).toMatch(/createRequire|loadNativeAddon/u);
  });

  it("keeps trusted-time networking in one consented Main-only adapter", async () => {
    const mainDirectory = path.resolve(process.cwd(), "src/main");
    const productionSources = (await fs.readdir(mainDirectory)).filter(
      (name) => name.endsWith(".ts") && !name.endsWith(".test.ts"),
    );
    const withHttps = [];
    for (const name of productionSources) {
      const source = await fs.readFile(path.join(mainDirectory, name), "utf8");
      if (/from\s+["']node:https["']/u.test(source)) withHttps.push(name);
    }
    expect(withHttps).toEqual(["tsa-transport.ts"]);
    const ipc = await fs.readFile(path.join(mainDirectory, "ipc.ts"), "utf8");
    expect(ipc).toContain("Send trusted-time request?");
    expect(ipc).toContain("prepared.disclosure.message_imprint_sha256");
    expect(ipc).toContain("if (!qaMode)");
    expect(ipc).not.toMatch(/https\.request|\bfetch\s*\(/u);
  });

  it("cleans generated application output before packaging", async () => {
    const packageScript = await fs.readFile(
      path.resolve(process.cwd(), "scripts/package-workbench.ps1"),
      "utf8",
    );
    expect(packageScript).toContain('(Join-Path $desktop "dist")');
    expect(packageScript).toContain('(Join-Path $desktop "release")');
    expect(packageScript).toMatch(
      /Remove-Item -LiteralPath \$generatedDirectory -Recurse -Force/u,
    );
    const nativeScript = await fs.readFile(
      path.resolve(process.cwd(), "scripts/build-native.ps1"),
      "utf8",
    );
    expect(nativeScript).toContain("1.85.0-x86_64-pc-windows-msvc");
    expect(nativeScript).not.toContain("link-self-contained");
    expect(nativeScript).toContain('"target\\windows-msvc"');
  });
});
