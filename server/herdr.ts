// Optional adapter for the new Herdr desktop app's herdr-core runtime.
// A mobile tmux session holds only an attach client, never the original program.
import type { Run } from "./conversations.ts";

type CoreSnapshot = { core: string; terminals: any[]; layout?: any };
type Space = { id: string; title: string; path: string; order: number };
type Tab = { id: string; title: string; order: number };
export type HerdrTerminal = {
  id: string;
  address: string;
  title: string;
  path: string;
  state: string;
  agent: string;
  session: string | null;
  space?: Space;
  tab?: Tab;
  paneOrder?: number;
};
const ID = /^[a-f0-9]{32}\/t[0-9a-z]{1,13}\/[0-9]{1,16}$/;
const clean = (s: unknown, limit = 160) =>
  typeof s === "string"
    ? s.replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, limit)
    : "";
export class HerdrError extends Error {}

// Read the app's actual hierarchy. Equal names and directories do not establish
// membership; only a terminal address inside a space's tab tree does.
export function herdrLayout(layout: any, terminals: any[]) {
  const result = new Map<
    string,
    { space: Space; tab: Tab; paneOrder: number; pane?: string }
  >();
  const byAddress = new Map(terminals.map((t) => [t?.address, t]));
  const spaces = Array.isArray(layout?.spaces) ? layout.spaces : [];
  for (const [spaceOrder, rawSpace] of spaces.entries()) {
    if (typeof rawSpace?.id !== "string" || !Array.isArray(rawSpace.tabs)) {
      continue;
    }
    const members: Array<{ address: string; tab: Tab; pane?: string }> = [];
    for (const [tabOrder, rawTab] of rawSpace.tabs.entries()) {
      if (typeof rawTab?.id !== "string") continue;
      const tab = {
        id: rawTab.id,
        title: clean(rawTab.name) || `Tab ${tabOrder + 1}`,
        order: tabOrder,
      };
      const stack = [{ node: rawTab.root, depth: 0 }];
      let visited = 0;
      while (stack.length && visited++ < 4096) {
        const { node, depth } = stack.pop()!;
        if (!node || depth > 32) continue;
        if (
          typeof node.content?.terminal === "string" &&
          byAddress.has(node.content.terminal)
        ) {
          members.push({
            address: node.content.terminal,
            tab,
            pane: typeof node.id === "string" ? node.id : undefined,
          });
        }
        if (Array.isArray(node.children)) {
          for (const child of [...node.children].reverse()) {
            stack.push({ node: child, depth: depth + 1 });
          }
        }
      }
    }
    const first = byAddress.get(members[0]?.address);
    const path = first?.foreground?.cwd || first?.cwd || rawSpace.folder;
    const folder = clean(path, 4096);
    const space = {
      id: rawSpace.id,
      title: clean(rawSpace.name) || folder.split("/").filter(Boolean).at(-1) ||
        "Herdr space",
      path: folder,
      order: spaceOrder,
    };
    for (const [paneOrder, member] of members.entries()) {
      // Ambiguous membership is not an invitation to put one terminal in two places.
      if (result.has(member.address)) continue;
      result.set(member.address, {
        space,
        tab: member.tab,
        paneOrder,
        pane: member.pane,
      });
    }
  }
  return result;
}

export function herdrTerminal(
  core: string,
  terminal: any,
): HerdrTerminal | null {
  const id = `${core}/${terminal?.address}/${terminal?.created_ms}`;
  const path = terminal?.foreground?.cwd || terminal?.cwd;
  if (
    !ID.test(id) || terminal.state !== "live" ||
    typeof path !== "string" || !path.startsWith("/") || /[\0\r\n]/.test(path)
  ) return null;
  const state = terminal.status?.state;
  return {
    id,
    address: terminal.address,
    title: clean(terminal.title) || clean(terminal.name) ||
      clean(terminal.labels?.where) || terminal.address,
    path,
    state: ["idle", "working", "blocked", "done", "error"].includes(state)
      ? state
      : "ready",
    agent: clean(
      terminal.status?.app || terminal.foreground?.name || "terminal",
      64,
    ),
    session: null,
  };
}

