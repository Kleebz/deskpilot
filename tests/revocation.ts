// End-to-end revocation against an isolated compiled server and real tmux.
import { assert, assertEquals } from "jsr:@std/assert@1";

const arg = (name: string) => Deno.args[Deno.args.indexOf(name) + 1];
const base = arg("--url");
const master = arg("--token");
const session = arg("--session");
const evidence = arg("--evidence");
assert(
  base && master && session,
  "usage: revocation.ts --url URL --token TOKEN --session NAME",
);

async function call(path: string, token: string, body?: unknown) {
  return await fetch(`${base}/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function enroll(name: string) {
  const code = await (await call("/devices/code", master, {})).json();
  const res = await call("/devices/enroll", "", { code: code.code, name });
  assertEquals(res.status, 200);
  return await res.json();
}

const lost = await enroll("revocation-lost");
const kept = await enroll("revocation-kept");
let healthyPushes = 0;
let cancelPushStarted!: () => void;
const cancelPushSeen = new Promise<void>((resolve) =>
  cancelPushStarted = resolve
);
const pushAbort = new AbortController();
const pushServer = Deno.serve({
  hostname: "127.0.0.1",
  port: 0,
  signal: pushAbort.signal,
  onListen() {},
}, async (req) => {
  if (new URL(req.url).pathname === "/slow") {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  } else if (new URL(req.url).pathname === "/cancel") {
    cancelPushStarted();
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  } else healthyPushes++;
  return new Response(null, { status: 201 });
});
const lostEndpoint = `http://127.0.0.1:${pushServer.addr.port}/slow`;
const keptEndpoint = `http://127.0.0.1:${pushServer.addr.port}/healthy`;
const b64url = (bytes: Uint8Array) => {
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const keyPair = await crypto.subtle.generateKey(
  { name: "ECDH", namedCurve: "P-256" },
  true,
  ["deriveBits"],
) as CryptoKeyPair;
const fakePublic = new Uint8Array(
  await crypto.subtle.exportKey("raw", keyPair.publicKey),
);
const authSecret = crypto.getRandomValues(new Uint8Array(16));
for (const [device, endpoint] of [[lost, lostEndpoint], [kept, keptEndpoint]]) {
  const subscribed = await call("/push/subscribe", device.token, {
    endpoint,
    keys: { p256dh: b64url(fakePublic), auth: b64url(authSecret) },
    machine: base,
  });
  assertEquals(subscribed.status, 200);
}
const legacyEndpoint = `http://127.0.0.1:${pushServer.addr.port}/legacy-root`;
assertEquals(
  (await call("/push/subscribe", master, {
    endpoint: legacyEndpoint,
    keys: { p256dh: b64url(fakePublic), auth: b64url(authSecret) },
    machine: base,
  })).status,
  200,
);
assertEquals(
  (await call("/push/subscribe", kept.token, {
    endpoint: keptEndpoint,
    keys: { p256dh: b64url(fakePublic), auth: b64url(authSecret) },
    machine: base,
    replaceEndpoint: legacyEndpoint,
  })).status,
  200,
);
assertEquals(
  (await (await call(
    `/push/status?endpoint=${encodeURIComponent(legacyEndpoint)}`,
    master,
  )).json())
    .registered,
  false,
  "legacy root subscription was not retired during migration",
);

const pushStarted = performance.now();
assertEquals((await call("/push/test", master, {})).status, 200);
assert(
  performance.now() - pushStarted < 1_500,
  "stalled push held the event endpoint too long",
);
assertEquals(healthyPushes, 1, "healthy push recipient was delayed or skipped");
const wsUrl = base.replace(/^http/, "ws") +
  `/api/term?session=${encodeURIComponent(session)}&token=${lost.token}`;

function openedSocket(token = lost.token): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      base.replace(/^http/, "ws") +
        `/api/term?session=${encodeURIComponent(session)}&token=${token}`,
    );
    const timer = setTimeout(
      () => reject(new Error("terminal did not open")),
      5000,
    );
    ws.onopen = () => {
      clearTimeout(timer);
      resolve(ws);
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error("terminal socket error"));
    };
  });
}

const oversized = await openedSocket(kept.token);
const oversizedClosed = new Promise<CloseEvent>((resolve) =>
  oversized.onclose = resolve
);
oversized.send("x".repeat(256 * 1024 + 1));
assertEquals((await oversizedClosed).code, 1009);
const keptSocket = await openedSocket(kept.token);

// Two active clients exercise the registry as well as self-revocation.
const sockets = await Promise.all([openedSocket(), openedSocket()]);
const closed = sockets.map((ws) =>
  new Promise<CloseEvent>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("revoked socket remained open")),
      5000,
    );
    ws.onclose = (event) => {
      clearTimeout(timer);
      resolve(event);
    };
  })
);
const revoked = await call("/devices/revoke", lost.token, { id: lost.id });
assertEquals(revoked.status, 200);
assertEquals((await revoked.json()).self, true);
for (const event of await Promise.all(closed)) assertEquals(event.code, 4003);
assertEquals(keptSocket.readyState, WebSocket.OPEN);
keptSocket.send(JSON.stringify({ t: "r", c: 81, r: 25 }));

