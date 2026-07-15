import type { LookupAddress } from "node:dns";
import { lookup as dnsLookup } from "node:dns/promises";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

export interface TimestampTransportOptions {
  request?: typeof https.request;
  connectTimeoutMs?: number;
  totalTimeoutMs?: number;
  maxResponseBytes?: number;
  resolve?: (hostname: string) => Promise<LookupAddress[]>;
}

const nonPublicAddresses = new BlockList();
const loopbackAddresses = new BlockList();
loopbackAddresses.addSubnet("127.0.0.0", 8, "ipv4");
loopbackAddresses.addAddress("::1", "ipv6");
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
] as const) {
  nonPublicAddresses.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["2001:db8::", 32],
] as const) {
  nonPublicAddresses.addSubnet(network, prefix, "ipv6");
}

function isLoopbackAddress(address: string, family: number): boolean {
  return loopbackAddresses.check(address, family === 6 ? "ipv6" : "ipv4");
}

function isPublicAddress(address: LookupAddress): boolean {
  return !nonPublicAddresses.check(
    address.address,
    address.family === 6 ? "ipv6" : "ipv4",
  );
}

function derBase64ToPem(value: string): string {
  const base64 = Buffer.from(value, "base64").toString("base64");
  const lines = base64.match(/.{1,64}/gu) ?? [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----\n`;
}

export async function postTimestampRequest(
  endpoint: string,
  requestDer: Buffer,
  httpsRoots: string[],
  signal: AbortSignal,
  options: TimestampTransportOptions = {},
): Promise<Buffer> {
  const target = new URL(endpoint);
  if (
    target.protocol !== "https:" ||
    target.username !== "" ||
    target.password !== "" ||
    target.hash !== ""
  ) {
    throw new Error(
      "TSA_ENDPOINT_INVALID: imported endpoint is not safe HTTPS.",
    );
  }
  const requestImpl = options.request ?? https.request;
  const connectTimeoutMs = options.connectTimeoutMs ?? 10_000;
  const totalTimeoutMs = options.totalTimeoutMs ?? 30_000;
  const maxResponseBytes = options.maxResponseBytes ?? 1024 * 1024;
  const startedAt = Date.now();
  if (signal.aborted) throw new Error("ABORT_ERR: request cancelled.");
  const resolveEndpoint =
    options.resolve ??
    ((hostname: string) => dnsLookup(hostname, { all: true, verbatim: true }));
  const resolvedHostname = target.hostname.replace(/^\[|\]$/gu, "");
  const addresses = await new Promise<LookupAddress[]>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, value?: LookupAddress[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", aborted);
      if (error) reject(error);
      else resolve(value ?? []);
    };
    const timeout = setTimeout(
      () => finish(new Error("TSA_TOTAL_TIMEOUT: TSA request timed out.")),
      totalTimeoutMs,
    );
    const aborted = () => finish(new Error("ABORT_ERR: request cancelled."));
    signal.addEventListener("abort", aborted, { once: true });
    resolveEndpoint(resolvedHostname).then(
      (value) => finish(undefined, value),
      (error: unknown) =>
        finish(
          new Error(
            `TSA_DNS_FAILED: ${error instanceof Error ? error.message : String(error)}`,
          ),
        ),
    );
  });
  if (signal.aborted) throw new Error("ABORT_ERR: request cancelled.");
  if (addresses.length === 0) {
    throw new Error(
      "TSA_DNS_POLICY_REJECTED: endpoint resolved to no address.",
    );
  }
  const literalFamily = isIP(resolvedHostname);
  const loopbackEndpoint =
    resolvedHostname.toLowerCase() === "localhost" ||
    (literalFamily > 0 && isLoopbackAddress(resolvedHostname, literalFamily));
  const addressesAllowed = loopbackEndpoint
    ? addresses.every((address) =>
        isLoopbackAddress(address.address, address.family),
      )
    : addresses.every(isPublicAddress);
  if (!addressesAllowed) {
    throw new Error(
      "TSA_DNS_POLICY_REJECTED: endpoint resolution crossed the imported public/loopback scope.",
    );
  }
  const pinnedLookup: LookupFunction = (_hostname, lookupOptions, callback) => {
    if (lookupOptions.all) callback(null, addresses);
    else {
      const selected = addresses[0]!;
      callback(null, selected.address, selected.family);
    }
  };
  const remainingTotalMs = Math.max(
    1,
    totalTimeoutMs - (Date.now() - startedAt),
  );
  return new Promise<Buffer>((resolve, reject) => {
    let settled = false;
    const timers: { total?: NodeJS.Timeout } = {};
    const finish = (error?: Error, value?: Buffer) => {
      if (settled) return;
      settled = true;
      if (timers.total) clearTimeout(timers.total);
      if (error) reject(error);
      else resolve(value ?? Buffer.alloc(0));
    };
    const request = requestImpl(
      target,
      {
        method: "POST",
        headers: {
          accept: "application/timestamp-reply",
          "content-type": "application/timestamp-query",
          "content-length": String(requestDer.byteLength),
        },
        ...(httpsRoots.length > 0
          ? { ca: httpsRoots.map(derBase64ToPem) }
          : {}),
        signal,
        lookup: pinnedLookup,
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          finish(
            new Error(
              `TSA_HTTP_STATUS_INVALID: expected 200, received ${response.statusCode ?? "unknown"}.`,
            ),
          );
          return;
        }
        const contentType = response.headers["content-type"]
          ?.trim()
          .toLowerCase();
        if (contentType !== "application/timestamp-reply") {
          response.resume();
          finish(
            new Error(
              "TSA_CONTENT_TYPE_INVALID: response must be application/timestamp-reply.",
            ),
          );
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.byteLength;
          if (size > maxResponseBytes) {
            response.destroy(
              new Error("TSA_RESPONSE_LIMIT_EXCEEDED: response exceeds 1 MiB."),
            );
            return;
          }
          chunks.push(chunk);
        });
        response.once("end", () => finish(undefined, Buffer.concat(chunks)));
        response.once("error", (error) => finish(error));
      },
    );
    request.setTimeout(connectTimeoutMs, () => {
      request.destroy(
        new Error("TSA_CONNECT_TIMEOUT: TSA connection timed out."),
      );
    });
    request.once("error", (error) => finish(error));
    timers.total = setTimeout(() => {
      request.destroy(new Error("TSA_TOTAL_TIMEOUT: TSA request timed out."));
    }, remainingTotalMs);
    request.end(requestDer);
  });
}
