import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";

const root = new URL("../", import.meta.url).pathname;
const helper = `${root}scripts/terminal.sh`;
const selectAndRun =
  '. "$1"; shift; terminal=$(deskpilot_terminal_select) || exit; deskpilot_terminal_command exec "$terminal" "$@"';

async function fixture(
  test: (f: {
    dir: string;
    env: Record<string, string>;
    executable: (name: string, body?: string) => Promise<string>;
    run: (
      args?: string[],
      env?: Record<string, string>,
    ) => Promise<Deno.CommandOutput>;
    captured: () => Promise<string[]>;
  }) => Promise<void>,
) {
  const dir = await Deno.makeTempDir({ prefix: "deskpilot-terminal-" });
  await Deno.mkdir(`${dir}/bin`);
  await Deno.symlink("/bin/sh", `${dir}/bin/sh`);
  const env = {
    HOME: dir,
    PATH: `${dir}/bin`,
    DESKPILOT_CONFIG: `${dir}/config`,
    CAPTURE: `${dir}/capture`,
    SHELL: "/bin/sh",
  };
  try {
    await test({
      dir,
      env,
      executable: async (
        name,
        body = 'printf \'%s\\0\' "$@" > "$CAPTURE"\n',
      ) => {
        const path = `${dir}/bin/${name}`;
        await Deno.writeTextFile(path, `#!/bin/sh\n${body}`, { mode: 0o700 });
        return path;
      },
      run: (args = [], extra = {}) =>
        new Deno.Command("/usr/bin/sh", {
          args: ["-c", selectAndRun, "terminal-test", helper, ...args],
          clearEnv: true,
          env: { ...env, ...extra },
          stdout: "piped",
          stderr: "piped",
        }).output(),
      captured: async () =>
        (await Deno.readTextFile(env.CAPTURE)).split("\0").slice(0, -1),
    });
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const words = [
  "/a command",
  "two words",
  "quote'\";$(touch NEVER)",
  "line\nbreak",
  "",
];

Deno.test("system default dispatcher receives a distinct app id and unchanged argv", () =>
  fixture(async (f) => {
    await f.executable(
      "xdg-terminal-exec",
      'if [ "$1" = --print-id ]; then echo ghostty.desktop; exit 0; fi\nprintf \'%s\\0\' "$@" > "$CAPTURE"\n',
    );
    const result = await f.run(words);
    assert(result.success, new TextDecoder().decode(result.stderr));
    const args = await f.captured();
    assertMatch(args[0], /^--app-id=com\.deskpilot\.Terminal\.[A-Za-z0-9_-]+$/);
    assertEquals(args.slice(1), ["--", ...words]);
    await f.run(words);
    assert(
      (await f.captured())[0] !== args[0],
      "separate launches must not share a GTK instance",
    );
  }));

Deno.test("unexported config selects Ghostty and isolates its instance", () =>
  fixture(async (f) => {
    const ghostty = await f.executable("ghostty");
    await Deno.writeTextFile(
      f.env.DESKPILOT_CONFIG,
      `DESKPILOT_TERMINAL='${ghostty}'\n`,
    );
    const result = await f.run(words);
    assert(result.success);
    const args = await f.captured();
    assertEquals(args[0], "--gtk-single-instance=false");
    assertMatch(args[1], /^--class=com\.deskpilot\.Terminal\.[A-Za-z0-9_-]+$/);
    assertEquals(args.slice(2), ["-e", ...words]);
  }));

Deno.test("explicit environment override wins over config and permits wrapper paths with spaces", () =>
  fixture(async (f) => {
    const wrapper = await f.executable("custom terminal");
    await Deno.writeTextFile(
      f.env.DESKPILOT_CONFIG,
      "DESKPILOT_TERMINAL=missing-configured-terminal\n",
    );
    assert((await f.run(words, { DESKPILOT_TERMINAL: wrapper })).success);
    assertEquals(await f.captured(), ["-e", ...words]);
  }));

Deno.test("desktop session launcher reads terminal config without an exported variable", () =>
  fixture(async (f) => {
    const terminal = await f.executable("custom terminal");
    const runner = await f.executable("deskpilot");
    await Deno.writeTextFile(
      f.env.DESKPILOT_CONFIG,
      `DESKPILOT_TERMINAL='${terminal}'\n`,
    );
    const result = await new Deno.Command("/usr/bin/sh", {
      args: [`${root}scripts/session.sh`, "writing"],
      clearEnv: true,
      env: {
        ...f.env,
        DESKPILOT_BIN: runner,
        TMUX: "old-session",
        TMUX_PANE: "%1",
      },
      stdout: "piped",
      stderr: "piped",
    }).output();
    assert(result.success, new TextDecoder().decode(result.stderr));
    for (let i = 0; i < 50; i++) {
      try {
        await Deno.stat(f.env.CAPTURE);
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    assertEquals(await f.captured(), [
      "-e",
      runner,
      "run",
      "--name",
      "writing",
      "--",
      "/bin/sh",
      "-l",
    ]);
  }));

Deno.test("a dispatcher without a usable terminal falls back to TERMINAL", () =>
  fixture(async (f) => {
    await f.executable("xdg-terminal-exec", "exit 1\n");
    const terminal = await f.executable("kitty");
    assert((await f.run(words, { TERMINAL: terminal })).success);
    assertEquals(await f.captured(), ["-e", ...words]);
  }));

Deno.test("an unusable dispatcher in TERMINAL still permits the installed-emulator fallback", () =>
  fixture(async (f) => {
    const dispatcher = await f.executable("xdg-terminal-exec", "exit 1\n");
    await f.executable("kitty");
    assert((await f.run(words, { TERMINAL: dispatcher })).success);
    assertEquals(await f.captured(), ["-e", ...words]);
  }));

Deno.test("session placement records the new window identity and bounds stale identities", async (t) => {
  for (const count of [0, 40]) {
    await t.step(`${count} previous windows`, () =>
      fixture(async (f) => {
        const terminal = await f.executable("ghostty");
        await f.executable("hyprctl", 'printf \'%s\' "$2" > "$LUA_CAPTURE"\n');
        await f.executable(
          "tmux",
          'if [ "$1" = show-option ]; then printf \'%s\' "$PREVIOUS"; else printf \'%s\\0\' "$@" > "$CAPTURE"; fi\n',
        );
        const previous = Array.from({ length: count }, (_, i) =>
          `com.deskpilot.Terminal.old${i}`);
        const result = await new Deno.Command("/usr/bin/sh", {
          args: [
            "-c",
            'exec /bin/bash "$@"',
            "desk-test",
            `${root}scripts/desk.sh`,
            "place-session",
            "4",
            "desk-2",
          ],
          clearEnv: true,
          env: {
            ...f.env,
            DESKPILOT_TERMINAL: terminal,
            HYPRLAND_INSTANCE_SIGNATURE: "test",
            PREVIOUS: previous.join(" "),
            LUA_CAPTURE: `${f.dir}/lua`,
          },
          stdout: "piped",
          stderr: "piped",
        }).output();
        assert(result.success, new TextDecoder().decode(result.stderr));
        const args = await f.captured();
        assertEquals(args.slice(0, 4), [
          "set-option",
          "-t",
          "desk-2",
          "@deskpilot-window-classes",
        ]);
        const retained = args[4].split(" ");
        assertEquals(retained.length, Math.min(32, count + 1));
        assertEquals(retained.slice(0, -1), previous.slice(-31));
        assert(
          (await Deno.readTextFile(`${f.dir}/lua`)).includes(retained.at(-1)!),
        );
      }));
  }
});

Deno.test("explicit missing terminals fail instead of silently using another emulator", () =>
  fixture(async (f) => {
    await f.executable("ghostty");
    const result = await f.run(words, {
      DESKPILOT_TERMINAL: "missing-terminal",
    });
    assertEquals(result.code, 1);
    assertMatch(
      new TextDecoder().decode(result.stderr),
      /missing-terminal not found/,
    );
  }));

Deno.test("a headless machine reports no terminal without trying to launch one", () =>
  fixture(async (f) => {
    const result = await f.run(words);
    assertEquals(result.code, 1);
    assertMatch(new TextDecoder().decode(result.stderr), /no terminal found/);
  }));

Deno.test("emulators with different command flags preserve argument boundaries", async (t) => {
  for (
    const [name, prefix] of [
      ["gnome-terminal", ["--"]],
      ["mate-terminal", ["-x"]],
      ["wezterm", ["start", "--always-new-process", "--"]],
      ["konsole", ["--separate", "-e"]],
      ["alacritty", ["-e"]],
    ] as const
  ) {
    await t.step(name, () =>
      fixture(async (f) => {
        const terminal = await f.executable(name);
        assert((await f.run(words, { DESKPILOT_TERMINAL: terminal })).success);
        assertEquals(await f.captured(), [...prefix, ...words]);
      }));
  }
});

Deno.test("phone placement preserves executable paths and argv through Lua and the compositor shell", () =>
  fixture(async (f) => {
    const terminal = await f.executable("terminal's wrapper");
    await f.executable("hyprctl", 'printf \'%s\' "$2" > "$LUA_CAPTURE"\n');
    const extra = {
      DESKPILOT_TERMINAL: terminal,
      HYPRLAND_INSTANCE_SIGNATURE: "test",
      LUA_CAPTURE: `${f.dir}/lua`,
    };
    const result = await new Deno.Command("/usr/bin/sh", {
      args: [
        "-c",
        'exec /bin/bash "$@"',
        "desk-test",
        `${root}scripts/desk.sh`,
        "place-terminal",
        "4",
        ...words,
      ],
      clearEnv: true,
      env: { ...f.env, ...extra },
      stdout: "piped",
      stderr: "piped",
    }).output();
    assert(result.success, new TextDecoder().decode(result.stderr));
    const lua = await Deno.readTextFile(extra.LUA_CAPTURE);
    const match = lua.match(
      /^hl\.dsp\.exec_cmd\(("(?:[^"\\]|\\.)*"), \{ workspace = "4 silent" \}\)$/,
    );
    assert(match, lua);
    const command = JSON.parse(match[1]);
    const launched = await new Deno.Command("/usr/bin/sh", {
      args: ["-c", command],
      clearEnv: true,
      env: f.env,
      stdout: "piped",
      stderr: "piped",
    }).output();
    assert(launched.success, new TextDecoder().decode(launched.stderr));
    assertEquals(await f.captured(), ["-e", ...words]);
  }));