assertEquals((await call("/sessions", lost.token)).status, 401);
assertEquals((await call("/sessions", kept.token)).status, 200);
assertEquals(
  (await (await call(
    `/push/status?endpoint=${encodeURIComponent(lostEndpoint)}`,
    master,
  )).json()).registered,
  false,
  "revoked device subscription remained registered",
);
assertEquals(
  (await (await call(
    `/push/status?endpoint=${encodeURIComponent(keptEndpoint)}`,
    master,
  )).json()).registered,
  true,
  "another device subscription was removed",
);
const sessions = await (await call("/sessions", master)).json();
assert(
  sessions.some((item: { session: string }) => item.session === session),
  "tmux session died",
);

// A connection begun after revocation must never reach OPEN.
await new Promise<void>((resolve, reject) => {
  const ws = new WebSocket(wsUrl);
  const timer = setTimeout(
    () => reject(new Error("post-revoke connection did not settle")),
    5000,
  );
  ws.onopen = () => reject(new Error("revoked token reconnected"));
  ws.onerror = () => {
    clearTimeout(timer);
    resolve();
  };
  ws.onclose = () => {
    clearTimeout(timer);
    resolve();
  };
});

// A registration authenticated just before a concurrent revoke must either
// finish before the revoke or be refused; it may never survive afterward.
const racing = await enroll("revocation-racing");
const raceEndpoint = `http://127.0.0.1:${pushServer.addr.port}/racing`;
const raceBody = {
  endpoint: raceEndpoint,
  keys: { p256dh: b64url(fakePublic), auth: b64url(authSecret) },
  machine: base,
};
await Promise.all([
  ...Array.from(
    { length: 12 },
    () => call("/push/subscribe", racing.token, raceBody),
  ),
  call("/devices/revoke", racing.token, { id: racing.id }),
]);
assertEquals(
  (await (await call(
    `/push/status?endpoint=${encodeURIComponent(raceEndpoint)}`,
    master,
  )).json())
    .registered,
  false,
  "a concurrent subscription save resurrected revoked notification access",
);

// Registration itself races revocation here. Any socket that wins the first
// authentication check must still be found and closed by revocation; one that
// reaches the security gate afterward must never become live.
const wsRacing = await enroll("websocket-racing");
const wsAttempts = Array.from(
  { length: 12 },
  () => openedSocket(wsRacing.token),
);
const wsRaceRevoke = call("/devices/revoke", wsRacing.token, {
  id: wsRacing.id,
});
const [wsRaceResult, wsAttemptResults] = await Promise.all([
  wsRaceRevoke,
  Promise.allSettled(wsAttempts),
]);
assertEquals(wsRaceResult.status, 200);
await new Promise((resolve) => setTimeout(resolve, 100));
for (const result of wsAttemptResults) {
  if (result.status === "fulfilled") {
    assert(
      result.value.readyState !== WebSocket.OPEN,
      "a WebSocket registration racing revocation remained open",
    );
  }
}

// A slow push provider must not hold the identity lock. Once its request is in
// flight, revocation should abort it and complete well inside the provider's
// own two-second response delay.
const pushRacing = await enroll("push-racing");
const cancelEndpoint = `http://127.0.0.1:${pushServer.addr.port}/cancel`;
assertEquals(
  (await call("/push/subscribe", pushRacing.token, {
    endpoint: cancelEndpoint,
    keys: { p256dh: b64url(fakePublic), auth: b64url(authSecret) },
    machine: base,
  })).status,
  200,
);
const delivery = call("/push/test", pushRacing.token, {});
await Promise.race([
  cancelPushSeen,
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error("cancelable push did not start")), 5_000)
  ),
]);
const revokeStarted = performance.now();
assertEquals(
  (await call("/devices/revoke", pushRacing.token, { id: pushRacing.id }))
    .status,
  200,
);
assert(
  performance.now() - revokeStarted < 1_000,
  "an in-flight push provider delayed credential revocation",
);
await delivery;
assertEquals(
  (await (await call(
    `/push/status?endpoint=${encodeURIComponent(cancelEndpoint)}`,
    master,
  )).json()).registered,
  false,
  "revocation left an in-flight recipient registered",
);

// Capacity is reserved before a tmux client is spawned. Four connections for
// one device work; the fifth handshake is rejected.
const capped = await enroll("connection-cap");
const cappedSockets = await Promise.all(
  Array.from({ length: 4 }, () => openedSocket(capped.token)),
);
await new Promise<void>((resolve, reject) => {
  const ws = new WebSocket(
    base.replace(/^http/, "ws") +
      `/api/term?session=${encodeURIComponent(session)}&token=${capped.token}`,
  );
  const timer = setTimeout(
    () => reject(new Error("fifth connection did not settle")),
    5000,
  );
  ws.onopen = () =>
    reject(new Error("fifth connection bypassed the per-device cap"));
  ws.onerror = () => {
    clearTimeout(timer);
    resolve();
  };
  ws.onclose = () => {
    clearTimeout(timer);
    resolve();
  };
});
for (const ws of cappedSockets) ws.close();
keptSocket.close();

if (evidence) {
  await Deno.writeTextFile(
    evidence,
    JSON.stringify({ lostEndpoint, keptEndpoint }),
  );
}

console.log(
  "revocation closes active sockets, rejects reconnect, preserves peer and tmux",
);
pushAbort.abort();
