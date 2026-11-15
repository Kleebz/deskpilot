import { terminalIdentity } from './terminal-identity.ts';
// Listing tmux sessions, and where each one is on screen.
//
// This is a port of scripts/sessions.sh, and the reason is packaging rather
// than taste. The shell version needs jq, which is the last dependency in the
// *portable* half — a headless box with no compositor still had to install a
// JSON processor to list its own sessions. Moving it here removes that, and
// removes a file the server would otherwise have to unpack beside itself to
// shell out to, which is what stops a compiled binary being one file.
//
// The mapping chain is unchanged and is the part worth preserving:
//
//   tmux client pid -> walk parent pids -> matching Hyprland window -> workspace
//
// It mentions no agent anywhere. It reports tmux sessions, not Claude sessions,
// and swapping the agent for a bare shell changes nothing here. The chain runs
// in this direction on purpose: the original ran workspace -> window with a `✳`
// in its title -> session, which silently tied the whole design to one agent's
// terminal title.
//
// A session with no attached client is not an error. It is detached: real and
// routable, just not on screen — which is the normal result of closing a
// terminal, since that detaches rather than kills.

export type Session = {
  session: string;
  created: number;
  terminalId?: string;
  generation?: string;
  activity: number;
  path: string;
  command: string;
  workspace: number | null;
  workspaces: number[];
  windows: string[];
  attached: boolean;
  herdrId?: string;
  codexThreadId?: string;
  conversationTitle?: string;
};

type Client = {
  pid: number;
  workspace: { id: number };
  address: string;
  class?: string;
  initialClass?: string;
};

export type UnmanagedProcess = {
  id: string;
  pid: number;
  path: string;
  agent: string;
};

async function run(cmd: string, args: string[]): Promise<string> {
  try {
    const r = await new Deno.Command(cmd, {
      args,
      stdout: "piped",
      stderr: "null",
    }).output();
    return r.code === 0 ? new TextDecoder().decode(r.stdout) : "";
  } catch {
    // A missing binary is a normal state, not a failure: a headless host has
    // no hyprctl and must still list its sessions.
    return "";
  }
}

// The whole process table as pid -> ppid, read once.
//
// The obvious implementation reads /proc/<pid>/stat, and Deno 2.9 refuses:
// /proc requires --allow-all, not --allow-read, however narrowly the path is
// scoped. Taking that would hand full access to a server whose entire job is
// shelling out — the opposite of why this is Deno rather than Bun.
//
// So `ps`, which is one more entry in an allowlist of four. Read in a single
// call rather than once per hop, which is both fewer subprocesses than the
// shell version managed and immune to a pid being reused mid-walk.
async function processParents(): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  for (const line of (await run("ps", ["-eo", "pid=,ppid="])).split("\n")) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (Number.isFinite(pid) && Number.isFinite(ppid)) map.set(pid, ppid);
  }
  return map;
}

// Walk up from a tmux client's pid until a pid matches a compositor window.
// Six hops covers terminal -> shell -> tmux client in every arrangement seen
// here, and bounds the walk on a process tree that could be adversarial.
export function windowForPid(
  start: number,
  clients: Client[],
  parents: Map<number, number>,
): Client | null {
  let p: number | undefined = start;
  for (let i = 0; i < 6; i++) {
    if (!p || p <= 1) return null;
    const hits = clients.filter((c) => c.pid === p);
    // Single-instance terminals (including Ghostty's native tabs/windows)
    // can own several windows with one PID. There is no unique association
    // in that case. Guessing the first window routes controls to other work.
    if (hits.length > 1) return null;
    if (hits.length === 1) return hits[0];
    p = parents.get(p);
  }
  return null;
}

// Launch identities cover windows whose terminal client has not started yet,
// such as Ghostty on a hidden workspace. A native tab/window can reuse a class;
// retain the same rule as PID matching: only a unique association is usable.
export function windowsForClasses(
  classes: string[],
  clients: Client[],
): Client[] {
  return classes.filter((c) =>
    /^com\.deskpilot\.Terminal\.[A-Za-z0-9_-]+$/.test(c)
  ).flatMap((c) => {
    const hits = clients.filter((w) => w.class === c || w.initialClass === c);
    return hits.length === 1 ? hits : [];
  });
}

