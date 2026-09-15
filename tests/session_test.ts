import { assert, assertEquals } from "jsr:@std/assert@1";

Deno.test("desktop session launcher preserves shell argv and explicit name", async () => {
  const temp = await Deno.makeTempDir({ prefix: "deskpilot-session-" });
  try {
    const terminal = `${temp}/terminal`;
    const runner = `${temp}/deskpilot`;
    const capture = `${temp}/args`;
    await Deno.writeTextFile(
      terminal,
      '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$CAPTURE"\n',
      { mode: 0o700 },
    );
    await Deno.writeTextFile(runner, "#!/bin/sh\nexit 0\n", { mode: 0o700 });

    const result = await new Deno.Command("sh", {
      args: ["scripts/session.sh", "writing"],
      cwd: new URL("../", import.meta.url).pathname,
      env: {
        DESKPILOT_TERMINAL: terminal,
        DESKPILOT_BIN: runner,
        SHELL: "/bin/bash",
        CAPTURE: capture,
      },
      stdout: "piped",
      stderr: "piped",
    }).output();
    assert(result.success);
    for (let i = 0; i < 50; i++) {
      try {
        await Deno.stat(capture);
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    assertEquals((await Deno.readTextFile(capture)).trim().split("\n"), [
      "-e",
      runner,
      "run",
      "--name",
      "writing",
      "--",
      "/bin/bash",
      "-l",
    ]);
  } finally {
    await Deno.remove(temp, { recursive: true });
  }
});

Deno.test("desktop session launcher rejects unsafe names before launching", async () => {
  const result = await new Deno.Command("sh", {
    args: ["scripts/session.sh", "bad name"],
    cwd: new URL("../", import.meta.url).pathname,
    env: { DESKPILOT_TERMINAL: "/does/not/run" },
    stdout: "null",
    stderr: "piped",
  }).output();
  assertEquals(result.code, 2);
  assert(
    new TextDecoder().decode(result.stderr).includes("session names may use"),
  );
});
