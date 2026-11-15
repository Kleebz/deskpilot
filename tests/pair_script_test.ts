import { assert, assertEquals } from "jsr:@std/assert@1";
const root = new URL("../", import.meta.url).pathname;
const decode = (v: Uint8Array) => new TextDecoder().decode(v);
async function runPair(answer: string, exitCode: number) {
  const dir = await Deno.makeTempDir({ prefix: "dp-pair-" });
  try {
    await Deno.mkdir(`${dir}/bin`);
    await Deno.mkdir(`${dir}/.local/state/deskpilot`, { recursive: true });
    await Deno.writeTextFile(
      `${dir}/.local/state/deskpilot/local-token`,
      "local-secret-never-published",
    );
    await Deno.writeTextFile(
      `${dir}/bin/curl`,
      `#!/bin/sh\ncase "$*" in\n *devices/code*) printf '%s' '${answer}'; exit ${exitCode} ;;\n *) exit 0 ;;\nesac\n`,
      { mode: 0o700 },
    );
    await Deno.writeTextFile(`${dir}/bin/systemctl`, "#!/bin/sh\nexit 0\n", {
      mode: 0o700,
    });
    const result = await new Deno.Command("sh", {
      args: [
        "-c",
        'exec /bin/bash "$1" --link http://example.invalid',
        "pair-test",
        `${root}shell/pair.sh`,
      ],
      clearEnv: true,
      env: { HOME: dir, PATH: `${dir}/bin:/usr/bin:/bin` },
      stdout: "piped",
      stderr: "piped",
    }).output();
    const out = decode(result.stdout), err = decode(result.stderr);
    assert(
      !out.includes("local-secret-never-published") &&
        !err.includes("local-secret-never-published"),
    );
    assert(!out.includes("?token="));
    return { code: result.code, out, err };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}
Deno.test("pair --link publishes only an expiring code", async () => {
  const r = await runPair('{"code":"34679CDF"}', 0);
  assertEquals(r.code, 0);
  assertEquals(r.out.trim(), "http://example.invalid/?code=34679CDF");
});
Deno.test("an unavailable pairing endpoint never falls back to a bearer token", async () => {
  const r = await runPair("", 22);
  assertEquals(r.code, 1);
  assertEquals(r.out, "");
  assert(r.err.includes("pairing code"));
});
Deno.test("a failed pairing response with no code cannot produce a pairing link", async () => {
  const r = await runPair('{"error":"unauthorized"}', 0);
  assertEquals(r.code, 1);
  assertEquals(r.out, "");
});
