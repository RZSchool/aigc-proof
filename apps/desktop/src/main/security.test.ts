import { describe, expect, it } from "vitest";

import { isAllowedNavigation, parseQaPort } from "./security";

describe("Electron security helpers", () => {
  it("enables CDP only for one explicit bounded QA port", () => {
    expect(parseQaPort(["app.exe"])).toBeUndefined();
    expect(parseQaPort(["--aigc-proof-qa-port=9229"])).toBe(9229);
    expect(parseQaPort(["--aigc-proof-qa-port=80"])).toBeUndefined();
    expect(
      parseQaPort(["--aigc-proof-qa-port=9229", "--aigc-proof-qa-port=9230"]),
    ).toBeUndefined();
  });

  it("denies remote navigation", () => {
    expect(isAllowedNavigation("file:///C:/app/index.html")).toBe(true);
    expect(isAllowedNavigation("https://example.com")).toBe(false);
    expect(
      isAllowedNavigation("http://127.0.0.1:5173/a", "http://127.0.0.1:5173"),
    ).toBe(true);
  });
});
