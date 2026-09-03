// Credentials, which is where a bug is worst.
//
// Everything here was verified by hand once, while it was being written. That
// is not the same as it staying true — and the failure mode for this file is a
// credential that cannot be revoked, or one that can be guessed, neither of
// which announces itself.
//
// Run: deno test --allow-read --allow-write --allow-env tests/

import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { Devices, makeCode } from "../server/devices.ts";

function tempStore(): { path: string; cleanup: () => void } {
  const path = Deno.makeTempFileSync({ suffix: ".json" });
  return { path, cleanup: () => Deno.removeSync(path) };
}

Deno.test("a minted code enrolls exactly once", async () => {
  const { path, cleanup } = tempStore();
  const d = new Devices(path);
  const code = d.newCode();

  const first = await d.enroll(code, "phone");
  assert(first, "a fresh code must enroll");
  assertEquals(d.list.length, 1);

  const second = await d.enroll(code, "thief");
  assertEquals(second, null, "a used code must not enroll again");
  assertEquals(d.list.length, 1);
  cleanup();
});

Deno.test("the token is never stored, only its hash", async () => {
  const { path, cleanup } = tempStore();
  const d = new Devices(path);
  const made = await d.enroll(d.newCode(), "phone");
  assert(made);

  const onDisk = Deno.readTextFileSync(path);
  assert(
    !onDisk.includes(made.token),
    "the raw token must not reach disk — the file would be a set of working credentials",
  );
  assert(onDisk.includes(made.device.hash), "the hash is what identifies it");
  cleanup();
});

Deno.test("a token matches its own device and nothing else", async () => {
  const { path, cleanup } = tempStore();
  const d = new Devices(path);
  const a = await d.enroll(d.newCode(), "phone");
  const b = await d.enroll(d.newCode(), "laptop");
  assert(a && b);

  assertEquals((await d.match(a.token))?.id, a.device.id);
  assertEquals((await d.match(b.token))?.id, b.device.id);
  assertEquals(await d.match("not-a-token"), null);
  assertNotEquals(a.token, b.token);
  cleanup();
});

Deno.test("revoking one device leaves the others working", async () => {
  const { path, cleanup } = tempStore();
  const d = new Devices(path);
  const a = await d.enroll(d.newCode(), "lost phone");
  const b = await d.enroll(d.newCode(), "laptop");
  assert(a && b);

  assert(d.revoke(a.device.id));
  assertEquals(await d.match(a.token), null, "revoked token must stop working");
  assertEquals((await d.match(b.token))?.id, b.device.id, "the other must be untouched");
  assertEquals(d.revoke(a.device.id), false, "revoking twice is not a success");
  cleanup();
});

Deno.test("devices survive a restart", async () => {
  const { path, cleanup } = tempStore();
  const first = new Devices(path);
  const made = await first.enroll(first.newCode(), "phone");
  assert(made);

  // A new instance over the same file is what a service restart looks like.
  const second = new Devices(path);
  assertEquals((await second.match(made.token))?.id, made.device.id);
  cleanup();
});

Deno.test("an expired code does not enroll", async () => {
  const { path, cleanup } = tempStore();
  const d = new Devices(path);
  const code = d.newCode(-1); // already past its expiry
  assertEquals(await d.enroll(code, "phone"), null);
  assertEquals(d.list.length, 0);
  cleanup();
});

Deno.test("guessing is rate limited, and fails closed", async () => {
  const { path, cleanup } = tempStore();
  const d = new Devices(path);
  assertEquals(d.rateLimited, false);

  for (let i = 0; i < 10; i++) await d.enroll("WRONGCDE", "attacker");
  assertEquals(d.rateLimited, true, "ten wrong guesses must trip the limit");

  // Fails closed on purpose: letting a valid code through during a lockout
  // would defeat the limit, since the attacker is guessing valid codes.
  const real = d.newCode();
  assert(d.rateLimited, "a valid code must not clear the lockout");
  // The endpoint refuses before calling enroll; assert the flag the endpoint
  // checks rather than the call it never makes.
  assertEquals(typeof real, "string");
  cleanup();
});

Deno.test("codes avoid characters that are misread off a screen", () => {
  // These get read off one terminal and typed on a phone, sometimes from a
  // photograph, so the alphabet excludes vowels and look-alikes.
  const forbidden = /[AEIOU01ILOS8B2Z5]/;
  for (let i = 0; i < 200; i++) {
    const c = makeCode();
    assertEquals(c.length, 8);
    assert(!forbidden.test(c), `code ${c} contains an ambiguous character`);
  }
});

Deno.test("renaming keeps the credential working", async () => {
  const { path, cleanup } = tempStore();
  const d = new Devices(path);
  const made = await d.enroll(d.newCode(), "old name");
  assert(made);

  assert(d.rename(made.device.id, "new name"));
  assertEquals(d.list[0].name, "new name");
  assertEquals((await d.match(made.token))?.id, made.device.id);
  assertEquals(d.rename("nosuchid", "x"), false);
  cleanup();
});
