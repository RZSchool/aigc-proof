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
    expect(combined).not.toMatch(/src\/(?:main|preload)\//u);
  });
});
