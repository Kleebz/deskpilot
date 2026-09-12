// Disposable API and terminal fixtures. No calls reach tmux or the real service.
export async function fixture() {
  const state = {
    delay: 0,
    auth: false,
    empty: false,
    enrollDelay: 0,
    createDelay: 0,
    calls: [] as string[],
    created: [] as any[],
    sockets: [] as string[],
    remoteBlocked: true,
  };
  const servers = [8892, 8893, 8894].map((port, i) =>
    Deno.serve({ hostname: "127.0.0.1", port, onListen() {} }, async (req) => {
      const u = new URL(req.url);
      const headers = {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "authorization, content-type",
        "access-control-allow-methods": "GET, POST, OPTIONS",
      };
      const json = (body: unknown, status = 200) =>
        Response.json(body, { status, headers });
      if (req.method === "OPTIONS") return new Response(null, { headers });
      if (u.pathname === "/api/term") {
        state.sockets.push(`${port}:${u.searchParams.get("session")}`);
        const { socket, response } = Deno.upgradeWebSocket(req);
        socket.onopen = () =>
          socket.send(
            JSON.stringify({
              t: "hist",
              d: `Fixture terminal: ${
                u.searchParams.get("session")
              }\r\n$ ready\r\n`,
            }),
          );
        return response;
      }
      if (u.pathname.startsWith("/api/")) {
        state.calls.push(`${port}:${req.method}:${u.pathname}`);
        if (u.pathname === "/api/devices/enroll") {
          const body = await req.json();
          if (state.enrollDelay) {
            await new Promise((r) => setTimeout(r, state.enrollDelay));
          }
          return body.code === "34679CDF"
            ? json({ token: "device-token" })
            : json({ error: "Invalid pairing code" }, 400);
        }
        if (i === 0 && state.auth) return json({ error: "unauthorized" }, 401);
        if (u.pathname === "/api/capabilities") {
          return json({
            // Deliberately identical: the browser test proves local labels do
            // not get erased when both machines report the same hostname.
            name: "Omarchy",
            windows: i === 0,
            screenshot: i === 0,
            terminal: true,
            version: "fixture",
            unlock: false,
          });
        }
        if (u.pathname === "/api/sessions" && req.method === "POST") {
          const b = await req.json();
          if (state.createDelay) {
            await new Promise((r) => setTimeout(r, state.createDelay));
          }
          const result = {
            session: b.name,
            workspace: b.workspace ?? null,
            command: b.command,
          };
          state.created.push(result);
          return json(result);
        }
        if (u.pathname === "/api/sessions") {
          const delay = state.delay;
          if (i === 0 && delay) await new Promise((r) => setTimeout(r, delay));
          if (state.empty) return json([]);
          return json(
            i
              ? [
                {
                  session: "headless-job",
                  workspace: null,
                  command: "bash",
                  ...(state.remoteBlocked
                    ? {
                      state: "blocked",
                      tool: "Write",
                      detail: "Review generated file",
                    }
                    : {}),
                },
                ...state.created,
              ]
              : [
                {
                  session: "detached",
                  workspace: null,
                  state: "blocked",
                  tool: "Bash",
                  detail: "Approve command?",
                  command: "claude",
                },
                { session: "same-screen-a", workspace: 2, command: "bash" },
                { session: "same-screen-b", workspace: 2, command: "bash" },
                ...Array.from(
                  { length: 24 },
                  (_, n) => ({
                    session: `project-${n}`,
                    workspace: n % 10 + 1,
                    command: "bash",
                    path: "/home/test/long-project-name",
                    ...(n === 0 ? { state: "done" } : {}),
                  }),
                ),
                ...state.created,
              ],
          );
        }
        if (u.pathname === "/api/dirs") {
          return json(["/home/test", "/home/test/project"]);
        }
        if (u.pathname === "/api/devices") {
          return json({
            devices: [{
              id: "phone",
              name: "Test phone",
              current: true,
              lastSeen: Date.now(),
            }],
            legacy: i === 2,
          });
        }
        if (u.pathname === "/api/desk/locked") return json({ locked: false });
        if (u.pathname === "/api/desk/state") {
          return json(
            i ? [] : [{
              address: "0x1",
              workspace: 2,
              class: "foot",
              title: "Fixture window",
              fullscreen: 0,
              floating: false,
            }],
          );
        }
        if (u.pathname === "/api/usage") return json([]);
        return json({ ok: true });
      }
      const path = u.pathname === "/" ? "index.html" : u.pathname.slice(1);
      if (path.includes("..")) return new Response("", { status: 400 });
      try {
        const bytes = await Deno.readFile(
          new URL(`../web/dist/${path}`, import.meta.url),
        );
        const type = path.endsWith(".js")
          ? "text/javascript"
          : path.endsWith(".css")
          ? "text/css"
          : path.endsWith(".html")
          ? "text/html"
          : "application/octet-stream";
        return new Response(bytes, { headers: { "content-type": type } });
      } catch {
        return new Response("", { status: 404 });
      }
    })
  );
  return { state, close: () => Promise.all(servers.map((s) => s.shutdown())) };
}
if (import.meta.main) {
  await fixture();
  console.log("Mobile fixtures on ports 8892–8894");
}
