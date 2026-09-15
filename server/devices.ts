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
  hash: string; // sha256 of the token, hex
  created: number;
  lastSeen: number;
};

export type Enrollment = {
  code: string;
  expires: number;
};

export class DeviceStoreError extends Error {
  committed: boolean;

  constructor(message: string, committed = false, cause?: unknown) {
    super(message, { cause });
    this.name = "DeviceStoreError";
    this.committed = committed;
  }
}

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", ENC.encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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
  #syncDirectory: (path: string) => void;

  constructor(
    path: string,
    options: { syncDirectory?: (path: string) => void } = {},
  ) {
    this.#path = path;
    this.#syncDirectory = options.syncDirectory ?? ((dir) => {
      const parent = Deno.openSync(dir, { read: true });
      try {
        parent.syncSync();
      } finally {
        parent.close();
      }
    });
    try {
      const raw = JSON.parse(Deno.readTextFileSync(path));
      if (!Array.isArray(raw)) throw new Error("root value is not an array");
      for (const [i, d] of raw.entries()) {
        if (
          !d || typeof d !== "object" || typeof d.id !== "string" ||
          typeof d.name !== "string" || typeof d.hash !== "string" ||
          typeof d.created !== "number" || typeof d.lastSeen !== "number"
        ) throw new Error(`invalid device record at index ${i}`);
      }
      this.#list = raw;
      // Older versions created this with the process umask. Tighten an existing
      // valid store on load as well as every newly written replacement.
      Deno.chmodSync(path, 0o600);
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) return; // genuine first run
      throw new DeviceStoreError(
        `devices: cannot load existing credential store ${path}: ${
          e instanceof Error ? e.message : e
        }`,
        false,
        e,
      );
    }
  }

  get list(): Device[] {
    return this.#list;
  }

  has(id: string): boolean {
    return this.#list.some((d) => d.id === id);
  }

  // Written synchronously. It was fire-and-forget, which left a window where a
  // token had been handed out but not recorded: a crash in that window gives
  // someone a credential the server will never recognise. The file is a few
  // hundred bytes and this happens on enrol and revoke, not per request.
  #save(candidate: Device[]) {
    const slash = this.#path.lastIndexOf("/");
    const dir = slash >= 0 ? this.#path.slice(0, slash) || "/" : ".";
    const base = slash >= 0 ? this.#path.slice(slash + 1) : this.#path;
    let temp = "";
    let committed = false;
    try {
      temp = Deno.makeTempFileSync({
        dir,
        prefix: `.${base}.`,
        suffix: ".tmp",
      });
      Deno.chmodSync(temp, 0o600);
      const file = Deno.openSync(temp, { write: true, truncate: true });
      try {
        const data = ENC.encode(JSON.stringify(candidate, null, 2) + "\n");
        let offset = 0;
        while (offset < data.length) {
          const written = file.writeSync(data.subarray(offset));
          if (written <= 0) {
            throw new Error("short write to credential temporary file");
          }
          offset += written;
        }
        file.syncSync();
      } finally {
        file.close();
      }
      Deno.renameSync(temp, this.#path);
      temp = "";
      committed = true;
      Deno.chmodSync(this.#path, 0o600);
      // Persist the directory entry as well as the file contents. This is what
      // makes an acknowledged rename survive a sudden power loss on Unix.
      this.#syncDirectory(dir);
    } catch (e) {
      if (temp) {
        try {
          Deno.removeSync(temp);
        } catch { /* best effort cleanup */ }
      }
      throw new DeviceStoreError(
        `devices: could not persist ${this.#path}: ${
          e instanceof Error ? e.message : e
        }`,
        committed,
        e,
      );
    }
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
    const previous = d.lastSeen;
    d.lastSeen = now;
    try {
      this.#save(this.#list);
    } catch (e) {
      if (!(e instanceof DeviceStoreError) || !e.committed) {
        d.lastSeen = previous;
      }
      console.error(e instanceof Error ? e.message : e);
    }
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
  async enroll(
    code: string,
    name: string,
  ): Promise<{ token: string; device: Device } | null> {
    this.#sweep();
    const i = this.#pending.findIndex((e) =>
      e.code === code.toUpperCase().trim()
    );
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
    const next = [...this.#list, device];
    try {
      this.#save(next);
      this.#list = next;
    } catch (e) {
      if (e instanceof DeviceStoreError && e.committed) this.#list = next;
      throw e;
    }
    return { token, device };
  }

  revoke(id: string): boolean {
    const next = this.#list.filter((d) => d.id !== id);
    if (next.length === this.#list.length) return false;
    try {
      this.#save(next);
      this.#list = next;
    } catch (e) {
      if (e instanceof DeviceStoreError && e.committed) this.#list = next;
      throw e;
    }
    return true;
  }

  rename(id: string, name: string): boolean {
    const d = this.#list.find((x) => x.id === id);
    if (!d) return false;
    const next = this.#list.map((x) =>
      x.id === id ? { ...x, name: name.slice(0, 40) } : x
    );
    try {
      this.#save(next);
      this.#list = next;
    } catch (e) {
      if (e instanceof DeviceStoreError && e.committed) this.#list = next;
      throw e;
    }
    return true;
  }
}
