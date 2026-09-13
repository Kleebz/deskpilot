import { assertEquals } from "jsr:@std/assert@1";
import { sessionBase, tmuxRunArgs } from "../server/run.ts";

Deno.test("managed session names are safe and derived from the directory", () => {
  assertEquals(sessionBase("/home/me/Projects/my app/"), "my-app");
  assertEquals(sessionBase("/"), "agent");
  assertEquals(sessionBase("/tmp/---"), "agent");
});

Deno.test("managed commands remain argv and configure clean session teardown", () => {
  assertEquals(
    tmuxRunArgs("deskpilot", "/tmp/my project", ["codex", "--model", "gpt 5"]),
    [
      "new-session", "-d", "-s", "deskpilot", "-c", "/tmp/my project", "--",
      "codex", "--model", "gpt 5", ";", "set-option", "-t", "deskpilot",
      "detach-on-destroy", "on", ";", "attach-session", "-t", "deskpilot",
    ],
  );
});
