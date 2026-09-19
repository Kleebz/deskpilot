import { assertEquals } from "jsr:@std/assert@1";
import {
  serviceControl,
  type SystemctlRunner,
} from "../server/service-control.ts";

function runner(
  calls: string[][],
  active = "active",
  enabled = "enabled",
): SystemctlRunner {
  return async (args) => {
    calls.push(args);
    const query = args[0] === "is-active"
      ? active
      : args[0] === "is-enabled"
      ? enabled
      : "";
    return { success: true, stdout: query, stderr: "" };
  };
}

Deno.test("pause stops now without changing automatic startup", async () => {
  const calls: string[][] = [];
  assertEquals(await serviceControl("pause", runner(calls)), 0);
  assertEquals(calls, [
    ["stop", "deskpilot"],
    ["is-active", "deskpilot"],
    ["is-enabled", "deskpilot"],
  ]);
});

Deno.test("resume starts now without enabling", async () => {
  const calls: string[][] = [];
  assertEquals(
    await serviceControl("resume", runner(calls, "active", "disabled")),
    0,
  );
  assertEquals(calls[0], ["start", "deskpilot"]);
});

Deno.test("disable and enable change activity and automatic startup together", async () => {
  for (
    const [action, expected] of [
      ["disable", ["disable", "--now", "deskpilot"]],
      ["enable", ["enable", "--now", "deskpilot"]],
    ] as const
  ) {
    const calls: string[][] = [];
    assertEquals(await serviceControl(action, runner(calls)), 0);
    assertEquals(calls[0], [...expected]);
  }
});

Deno.test("status queries both independent service states", async () => {
  const calls: string[][] = [];
  assertEquals(
    await serviceControl("status", runner(calls, "inactive", "enabled")),
    0,
  );
  assertEquals(calls, [
    ["is-active", "deskpilot"],
    ["is-enabled", "deskpilot"],
  ]);
});

Deno.test("a failed systemctl action is returned", async () => {
  const run: SystemctlRunner = async () => ({
    success: false,
    stdout: "",
    stderr: "no bus",
  });
  assertEquals(await serviceControl("pause", run), 1);
});
