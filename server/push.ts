// Web Push, implemented against the specs rather than pulled from npm.
//
// The whole of it is VAPID (RFC 8292) to prove who is sending, and aes128gcm
// (RFC 8291 over RFC 8188) to encrypt the payload so the push service — Google's
// or Mozilla's, whichever the browser picked — relays ciphertext it cannot read.
// That property is the reason this is worth doing at all on a machine whose
// whole security posture is "no public listener exists": the notification goes
// out through a third party, but the third party learns nothing from it.
//
// No dependency, because the alternative is a node-compat npm package fetched
// at startup inside a systemd unit that must come up without a network round
// trip. WebCrypto has every primitive this needs.

const enc = new TextEncoder();

// TextEncoder returns a fresh ArrayBuffer-backed array; this only restates that
// for the type checker so encoded strings can be passed straight to WebCrypto.
const bytes = (s: string): Bytes => enc.encode(s) as Bytes;

export type Subscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

// ---- base64url ----

// WebCrypto's TypeScript surface wants a BufferSource backed by a real
// ArrayBuffer, and a bare Uint8Array is typed as possibly SharedArrayBuffer.
// Every byte string here is therefore explicitly Bytes.
type Bytes = Uint8Array<ArrayBuffer>;

function b64urlEncode(bytes: Bytes): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Bytes {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Bytes[]): Bytes {
  const out = new Uint8Array(new ArrayBuffer(parts.reduce((n, p) => n + p.length, 0)));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

// ---- VAPID identity ----
//
// One keypair for the life of the install. The public half is handed to the
// browser at subscribe time and baked into the subscription, so regenerating it
// silently invalidates every existing subscription — hence it is written once
// and read forever after.

type Vapid = { publicKey: string; privateJwk: JsonWebKey };

let vapid: Vapid | null = null;

export async function loadVapid(path: string): Promise<Vapid> {
  if (vapid) return vapid;
  try {
    vapid = JSON.parse(await Deno.readTextFile(path)) as Vapid;
    return vapid;
  } catch {
    const pair = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    ) as CryptoKeyPair;
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
    vapid = {
      publicKey: b64urlEncode(raw),
      privateJwk: await crypto.subtle.exportKey("jwk", pair.privateKey),
    };
    await Deno.writeTextFile(path, JSON.stringify(vapid, null, 2));
    return vapid;
  }
}

async function signJwt(v: Vapid, audience: string, subject: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "jwk",
    v.privateJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const header = b64urlEncode(bytes(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  // Twelve hours: comfortably inside the 24h ceiling push services enforce,
  // and long enough that a burst of notifications reuses one signature.
  const body = b64urlEncode(bytes(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: subject,
  })));
  const data = bytes(`${header}.${body}`);
  // WebCrypto returns ECDSA signatures as raw r||s, which is exactly the form
  // JWS wants. A DER-wrapped signature would be rejected.
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, data),
  );
  return `${header}.${body}.${b64urlEncode(sig)}`;
}

// ---- payload encryption (RFC 8291) ----

async function hkdf(
  salt: Bytes,
  ikm: Bytes,
  info: Bytes,
  len: number,
): Promise<Bytes> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    key,
    len * 8,
  );
  return new Uint8Array(bits);
}

async function encryptPayload(sub: Subscription, plaintext: string): Promise<Bytes> {
  const uaPublic = b64urlDecode(sub.keys.p256dh);
  const authSecret = b64urlDecode(sub.keys.auth);

  // A fresh ephemeral keypair per message: reusing one would let the push
  // service correlate messages, and the spec requires it regardless.
  const eph = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  ) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", eph.publicKey));

  const uaKey = await crypto.subtle.importKey(
    "raw",
    uaPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, eph.privateKey, 256),
  );

  // The auth secret is the salt here, and the two public keys are bound into
  // the info string — that is what ties the derived key to this exact pair of
  // endpoints rather than to the ECDH output alone.
  const prk = await hkdf(
    authSecret,
    shared,
    concat(bytes("WebPush: info\0"), uaPublic, asPublic),
    32,
  );

  const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16))) as Bytes;
  const cek = await hkdf(salt, prk, bytes("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, prk, bytes("Content-Encoding: nonce\0"), 12);

  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // 0x02 is the delimiter marking this as the final record. Without it the
  // browser waits for a continuation that never comes and drops the message.
  const padded = concat(bytes(plaintext), new Uint8Array([2]) as Bytes);
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, key, padded),
  );

  // Header: salt(16) | record size(4, big-endian) | key id length(1) | key(65)
  const rs = new Uint8Array(new ArrayBuffer(4)) as Bytes;
  new DataView(rs.buffer).setUint32(0, 4096, false);
  return concat(salt, rs, new Uint8Array([asPublic.length]) as Bytes, asPublic, sealed);
}

// ---- sending ----

export type PushResult = { ok: boolean; status: number; gone: boolean };

/**
 * Returns gone=true when the push service reports the subscription is dead
 * (404/410), which is the signal to forget it. Every other failure is left
 * alone: a 5xx is the service having a bad day, not the phone going away.
 */
export async function sendPush(
  v: Vapid,
  sub: Subscription,
  payload: unknown,
  subject: string,
): Promise<PushResult> {
  const audience = new URL(sub.endpoint).origin;
  const jwt = await signJwt(v, audience, subject);
  const body = await encryptPayload(sub, JSON.stringify(payload));

  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      "authorization": `vapid t=${jwt}, k=${v.publicKey}`,
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      "ttl": "600",
      "urgency": "normal",
    },
    body,
  });
  // The body is drained even when ignored, or Deno keeps the connection open.
  await res.text().catch(() => "");
  return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 };
}
