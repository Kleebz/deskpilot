// Structural changes go through Herdr's own app commands. Discovery and attach
// remain independent of this optional desktop client; never rewrite its document.
import { HerdrError, herdrLayout, herdrTerminal, readHerdr } from "./herdr.ts";
import type { Run } from "./conversations.ts";

type Snapshot = Awaited<ReturnType<typeof readHerdr>>;
export type ManagedTab = {
  id: string;
  title: string;
  order: number;
  pane: string | null;
  terminals: string[];
  panes: number;
  revision: string;
};
export type ManagedSpace = {
  id: string;
  title: string;
  path: string;
  order: number;
  active: boolean;
  tabs: ManagedTab[];
  revision: string;
};
export type Management = {
  available: boolean;
  writable: boolean;
  reason: string;
  core: string;
  spaces: ManagedSpace[];
  activeSpace: string;
  activeTab: string;
  moveAcrossSpaces: false;
};
const text = (v: unknown, max = 160) =>
  typeof v === "string" && v.length <= max && !/[\x00-\x1f\x7f]/.test(v)
    ? v.trim()
    : null;
const nativeId = (v: unknown): v is string =>
  typeof v === "string" && /^[A-Za-z0-9_-]{1,96}$/.test(v);
async function digest(v: unknown) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(v)),
  );
  return Array.from(
    new Uint8Array(bytes),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function managementLayout(
  snapshot: Snapshot,
): Promise<ManagedSpace[]> {
  const metadata = herdrLayout(snapshot.layout, snapshot.terminals);
  const addresses = new Map(snapshot.terminals.flatMap((raw) => {
    const terminal = herdrTerminal(snapshot.core, raw);
    return terminal ? [[terminal.address, terminal.id] as const] : [];
  }));
  const spaces: ManagedSpace[] = [];
  for (
    const [order, space]
      of (Array.isArray(snapshot.layout?.spaces) ? snapshot.layout.spaces : [])
        .entries()
  ) {
    if (!nativeId(space?.id) || !Array.isArray(space.tabs)) continue;
    const tabs: ManagedTab[] = [];
    for (const [tabOrder, tab] of space.tabs.entries()) {
      if (!nativeId(tab?.id)) continue;
      const members: string[] = [],
        panes: string[] = [],
        stack = [{ node: tab.root, depth: 0 }];
      let visited = 0;
      while (stack.length && visited++ < 4096) {
        const { node, depth } = stack.pop()!;
        if (!node || depth > 32) continue;
        if (node.type === "block" && nativeId(node.id)) panes.push(node.id);
        const id = addresses.get(node.content?.terminal);
        if (id) members.push(id);
        if (Array.isArray(node.children)) {
          for (const child of [...node.children].reverse()) {
            stack.push({ node: child, depth: depth + 1 });
          }
        }
      }
      tabs.push({
        id: tab.id,
        title: text(tab.name) || `Tab ${tabOrder + 1}`,
        order: tabOrder,
        pane: panes[0] ?? null,
        terminals: [...new Set(members)],
        panes: panes.length,
        revision: await digest([snapshot.core, tab, members]),
      });
    }
    const first = [...metadata.values()].find((m) => m.space.id === space.id)
      ?.space;
    spaces.push({
      id: space.id,
      title: first?.title || text(space.name) || "Herdr space",
      path: first?.path || text(space.folder, 4096) || "",
      order,
      active: false,
      tabs,
      revision: await digest([
        snapshot.core,
        space,
        tabs.map((t) => t.revision),
      ]),
    });
  }
  return spaces;
}

export class HerdrManagement {
  private cached: { at: number; value: Management } | null = null;
  private loading: Promise<Management> | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private run: Run,
    private read = readHerdr,
    private shell = "/bin/bash",
  ) {}
  invalidate() {
    this.cached = null;
  }
  async list(fresh = false): Promise<Management> {
    if (!fresh && this.cached && Date.now() - this.cached.at < 4000) {
      return this.cached.value;
    }
    if (!fresh && this.loading) return this.loading;
    const load = async (): Promise<Management> => {
      let snapshot: Snapshot;
      try {
        snapshot = await this.read();
      } catch {
        return {
          available: false,
          writable: false,
          reason: "Herdr is not running.",
          core: "",
          spaces: [],
          activeSpace: "",
          activeTab: "",
          moveAcrossSpaces: false,
        };
      }
      const spaces = await managementLayout(snapshot);
      const result: Management = {
        available: true,
        writable: false,
        reason:
          "Open Herdr on this computer to manage its spaces and tabs. Running terminals remain accessible.",
        core: snapshot.core,
        spaces,
        activeSpace: "",
        activeTab: "",
        moveAcrossSpaces: false,
      };
      try {
        const [ls, status] = await Promise.all([
          this.run("herdr-app", ["ls"]),
          this.run("herdr-app", ["status"]),
        ]);
        if (ls.code || status.code || ls.out.length > 4 * 1024 * 1024) {
          return result;
        }
        const local = JSON.parse(ls.out).spaces?.filter((s: any) => !s.machine),
          focused = JSON.parse(status.out);
        if (!Array.isArray(snapshot.layout?.spaces) || !Array.isArray(local)) {
          return result;
        }
        // The running app must see exactly this core's local space/tab identities.
        const ids = (ss: any[]) =>
          ss.map((s) => [s.id, s.tabs?.map((t: any) => t.id)]);
        if (JSON.stringify(ids(local)) !== JSON.stringify(ids(spaces))) {
          return {
            ...result,
            reason:
              "Herdr's layout is synchronizing. Refresh before managing it.",
          };
        }
        result.writable = true;
        result.reason = "";
        result.activeSpace = spaces.some((s) => s.id === focused.space)
          ? focused.space
          : spaces[0]?.id ?? "";
        const active = spaces.find((s) => s.id === result.activeSpace);
        result.activeTab = active?.tabs.some((t) => t.id === focused.tab)
          ? focused.tab
          : active?.tabs[0]?.id ?? "";
        for (const space of spaces) {
          space.active = space.id === result.activeSpace;
          const appSpace = local.find((s: any) => s.id === space.id);
          // The app resolves automatic repository names; use its own display
          // labels when available, while all routing remains ID-based.
          space.title = text(appSpace?.name) || space.title;
          for (const tab of space.tabs) {
            tab.title = text(
              appSpace?.tabs?.find((t: any) => t.id === tab.id)?.name,
            ) || tab.title;
          }
        }
      } catch {
        /* A closed/missing app must not interrupt core terminal access. */
      }
      return result;
    };
    const pending = load();
    if (!fresh) this.loading = pending;
    try {
      const value = await pending;
      this.cached = { at: Date.now(), value };
      return value;
    } finally {
      if (this.loading === pending) this.loading = null;
    }
  }

  async act(body: any, authorized: Run) {
    const allowed = [
      "space.new",
      "space.rename",
      "space.move",
      "space.close",
      "tab.new",
      "tab.rename",
      "tab.move",
      "tab.close",
      "pane.split",
      "terminal.stop",
    ];
    if (!body || !allowed.includes(body.action)) {
      throw new HerdrError("Unsupported Herdr action");
    }
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => release = resolve);
    await previous;
    try {
      const state = await this.list(true);
      if (!state.available || body.core !== state.core) {
        throw new HerdrError("Herdr changed. Refresh before trying again.");
      }
      if (!state.writable) throw new HerdrError(state.reason);
      const space = state.spaces.find((s) => s.id === body.spaceId),
        tab = space?.tabs.find((t) => t.id === body.tabId);
      if (body.action !== "space.new" && !space) {
        throw new HerdrError("This Herdr space is no longer available");
      }
      if (
        (body.action.startsWith("tab.") && body.action !== "tab.new" ||
          body.action === "pane.split") && !tab
      ) throw new HerdrError("This Herdr tab is no longer available");
      let args: Record<string, unknown> = {};
      if (
        ["space.rename", "tab.rename", "space.new", "tab.new"].includes(
          body.action,
        )
      ) {
        const name = text(body.name);
        if (name === null) {
          throw new HerdrError("Use a name of at most 160 characters.");
        }
        args.name = name;
      }
      if (["space.new", "tab.new", "pane.split"].includes(body.action)) {
        const folder = text(body.folder, 4096),
          command = text(body.command, 4096);
        if (!folder?.startsWith("/")) {
          throw new HerdrError("Choose an absolute folder path.");
        }
        if (command === null) {
          throw new HerdrError("Use a command of at most 4096 characters.");
        }
        if (body.action !== "pane.split") args.folder = folder;
        if (command) {
          args.argv = [
            this.shell,
            "-lc",
            body.action === "pane.split"
              ? 'cd -- "$1" && exec "$0" -lc "$2"'
              : command,
            ...(body.action === "pane.split"
              ? [this.shell, folder, command]
              : []),
          ];
        }
      }
      if (body.action.startsWith("space.") && space) args.id = space.id;
      if (body.action.startsWith("tab.") && tab) args.id = tab.id;
      if (body.action === "tab.new") args.space = space!.id;
      if (body.action.endsWith(".move")) {
        const size = body.action === "space.move"
          ? state.spaces.length
          : space!.tabs.length;
        if (
          !Number.isInteger(body.index) || body.index < 1 || body.index > size
        ) throw new HerdrError("Invalid Herdr position");
        args.index = body.index;
      }
      if (body.action.endsWith(".close")) {
        const target = body.action === "space.close" ? space! : tab!;
        if (body.expected !== target.revision) {
          throw new HerdrError(
            "The work in this target changed. Review its terminals again before closing.",
          );
        }
        args.confirmed = true;
      }
      if (body.action === "pane.split") {
        if (!tab!.pane) throw new HerdrError("This tab has no pane to split.");
        args.pane = tab!.pane;
        args.direction = body.direction === "down" ? "down" : "right";
        // An empty command still creates a shell in the requested folder.
        if (!args.argv) {
          args.argv = [
            this.shell,
            "-lc",
            'cd -- "$1" && exec "$0"',
            this.shell,
            body.folder,
          ];
        }
      }
      if (body.action === "terminal.stop") {
        const snapshot = await this.read();
        const terminal = snapshot.terminals.map((t) =>
          herdrTerminal(snapshot.core, t)
        ).find((t) => t?.id === body.terminalId);
        if (
          snapshot.core !== state.core || !terminal ||
          !space!.tabs.some((t) => t.terminals.includes(terminal.id))
        ) {
          throw new HerdrError(
            "This terminal changed. Refresh before stopping it.",
          );
        }
        if (body.expected !== terminal.id) {
          throw new HerdrError("Review the terminal before stopping it.");
        }
        const pane = herdrLayout(snapshot.layout, snapshot.terminals).get(
          terminal.address,
        )?.pane;
        if (!nativeId(pane)) {
          throw new HerdrError("This terminal has no managed Herdr pane.");
        }
        const stopped = await authorized("herdr-app", [
          "do",
          "pane.close",
          JSON.stringify({ pane }),
        ]);
        if (stopped.code) {
          throw new HerdrError(
            "Herdr could not stop this terminal. Refresh to check its state.",
          );
        }
      } else {
        const result = await authorized("herdr-app", [
          "do",
          body.action,
          JSON.stringify(args),
        ]);
        if (result.code) {
          throw new HerdrError(
            "Herdr did not complete this action. Refresh its layout before retrying.",
          );
        }
      }
      this.invalidate();
      return { ok: true };
    } finally {
      release();
    }
  }
}
