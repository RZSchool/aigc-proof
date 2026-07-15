export class CdpClient {
  private readonly socket: WebSocket;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private readonly eventWaiters = new Map<
    string,
    Set<{
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }>
  >();

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        method?: string;
        params?: unknown;
        result?: unknown;
        error?: { message: string };
      };
      if (message.method) {
        const waiters = this.eventWaiters.get(message.method);
        if (waiters) {
          this.eventWaiters.delete(message.method);
          for (const waiter of waiters) {
            clearTimeout(waiter.timeout);
            waiter.resolve(message.params);
          }
        }
      }
      if (message.id === undefined) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
    socket.addEventListener("close", () => {
      for (const pending of this.pending.values())
        pending.reject(new Error("CDP socket closed."));
      this.pending.clear();
      for (const waiters of this.eventWaiters.values()) {
        for (const waiter of waiters) {
          clearTimeout(waiter.timeout);
          waiter.reject(new Error("CDP socket closed."));
        }
      }
      this.eventWaiters.clear();
    });
  }

  static async connect(port: number, timeoutMs = 30_000): Promise<CdpClient> {
    const deadline = Date.now() + timeoutMs;
    let webSocketDebuggerUrl = "";
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/list`);
        const targets = (await response.json()) as Array<{
          type: string;
          url: string;
          webSocketDebuggerUrl: string;
        }>;
        const page = targets.find((target) => target.type === "page");
        if (page) {
          webSocketDebuggerUrl = page.webSocketDebuggerUrl;
          break;
        }
      } catch {
        // Electron has not opened the explicit QA port yet.
      }
      await delay(200);
    }
    if (!webSocketDebuggerUrl)
      throw new Error(`Timed out waiting for Electron CDP on ${port}.`);
    const socket = new WebSocket(webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Timed out opening CDP WebSocket.")),
        10_000,
      );
      socket.addEventListener("open", () => {
        clearTimeout(timeout);
        resolve();
      });
      socket.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error("CDP WebSocket failed."));
      });
    });
    const client = new CdpClient(socket);
    await client.send("Runtime.enable");
    await client.send("Page.enable");
    return client;
  }

  async send(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<any> {
    const id = this.nextId++;
    const response = new Promise((resolve, reject) =>
      this.pending.set(id, { resolve, reject }),
    );
    this.socket.send(JSON.stringify({ id, method, params }));
    return response;
  }

  async waitForEvent<T>(method: string, timeoutMs = 30_000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const waiter = {
        resolve: (value: unknown) => resolve(value as T),
        reject,
        timeout: setTimeout(() => {
          const waiters = this.eventWaiters.get(method);
          waiters?.delete(waiter);
          if (waiters?.size === 0) this.eventWaiters.delete(method);
          reject(new Error(`Timed out waiting for CDP event ${method}.`));
        }, timeoutMs),
      };
      const waiters = this.eventWaiters.get(method) ?? new Set();
      waiters.add(waiter);
      this.eventWaiters.set(method, waiters);
    });
  }

  async evaluate<T>(expression: string): Promise<T> {
    const response = (await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    })) as {
      result: { value: T; description?: string };
      exceptionDetails?: { text: string; exception?: { description?: string } };
    };
    if (response.exceptionDetails) {
      throw new Error(
        response.exceptionDetails.exception?.description ??
          response.exceptionDetails.text,
      );
    }
    return response.result.value;
  }

  async screenshot(): Promise<Buffer> {
    const response = (await this.send("Page.captureScreenshot", {
      format: "png",
    })) as {
      data: string;
    };
    return Buffer.from(response.data, "base64");
  }

  close(): void {
    this.socket.close();
  }
}

export async function waitFor<T>(
  action: () => Promise<T>,
  predicate: (value: T) => boolean,
  description: string,
  timeoutMs = 60_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = await action();
    if (predicate(last)) return last;
    await delay(200);
  }
  throw new Error(
    `Timed out waiting for ${description}; last value: ${JSON.stringify(last)}`,
  );
}

export function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
