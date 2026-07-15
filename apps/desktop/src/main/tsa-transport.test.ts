import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import https, { type RequestOptions } from "node:https";

import { describe, expect, it } from "vitest";

import { postTimestampRequest } from "./tsa-transport";

interface ResponsePlan {
  status?: number;
  contentType?: string;
  chunks?: Buffer[];
  connectTimeout?: boolean;
  noResponse?: boolean;
}

const publicResolution = () =>
  Promise.resolve([{ address: "93.184.216.34", family: 4 }]);

function plannedRequest(plan: ResponsePlan): {
  request: typeof https.request;
  observed: { target?: URL; options?: RequestOptions; body?: Buffer };
} {
  const observed: { target?: URL; options?: RequestOptions; body?: Buffer } =
    {};
  const request = ((
    target: URL,
    options: RequestOptions,
    callback: (response: IncomingMessage) => void,
  ) => {
    observed.target = target;
    observed.options = options;
    const emitter = new EventEmitter() as ClientRequest;
    let timeoutCallback: (() => void) | undefined;
    emitter.setTimeout = ((_milliseconds: number, callback?: () => void) => {
      timeoutCallback = callback;
      return emitter;
    }) as ClientRequest["setTimeout"];
    emitter.destroy = ((error?: Error) => {
      queueMicrotask(() =>
        emitter.emit("error", error ?? new Error("destroyed")),
      );
      return emitter;
    }) as ClientRequest["destroy"];
    emitter.end = ((body?: Buffer) => {
      if (body) observed.body = body;
      if (options.signal) {
        options.signal.addEventListener(
          "abort",
          () => emitter.destroy(new Error("ABORT_ERR: request cancelled.")),
          { once: true },
        );
      }
      if (plan.connectTimeout) {
        queueMicrotask(() => timeoutCallback?.());
        return emitter;
      }
      if (plan.noResponse) return emitter;
      queueMicrotask(() => {
        const response = new EventEmitter() as IncomingMessage;
        response.statusCode = plan.status ?? 200;
        response.headers = {
          "content-type": plan.contentType ?? "application/timestamp-reply",
        };
        response.resume = (() => response) as IncomingMessage["resume"];
        let destroyed = false;
        response.destroy = ((error?: Error) => {
          destroyed = true;
          queueMicrotask(() =>
            response.emit("error", error ?? new Error("destroyed")),
          );
          return response;
        }) as IncomingMessage["destroy"];
        callback(response);
        for (const chunk of plan.chunks ?? [Buffer.from("timestamp")]) {
          if (destroyed) break;
          response.emit("data", chunk);
        }
        if (!destroyed) response.emit("end");
      });
      return emitter;
    }) as ClientRequest["end"];
    return emitter;
  }) as typeof https.request;
  return { request, observed };
}

