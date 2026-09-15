import { assert, assertEquals } from "jsr:@std/assert@1";
import { validateSubscription } from "../server/push.ts";

function b64url(bytes: Uint8Array): string {
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const publicKey = new Uint8Array(65);
publicKey[0] = 4;
const valid = {
  endpoint: "https://push.example/subscription",
  keys: { p256dh: b64url(publicKey), auth: b64url(new Uint8Array(16)) },
};

Deno.test("push subscriptions require HTTPS and correctly sized keys", () => {
  assert(validateSubscription(valid));
  assertEquals(
    validateSubscription({ ...valid, endpoint: "http://push.example/x" }),
    false,
  );
  assertEquals(
    validateSubscription({ ...valid, keys: { ...valid.keys, auth: "short" } }),
    false,
  );
  assertEquals(
    validateSubscription({
      ...valid,
      keys: { ...valid.keys, p256dh: b64url(new Uint8Array(64)) },
    }),
    false,
  );
});
