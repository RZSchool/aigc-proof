import { URL } from "node:url";

export function parseQaPort(
  argumentsList: readonly string[],
): number | undefined {
  const prefix = "--aigc-proof-qa-port=";
  const values = argumentsList.filter((value) => value.startsWith(prefix));
  if (values.length !== 1) return undefined;
  const port = Number(values[0]?.slice(prefix.length));
  return Number.isInteger(port) && port >= 1024 && port <= 65_535
    ? port
    : undefined;
}

export function isAllowedNavigation(
  target: string,
  developmentOrigin?: string,
): boolean {
  try {
    const url = new URL(target);
    if (url.protocol === "file:") return true;
    return developmentOrigin !== undefined && url.origin === developmentOrigin;
  } catch {
    return false;
  }
}