describe("Main-owned RFC 3161 HTTPS transport", () => {
  it("posts only the exact timestamp query with explicit trust roots", async () => {
    const planned = plannedRequest({ chunks: [Buffer.from("reply")] });
    const controller = new AbortController();
    const requestDer = Buffer.from([0x30, 0x03, 0x01, 0x02, 0x03]);
    const response = await postTimestampRequest(
      "https://tsa.example.test/rfc3161",
      requestDer,
      [Buffer.from("test-root").toString("base64")],
      controller.signal,
      { request: planned.request, resolve: publicResolution },
    );

    expect(response).toEqual(Buffer.from("reply"));
    expect(planned.observed.target?.href).toBe(
      "https://tsa.example.test/rfc3161",
    );
    expect(planned.observed.options?.method).toBe("POST");
    expect(planned.observed.options?.headers).toMatchObject({
      accept: "application/timestamp-reply",
      "content-type": "application/timestamp-query",
      "content-length": String(requestDer.byteLength),
    });
    expect(planned.observed.options?.ca).toEqual([
      "-----BEGIN CERTIFICATE-----\ndGVzdC1yb290\n-----END CERTIFICATE-----\n",
    ]);
    expect(planned.observed.body).toEqual(requestDer);
  });

  it("rejects unsafe endpoints and does not follow redirects", async () => {
    await expect(
      postTimestampRequest(
        "http://tsa.example.test/rfc3161",
        Buffer.alloc(1),
        [],
        new AbortController().signal,
      ),
    ).rejects.toThrow("TSA_ENDPOINT_INVALID");
    const rebound = plannedRequest({});
    await expect(
      postTimestampRequest(
        "https://tsa.example.test/rfc3161",
        Buffer.alloc(1),
        [],
        new AbortController().signal,
        {
          request: rebound.request,
          resolve: () => Promise.resolve([{ address: "127.0.0.1", family: 4 }]),
        },
      ),
    ).rejects.toThrow("TSA_DNS_POLICY_REJECTED");
    const escapedLoopback = plannedRequest({});
    await expect(
      postTimestampRequest(
        "https://localhost/rfc3161",
        Buffer.alloc(1),
        [],
        new AbortController().signal,
        { request: escapedLoopback.request, resolve: publicResolution },
      ),
    ).rejects.toThrow("TSA_DNS_POLICY_REJECTED");
    const redirect = plannedRequest({ status: 302 });
    await expect(
      postTimestampRequest(
        "https://tsa.example.test/rfc3161",
        Buffer.alloc(1),
        [],
        new AbortController().signal,
        { request: redirect.request, resolve: publicResolution },
      ),
    ).rejects.toThrow("TSA_HTTP_STATUS_INVALID");
  });

  it("rejects wrong media types and oversized replies", async () => {
    const wrongMedia = plannedRequest({ contentType: "application/json" });
    await expect(
      postTimestampRequest(
        "https://tsa.example.test/rfc3161",
        Buffer.alloc(1),
        [],
        new AbortController().signal,
        { request: wrongMedia.request, resolve: publicResolution },
      ),
    ).rejects.toThrow("TSA_CONTENT_TYPE_INVALID");
    const oversized = plannedRequest({ chunks: [Buffer.alloc(9)] });
    await expect(
      postTimestampRequest(
        "https://tsa.example.test/rfc3161",
        Buffer.alloc(1),
        [],
        new AbortController().signal,
        {
          request: oversized.request,
          resolve: publicResolution,
          maxResponseBytes: 8,
        },
      ),
    ).rejects.toThrow("TSA_RESPONSE_LIMIT_EXCEEDED");
  });

  it("distinguishes connect timeout, total timeout, and cancellation", async () => {
    const connectTimeout = plannedRequest({ connectTimeout: true });
    await expect(
      postTimestampRequest(
        "https://tsa.example.test/rfc3161",
        Buffer.alloc(1),
        [],
        new AbortController().signal,
        {
          request: connectTimeout.request,
          resolve: publicResolution,
          connectTimeoutMs: 1,
        },
      ),
    ).rejects.toThrow("TSA_CONNECT_TIMEOUT");

    const totalTimeout = plannedRequest({ noResponse: true });
    await expect(
      postTimestampRequest(
        "https://tsa.example.test/rfc3161",
        Buffer.alloc(1),
        [],
        new AbortController().signal,
        {
          request: totalTimeout.request,
          resolve: publicResolution,
          totalTimeoutMs: 1,
        },
      ),
    ).rejects.toThrow("TSA_TOTAL_TIMEOUT");

    const cancelled = plannedRequest({ noResponse: true });
    const controller = new AbortController();
    const pending = postTimestampRequest(
      "https://tsa.example.test/rfc3161",
      Buffer.alloc(1),
      [],
      controller.signal,
      {
        request: cancelled.request,
        resolve: publicResolution,
        totalTimeoutMs: 1_000,
      },
    );
    controller.abort();
    await expect(pending).rejects.toThrow("ABORT_ERR");
  });
});
