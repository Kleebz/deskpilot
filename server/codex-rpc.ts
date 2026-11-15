// Optional Codex adapter. Proxy only to an already running local daemon: never
// start/restart it or create a second agent backend to get at a conversation.
import WebSocket from "npm:ws@8.22.0";
import { spawn } from "node:child_process";
import { Duplex } from "node:stream";

export interface CodexConnection {
  call(method: string, params?: Record<string, unknown>): Promise<any>;
  close(): Promise<void>;
}

export async function connectCodex(
  socket: string,
  lifetimeMs = 9000,
  notify?: (message: { method: string; params: any }) => void,
): Promise<CodexConnection> {
  const proxy = spawn("codex", ["app-server", "proxy", "--sock", socket], {
    stdio: ["pipe", "pipe", "ignore"],
  });
  const exited = new Promise<void>((resolve) =>
    proxy.once("close", () => resolve())
  );
  const ws = new WebSocket("ws://localhost/", {
    createConnection: () =>
      Duplex.from({ readable: proxy.stdout!, writable: proxy.stdin! }),
    perMessageDeflate: false,
    maxPayload: 4 * 1024 * 1024,
    handshakeTimeout: 4000,
  });
  let sequence = 0;
  const pending = new Map<
    number,
    { resolve: (v: any) => void; reject: (e: Error) => void }
  >();
  const lifetime = setTimeout(() => ws.terminate(), lifetimeMs);
  const fail = () => {
    for (const request of pending.values()) {
      request.reject(new Error("Codex connection closed"));
    }
    pending.clear();
  };
  proxy.on("error", () => {
    fail();
    ws.terminate();
  });
  ws.on("error", fail);
  ws.on("close", fail);
  ws.on("message", (data: unknown) => {
    let message;
    try {
      message = JSON.parse(String(data));
    } catch {
      ws.terminate();
      return;
    }
    const request = pending.get(message.id);
    if (!request) {
      if (message.id == null && typeof message.method === "string") {
        notify?.(message);
      }
      return; // requests belong to the desktop client; discovery never subscribes
    }
    pending.delete(message.id);
    if (message.error) {
      request.reject(
        new Error(String(message.error.message || "Codex request failed")),
      );
    } else request.resolve(message.result);
  });
  const connection: CodexConnection = {
    async call(method, params = {}) {
      const id = ++sequence;
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error("Codex request timed out"));
        }, 4000);
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
        ws.send(JSON.stringify({ id, method, params }), (error?: Error) => {
          if (error) pending.get(id)?.reject(error);
        });
      });
    },
    async close() {
      clearTimeout(lifetime);
      ws.terminate();
      proxy.kill();
      const timer = setTimeout(() => proxy.kill("SIGKILL"), 1000);
      await exited;
      clearTimeout(timer);
    },
  };
  try {
    await new Promise<void>((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
      proxy.once("error", reject);
      proxy.once("close", () => reject(new Error("Codex proxy exited")));
    });
    await connection.call("initialize", {
      clientInfo: { name: "deskpilot", version: "1" },
    });
    ws.send(JSON.stringify({ method: "initialized" }));
    return connection;
  } catch (error) {
    await connection.close();
    throw error;
  }
}
