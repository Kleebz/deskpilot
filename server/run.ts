// Start a command in a named tmux session and attach the current terminal.
// This is the explicit, non-invasive alternative to shell command wrapping:
// users opt in per launch with `deskpilot run codex` and may later reconnect
// to that exact process from the phone.

export function sessionBase(path: string): string {
  const leaf = path.replace(/\/+$/, "").split("/").pop() ?? "";
  return leaf.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") ||
    "agent";
}

const SAFE_NAME = /^[A-Za-z0-9_.-]{1,64}$/;

export function managedArgs(args: string[]): {
  base: string | null;
  command: string[];
  error: string | null;
} {
  let base: string | null = null;
  let command = [...args];
  if (command[0] === "--name") {
    base = command[1] ?? "";
    command = command.slice(2);
    if (!SAFE_NAME.test(base)) {
      return {
        base: null,
        command: [],
        error:
          "session names may use letters, numbers, dot, dash and underscore",
      };
    }
  }
  if (command[0] === "--") command = command.slice(1);
  return { base, command, error: null };
}

async function freeName(base: string): Promise<string> {
  for (let i = 1; i < 10_000; i++) {
    const name = i === 1 ? base : `${base}-${i}`;
    const found = await new Deno.Command("tmux", {
      args: ["has-session", "-t", `=${name}`],
      stdin: "null",
      stdout: "null",
      stderr: "null",
    }).output();
    if (found.code !== 0) return name;
  }
  throw new Error(`could not find a free session name for ${base}`);
}

export function tmuxRunArgs(name: string, cwd: string, command: string[]) {
  return [
    "new-session",
    "-d",
    "-s",
    name,
    "-c",
    cwd,
    "--",
    ...command,
    ";",
    "set-option",
    "-t",
    name,
    "detach-on-destroy",
    "on",
    ";",
    "attach-session",
    "-t",
    name,
  ];
}

export async function runManaged(args: string[]): Promise<number> {
  const parsed = managedArgs(args);
  if (parsed.error) {
    console.error(parsed.error);
    return 2;
  }
  const command = parsed.command;
  if (!command.length) {
    console.error(
      "usage: deskpilot run [--name NAME] [--] <command> [arguments...]",
    );
    return 2;
  }
  if (Deno.env.get("TMUX")) {
    console.error(
      "already inside tmux — run the command normally; this session is already managed",
    );
    return 2;
  }

  const cwd = Deno.cwd();
  let name: string;
  try {
    name = await freeName(parsed.base ?? sessionBase(cwd));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }

  try {
    const child = new Deno.Command("tmux", {
      args: tmuxRunArgs(name, cwd, command),
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    }).spawn();
    return (await child.status).code;
  } catch (e) {
    console.error(
      `could not start tmux: ${e instanceof Error ? e.message : String(e)}`,
    );
    return 1;
  }
}

if (import.meta.main) Deno.exit(await runManaged(Deno.args));
