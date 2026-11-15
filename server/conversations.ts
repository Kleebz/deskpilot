// Resumable-agent adapters stop at the tmux boundary. The ordinary session,
// input, approval and terminal transport code remains agent-agnostic.
import { type CodexConnection, connectCodex } from "./codex-rpc.ts";
import { sessionBase } from "./run.ts";

type Result = { code: number; out: string; err: string };
export type Run = (command: string, args: string[]) => Promise<Result>;
export type Daemon = { socket: string };
export type Conversation = {
  id: string;
  title: string;
  path: string;
  state: string;
  session: string | null;
};
export const THREAD_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export class ConversationError extends Error {}

export async function codexDaemon(run: Run): Promise<Daemon> {
  const result = await run("codex", ["app-server", "daemon", "version"]);
  if (result.code) {
    throw new ConversationError("Codex shared sessions are unavailable");
  }
  let info;
  try {
    info = JSON.parse(result.out);
  } catch {
    throw new ConversationError("Codex shared sessions are unavailable");
  }
  if (
    info.status !== "running" || typeof info.socketPath !== "string" ||
    !info.socketPath.startsWith("/") || /[\r\n\0]/.test(info.socketPath)
  ) {
    throw new ConversationError(
      "Start Codex normally to make its conversations available",
    );
  }
  return { socket: info.socketPath };
}

// Only addressable root conversations; never infer identity from title, cwd,
// process order or --last. Several conversations can share every one of those.
export function conversation(thread: any): Conversation | null {
  if (
    !THREAD_ID.test(thread?.id) || typeof thread.cwd !== "string" ||
    !thread.cwd.startsWith("/") || /[\0\r\n]/.test(thread.cwd) ||
    thread.parentThreadId ||
    (thread.forkedFromId && thread.sessionId !== thread.id) ||
    thread.canAcceptDirectInput !== true ||
    !["idle", "active"].includes(thread.status?.type)
  ) return null;
  const text = (value: unknown, max: number) =>
    typeof value === "string"
      ? value.replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, max)
      : "";
  return {
    id: thread.id,
    title: text(thread.name, 160) || text(thread.preview, 160) ||
      sessionBase(thread.cwd),
    path: thread.cwd,
    state: thread.status.type === "active" ? "working" : "ready",
    session: null,
  };
}

export function mobileSession(thread: Conversation) {
  return `${sessionBase(thread.path).slice(0, 15)}-mobile-${thread.id}`;
}

export function codexAttachArgs(
  thread: Conversation,
  daemon: Daemon,
  shell: string,
) {
  const name = mobileSession(thread);
  return [
    "new-session",
    "-d",
    "-s",
    name,
    "-c",
    thread.path,
    "-x",
    "100",
    "-y",
    "32",
    "--",
    shell,
    "-lc",
    'exec "$0" "$@"',
    "codex",
    "--remote",
    `unix://${daemon.socket}`,
    "resume",
    thread.id,
    "--cd",
    thread.path,
    "--no-alt-screen",
    ";",
    "set-option",
    "-t",
    name,
    "detach-on-destroy",
    "on",
    ";",
    "set-option",
    "-t",
    name,
    "@deskpilot-codex-thread",
    thread.id,
    ";",
    "set-option",
    "-t",
    name,
    "@deskpilot-codex-title64",
    btoa(
      String.fromCharCode(
        ...new TextEncoder().encode(thread.title.slice(0, 160)),
      ),
    ),
    ";",
    "set-option",
    "-t",
    name,
    "@deskpilot-codex-socket",
    daemon.socket,
    ";",
    "set-window-option",
    "-t",
    `=${name}:`,
    "remain-on-exit",
    "on",
  ];
}

