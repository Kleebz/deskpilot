export type ServiceAction =
  | "pause"
  | "resume"
  | "disable"
  | "enable"
  | "status";

type Result = { success: boolean; stdout: string; stderr: string };
export type SystemctlRunner = (args: string[]) => Promise<Result>;

const UNIT = "deskpilot";

async function systemctl(args: string[]): Promise<Result> {
  try {
    const out = await new Deno.Command("systemctl", {
      args: ["--user", ...args],
      stdout: "piped",
      stderr: "piped",
    }).output();
    const decode = (value: Uint8Array) =>
      new TextDecoder().decode(value).trim();
    return {
      success: out.success,
      stdout: decode(out.stdout),
      stderr: decode(out.stderr),
    };
  } catch (e) {
    return {
      success: false,
      stdout: "",
      stderr: e instanceof Error ? e.message : String(e),
    };
  }
}

async function state(run: SystemctlRunner) {
  const [active, enabled] = await Promise.all([
    run(["is-active", UNIT]),
    run(["is-enabled", UNIT]),
  ]);
  return {
    active: active.stdout || "unknown",
    enabled: enabled.stdout || "unknown",
  };
}

export async function serviceControl(
  action: ServiceAction,
  run: SystemctlRunner = systemctl,
): Promise<number> {
  if (action === "status") {
    const current = await state(run);
    console.log(`deskpilot is ${current.active}`);
    console.log(
      current.enabled === "enabled"
        ? "automatic startup is enabled"
        : current.enabled === "disabled"
        ? "automatic startup is disabled"
        : `automatic startup: ${current.enabled}`,
    );
    return current.active === "unknown" && current.enabled === "unknown"
      ? 1
      : 0;
  }

  const commands: Record<Exclude<ServiceAction, "status">, string[]> = {
    pause: ["stop", UNIT],
    resume: ["start", UNIT],
    disable: ["disable", "--now", UNIT],
    enable: ["enable", "--now", UNIT],
  };
  const result = await run(commands[action]);
  if (!result.success) {
    console.error(result.stderr || `could not ${action} deskpilot`);
    return 1;
  }

  const current = await state(run);
  if (action === "pause") {
    console.log("deskpilot paused");
    console.log(
      current.enabled === "enabled"
        ? "it will start automatically at the next login or reboot"
        : "automatic startup is disabled; use 'deskpilot enable' to restore it",
    );
  } else if (action === "resume") {
    console.log("deskpilot resumed");
    if (current.enabled !== "enabled") {
      console.log(
        "automatic startup is still disabled; use 'deskpilot enable' to restore it",
      );
    }
  } else if (action === "disable") {
    console.log("deskpilot stopped and automatic startup disabled");
  } else {
    console.log("deskpilot started and automatic startup enabled");
  }
  console.log("tmux sessions are unaffected");
  return 0;
}

if (import.meta.main) {
  const action = Deno.args[0] as ServiceAction;
  if (!["pause", "resume", "disable", "enable", "status"].includes(action)) {
    console.error("usage: deskpilot pause|resume|disable|enable|status");
    Deno.exit(2);
  }
  Deno.exit(await serviceControl(action));
}