export async function readHerdr(
  coreSession = "default",
): Promise<CoreSnapshot> {
  // status never starts a core. No SSH machines are dialled or programs started.
  const command = async (args: string[], input?: string) => {
    const child = new Deno.Command("herdr-core", {
      args,
      env: { HC_SESSION: coreSession },
      stdin: input == null ? "null" : "piped",
      stdout: "piped",
      stderr: "null",
      signal: AbortSignal.timeout(3000),
    }).spawn();
    if (input != null) {
      const writer = child.stdin.getWriter();
      await writer.write(new TextEncoder().encode(input));
      await writer.close();
    }
    const result = await child.output();
    if (!result.success || result.stdout.length > 4 * 1024 * 1024) {
      throw new HerdrError("Herdr is unavailable");
    }
    return new TextDecoder().decode(result.stdout);
  };
  const status = JSON.parse(await command(["server", "status"]));
  if (!/^[a-f0-9]{32}$/.test(status.core?.id)) {
    throw new HerdrError("Herdr is not running");
  }
  const input = ["hello", "terminal.list", "doc.get"].map((method, i) =>
    JSON.stringify({
      jsonrpc: "2.0",
      id: i + 1,
      method,
      params: method === "doc.get" ? { name: "herdr-app" } : {},
    }) + "\n"
  ).join("");
  const replies = (await command(["connect", "--session", coreSession], input))
    .trim().split("\n").map((line) => JSON.parse(line));
  const hello = replies.find((r) => r.id === 1)?.result;
  const list = replies.find((r) => r.id === 2)?.result;
  if (
    hello?.core?.id !== status.core.id ||
    !hello.methods?.includes("terminal.attach") ||
    !Array.isArray(list?.terminals)
  ) {
    throw new HerdrError("This Herdr runtime is incompatible");
  }
  return {
    core: status.core.id,
    terminals: list.terminals,
    layout: replies.find((r) => r.id === 3)?.result?.value,
  };
}

export function herdrSession(terminal: HerdrTerminal) {
  const [core, address, created] = terminal.id.split("/");
  return `herdr-${core.slice(0, 16)}-${address}-${created}`;
}

export function herdrAttachArgs(
  terminal: HerdrTerminal,
  shell: string,
  coreSession = "default",
) {
  const name = herdrSession(terminal);
  return [
    "new-session",
    "-d",
    "-s",
    name,
    "-c",
    terminal.path,
    "-x",
    "100",
    "-y",
    "32",
    "-e",
    `HC_SESSION=${coreSession}`,
    "--",
    shell,
    "-lc",
    'exec "$0" "$@"',
    "herdr-core",
    "attach",
    "--history",
    "1000",
    terminal.address,
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
    "@deskpilot-herdr-id",
    terminal.id,
    ";",
    "set-window-option",
    "-t",
    `=${name}:`,
    "remain-on-exit",
    "on",
  ];
}

export class Herdr {
  invalidate() {
    this.cached = null;
  }
  private cached: {
    at: number;
    value: { available: boolean; items: HerdrTerminal[] };
  } | null = null;
  private loading:
    | Promise<{ available: boolean; items: HerdrTerminal[] }>
    | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private run: Run,
    private shell: string,
    private read = readHerdr,
    private coreSession = "default",
  ) {}

  private async links() {
    const result = await this.run("tmux", [
      "list-sessions",
      "-F",
      "#{session_name}\t#{@deskpilot-herdr-id}\t#{pane_dead}",
    ]);
    return new Map(
      result.out.split("\n").flatMap((line) => {
        const [name, id, dead] = line.split("\t");
        return ID.test(id ?? "") && dead === "0" ? [[id, name]] : [];
      }),
    );
  }

  async list() {
    if (this.cached && Date.now() - this.cached.at < 4000) {
      return this.cached.value;
    }
    if (this.loading) return await this.loading;
    this.loading = (async () => {
      let value: { available: boolean; items: HerdrTerminal[] };
      try {
        const snapshot = await this.read(this.coreSession);
        const links = await this.links();
        const layout = herdrLayout(snapshot.layout, snapshot.terminals);
        const items = snapshot.terminals.flatMap((raw) => {
          const terminal = herdrTerminal(snapshot.core, raw);
          return terminal
            ? [{
              ...terminal,
              ...layout.get(terminal.address),
              session: links.get(terminal.id) ?? null,
            }]
            : [];
        });
        value = { available: true, items };
      } catch {
        value = { available: false, items: [] };
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
    if (!ID.test(id)) throw new HerdrError("Invalid Herdr terminal");
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => release = resolve);
    await previous;
    try {
      const snapshot = await this.read(this.coreSession);
      const terminal = snapshot.terminals.map((raw) =>
        herdrTerminal(snapshot.core, raw)
      ).find((t) => t?.id === id);
      if (!terminal) {
        throw new HerdrError("This Herdr terminal is no longer running");
      }
      const existing = (await this.links()).get(id);
      if (existing) return { session: existing, reused: true };
      const name = herdrSession(terminal);
      if (!(await this.run("tmux", ["has-session", "-t", `=${name}`])).code) {
        throw new HerdrError(
          "A mobile terminal already uses this name. Close it before retrying.",
        );
      }
      const result = await authorizedRun(
        "tmux",
        herdrAttachArgs(terminal, this.shell, this.coreSession),
      );
      if (result.code) {
        throw new HerdrError(
          "Could not open the mobile terminal. Your Herdr session is unchanged.",
        );
      }
      this.cached = null;
      return { session: name, reused: false };
    } finally {
      release();
    }
  }
}