export class Conversations {
  private cached: { at: number; value: any } | null = null;
  private loading: Promise<any> | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private run: Run,
    private shell: string,
    private daemon = () => codexDaemon(run),
    private connect: (socket: string) => Promise<CodexConnection> =
      connectCodex,
  ) {}

  private async linked(socket: string): Promise<Map<string, string>> {
    const result = await this.run("tmux", [
      "list-sessions",
      "-F",
      "#{session_name}\t#{@deskpilot-codex-thread}\t#{@deskpilot-codex-socket}\t#{pane_dead}",
    ]);
    return new Map(
      result.out.split("\n").flatMap((line) => {
        const [name, id, backend, dead] = line.split("\t");
        return THREAD_ID.test(id ?? "") && backend === socket && dead === "0"
          ? [[id, name]]
          : [];
      }),
    );
  }

  async list() {
    if (this.cached && Date.now() - this.cached.at < 4000) {
      return this.cached.value;
    }
    if (this.loading) return await this.loading;
    this.loading = (async () => {
      let rpc: CodexConnection | undefined;
      let value;
      try {
        const daemon = await this.daemon();
        rpc = await this.connect(daemon.socket);
        const loaded = await rpc.call("thread/loaded/list", { limit: 100 });
        const links = await this.linked(daemon.socket);
        const items: Conversation[] = [];
        const ids = Array.isArray(loaded.data)
          ? loaded.data.filter((id: string) => THREAD_ID.test(id)).slice(0, 100)
          : [];
        for (let i = 0; i < ids.length; i += 8) {
          const results = await Promise.allSettled(
            ids.slice(i, i + 8).map((id: string) =>
              rpc!.call("thread/read", { threadId: id, includeTurns: false })
            ),
          );
          for (const result of results) {
            if (result.status !== "fulfilled") continue;
            const thread = conversation(result.value?.thread);
            if (thread) {
              items.push({ ...thread, session: links.get(thread.id) ?? null });
            }
          }
        }
        value = { available: true, items };
      } catch {
        // Optional discovery must not break ordinary/headless session polling.
        value = { available: false, items: [] };
      } finally {
        await rpc?.close();
      }
      this.cached = { at: Date.now(), value };
      return value;
    })();
    try {
      return await this.loading;
    } finally {
      this.loading = null;
    }
  }

  async enable(id: string, authorizedRun: Run) {
    if (!THREAD_ID.test(id)) {
      throw new ConversationError("Invalid conversation");
    }
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => release = resolve);
    await previous;
    let rpc: CodexConnection | undefined;
    try {
      const daemon = await this.daemon();
      rpc = await this.connect(daemon.socket);
      const loaded = await rpc.call("thread/loaded/list", { limit: 100 });
      if (!loaded.data?.includes(id)) {
        throw new ConversationError(
          "This conversation is no longer running. Open it in Codex first.",
        );
      }
      const thread = conversation(
        (await rpc.call("thread/read", { threadId: id, includeTurns: false }))
          .thread,
      );
      if (!thread) {
        throw new ConversationError(
          "This conversation cannot be connected safely",
        );
      }
      const links = await this.linked(daemon.socket);
      const existing = links.get(id);
      if (existing) return { session: existing, reused: true };
      const name = mobileSession(thread);
      const found = await this.run("tmux", ["has-session", "-t", `=${name}`]);
      if (!found.code) {
        throw new ConversationError(
          "A mobile terminal already uses this name. Close it before retrying.",
        );
      }
      // No prompt, permission overrides, shell profile changes, desktop input,
      // process signals or window closure. Explicit --remote pins the existing
      // backend, so a failed attach cannot silently start another agent.
      const created = await authorizedRun(
        "tmux",
        codexAttachArgs(thread, daemon, this.shell),
      );
      if (created.code) {
        throw new ConversationError(
          "Could not open the mobile terminal. Your desktop conversation is unchanged.",
        );
      }
      this.cached = null;
      return { session: name, reused: false };
    } finally {
      try {
        await rpc?.close();
      } finally {
        release();
      }
    }
  }
}