export async function listSessions(): Promise<Session[]> {
  const rawClients = await run("hyprctl", ["clients", "-j"]);
  let clients: Client[] = [];
  try {
    const parsed = JSON.parse(rawClients || "[]");
    if (Array.isArray(parsed)) clients = parsed;
  } catch { /* no compositor, or it answered with something else */ }

  // A session can be attached from more than one terminal, so it legitimately
  // appears on several workspaces. Reporting only the last one made sessions
  // look like they had teleported between screens.
  const parents = await processParents();

  const pids = new Map<string, number[]>();
  for (
    const line of (await run("tmux", [
      "list-clients",
      "-F",
      "#{session_name} #{client_pid}",
    ])).split("\n")
  ) {
    const [name, pid] = line.trim().split(/\s+/);
    if (!name || !pid) continue;
    pids.set(name, [...(pids.get(name) ?? []), Number(pid)]);
  }

  const FIELDS = [
    "#{session_name}",
    "#{session_created}",
    "#{session_activity}",
    "#{session_path}",
    "#{pane_current_command}",
    "#{@deskpilot-window-classes}",
    "#{@deskpilot-herdr-id}",
    "#{@deskpilot-codex-thread}",
    "#{@deskpilot-codex-title64}",
    "#{session_id}",
    "#{pid}",
    "#{start_time}",
  ].join("\t");

  const out: Session[] = [];
  for (
    const line of (await run("tmux", ["list-sessions", "-F", FIELDS])).split(
      "\n",
    )
  ) {
    if (!line.trim()) continue;
    const [
      name,
      created,
      activity,
      path,
      command,
      identities = "",
      herdrId = "",
      codexThreadId = "",
      title64 = "",
      terminalId = "", serverPid = "", serverStarted = "",
    ] = line
      .split("\t");
    if (!name) continue;

    const spaces = new Set<number>();
    const windows = new Set<string>();
    for (
      const win of windowsForClasses(identities.trim().split(/\s+/), clients)
    ) {
      spaces.add(win.workspace.id);
      windows.add(win.address);
    }
    for (const pid of pids.get(name) ?? []) {
      const win = windowForPid(pid, clients, parents);
      if (!win) continue;
      spaces.add(win.workspace.id);
      windows.add(win.address);
    }

    let conversationTitle = "";
    try {
      if (title64.length <= 1024) {
        conversationTitle = new TextDecoder().decode(
          Uint8Array.from(atob(title64), (c) => c.charCodeAt(0)),
        ).replace(/[\x00-\x1f\x7f]/g, "").slice(0, 160);
      }
    } catch { /* Invalid optional title metadata must not hide a session. */ }
    const workspaces = [...spaces].sort((a, b) => a - b);
    out.push({
      session: name,
      created: Number(created) || 0,
      ...(terminalIdentity(terminalId,serverPid,serverStarted,created)??{}),
      activity: Number(activity) || 0,
      path: path ?? "",
      // What is running matters to the client: advice for a shell is wrong
      // advice for an agent, and vice versa.
      command: command ?? "",
      workspace: workspaces[0] ?? null,
      workspaces,
      windows: [...windows].sort(),
      attached: workspaces.length > 0,
      ...(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
          .test(codexThreadId)
        ? { codexThreadId, ...(conversationTitle ? { conversationTitle } : {}) }
        : {}),
      ...(/^[a-f0-9]{32}\/t[0-9a-z]{1,13}\/[0-9]{1,16}$/.test(herdrId)
        ? { herdrId }
        : {}),
    });
  }

  // Placed sessions first, in workspace order; detached ones after. 99 stands
  // in for "no workspace" so the sort puts them last without a second pass.
  return out.sort((a, b) => (a.workspace ?? 99) - (b.workspace ?? 99));
}

// Correlate an agent which has no tmux pane with the terminal window that owns
// its process tree. This makes it visible and trackable without pretending it
// has the tmux handle required for transcript capture or input.
export async function locateUnmanaged(processes: UnmanagedProcess[]) {
  const rawClients = await run("hyprctl", ["clients", "-j"]);
  let clients: Array<Client & Record<string, unknown>> = [];
  try {
    const parsed = JSON.parse(rawClients || "[]");
    if (Array.isArray(parsed)) clients = parsed;
  } catch { /* no compositor */ }
  const parents = await processParents();
  return processes.map((process) => {
    const window = windowForPid(process.pid, clients, parents);
    return {
      ...process,
      alive: parents.has(process.pid),
      workspace: window?.workspace.id ?? null,
      address: window?.address ?? null,
    };
  });
}
