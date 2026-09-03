// Per-device credentials, and the enrollment that mints them.
//
// Until now there was one token for everything: written once at install, never
// expiring, handed to every device that paired. Losing a phone meant
// regenerating it and re-pairing every other device, because there was nothing
// smaller than "all access" to take away. Two people pairing to one machine
// were the same identity, since identity was the secret and the secret was
// shared.
//
// A device now gets its own token. Revoking one leaves the others alone, and
// the list says what is paired so you can tell.
//
// Tokens are stored as SHA-256 hashes. The server never needs the original —
// it only ever answers "does this match" — so the state file is not a set of
// working credentials. That is a straight improvement on the shared token,
// which necessarily sits in plaintext because pair.sh has to print it.
//
// This is deliberately not passkeys yet. Passkeys change what the credential
// *is*; revocation and per-device identity are what actually unblock other
// people using this, and they are the foundation the passkey work sits on.

const ENC = new TextEncoder();

export type Device = {
  id: string;
  name: string;
  hash: string;      // sha256 of the token, hex
  created: number;
  lastSeen: number;
};

export type Enrollment = {
  code: string;
  expires: number;
};

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", ENC.encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomHex(bytes: number): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// No vowels and no look-alikes. Look-alikes because this gets read off one
// screen and typed on another, sometimes from a photograph of a terminal:
// 0/O, 1/I/L, 5/S, 8/B, 2/Z. Vowels because without them a code cannot spell a
// word, and a random code that happens to spell something is a bad surprise.
//
// 22 characters over 8 positions is about 35 bits, which is only enough because
// codes are single-use, expire in ten minutes and are rate limited.
const CODE_ALPHABET = "34679CDFGHJKMNPQRTVWXY";

export function makeCode(len = 8): string {
  const b = new Uint8Array(len);
  crypto.getRandomValues(b);
  // Modulo bias is negligible at this alphabet size and the code is
  // short-lived, single-use and rate-limited.
  return [...b].map((x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join("");
}

export class Devices {
  #path: string;
  #list: Device[] = [];
  // Enrollment codes live only in memory: a restart invalidating a code that
  // has not been used yet is the safe direction to fail.
  #pending: Enrollment[] = [];
  // Failed enrollment attempts, so a short code cannot be brute-forced.
  #fails: number[] = [];

  constructor(path: string) {
    this.#path = path;
    try {
      const raw = JSON.parse(Deno.readTextFileSync(path));
      if (Array.isArray(raw)) this.#list = raw;
    } catch { /* first run */ }
  }

  get list(): Device[] {
    return this.#list;
  }

  // Written synchronously. It was fire-and-forget, which left a window where a
  // token had been handed out but not recorded: a crash in that window gives
  // someone a credential the server will never recognise. The file is a few
  // hundred bytes and this happens on enrol and revoke, not per request.
  #save() {
    try {
      Deno.writeTextFileSync(this.#path, JSON.stringify(this.#list, null, 2));
    } catch { /* nothing useful to do — the in-memory list is still right */ }
  }

  // Returns the device that matches, so the caller can record it was used.
  async match(token: string): Promise<Device | null> {
    const h = await sha256(token);
    // Not constant-time across the list, but each comparison is of a hash of
    // the supplied value: learning which entry matched requires already knowing
    // a matching token.
    return this.#list.find((d) => d.hash === h) ?? null;
  }

  touch(d: Device) {
    const now = Date.now();
    // Once a minute is enough to answer "is this device still in use" without
    // writing the file on every request.
    if (now - d.lastSeen < 60_000) return;
    d.lastSeen = now;
    this.#save();
  }

  // A code is good for ten minutes and one use. Long enough to walk to another
  // room or read it out of an SSH session; short enough that a code left on a
  // screen is not a standing invitation.
  newCode(ttlMs = 600_000): string {
    this.#sweep();
    const code = makeCode();
    this.#pending.push({ code, expires: Date.now() + ttlMs });
    return code;
  }

  #sweep() {
    const now = Date.now();
    this.#pending = this.#pending.filter((e) => e.expires > now);
    this.#fails = this.#fails.filter((t) => now - t < 600_000);
  }

  get rateLimited(): boolean {
    this.#sweep();
    return this.#fails.length >= 10;
  }

  // Consumes the code and mints a token. The token is returned once, here, and
  // never stored — only its hash is kept.
  async enroll(code: string, name: string): Promise<{ token: string; device: Device } | null> {
    this.#sweep();
    const i = this.#pending.findIndex((e) => e.code === code.toUpperCase().trim());
    if (i < 0) {
      this.#fails.push(Date.now());
      return null;
    }
    this.#pending.splice(i, 1);

    const token = randomHex(32);
    const device: Device = {
      id: randomHex(8),
      name: name.slice(0, 40) || "device",
      hash: await sha256(token),
      created: Date.now(),
      lastSeen: Date.now(),
    };
    this.#list.push(device);
    this.#save();
    return { token, device };
  }

  revoke(id: string): boolean {
    const before = this.#list.length;
    this.#list = this.#list.filter((d) => d.id !== id);
    if (this.#list.length === before) return false;
    this.#save();
    return true;
  }

  rename(id: string, name: string): boolean {
    const d = this.#list.find((x) => x.id === id);
    if (!d) return false;
    d.name = name.slice(0, 40);
    this.#save();
    return true;
  }
}
