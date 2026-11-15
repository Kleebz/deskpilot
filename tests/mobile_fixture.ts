import {validateOrganization, OrganizationError} from '../server/organization.ts';
// Disposable API and terminal fixtures. No calls reach tmux or the real service.
export async function fixture(options: {ports?:number[]} = {}) {
  const state = {
    uiDirectory: Deno.env.get('DESKPILOT_TEST_WEB_DIST') || new URL('../web/dist/',import.meta.url).pathname,
    organizations:{} as Record<string,any>,
    terminalIds:{} as Record<string,{terminalId:string;generation:string}>,
    organizationDelay:0,
    organizationFailure:false,
    delay: 0,
    auth: false,
    empty: false,
    repair: false,
    enrollDelay: 0,
    createDelay: 0,
    calls: [] as string[],
    requests: [] as { port: number; path: string; body: any }[],
    created: [] as any[],
    sockets: [] as string[],
    terminalScreens: {} as Record<string,string>,
    terminalInputs: [] as {session:string;port:number;data:string}[],
    terminalInput: null as null | ((session:string,data:string,socket:WebSocket)=>void),
    remoteBlocked: true,
    sessionOverrides: {} as Record<string, Record<string, unknown>>,
    sendDelay: 0,
    sendFailure: false,
    conversationsOnly: false,
    connectDelay: 0,
    connectFailure: false,
    conversations: [] as any[],
    herdrTerminals: [] as any[],
    herdrWritable: true,
    herdrRevision: 1,
    herdrActionFailure: false,
    windows: [{
      address: "0x1",
      workspace: 2,
      class: "foot",
      title: "Fixture window",
      fullscreen: 0,
      floating: false,
    }] as any[],
    previewDelay: 0,
    previews: [{
      id: "preview-1",
      task: "Website",
      caption: "Login page layout",
      created: 1793000000000,
      width: 192,
      height: 192,
      bytes: 100,
      mime: "image/png",
    }, {
      id: "preview-2",
      task: "CAD fixture",
      caption: "Mount render",
      created: 1792999900000,
      width: 192,
      height: 192,
      bytes: 100,
      mime: "image/png",
    }],
  };
  const servers = (options.ports || [8892, 8893, 8894]).map((port, i) =>
    Deno.serve({ hostname: "127.0.0.1", port, onListen() {} }, async (req) => {
      const u = new URL(req.url);
      const headers = {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "authorization, content-type",
        "access-control-allow-methods": "GET, POST, OPTIONS",
      };
      const json = (body: any, status = 200) => {
        if(u.pathname==='/api/sessions'&&Array.isArray(body))body=body.map(s=>{
          const key=`${port}:${s.session}`;
          state.terminalIds[key]??={terminalId:'$'+Object.keys(state.terminalIds).filter(k=>k.startsWith(port+':')).length,generation:`fixture:${port}:1`};
          return {...state.terminalIds[key],...s};
        });
        return Response.json(body, { status, headers });
      };
      if (req.method === "OPTIONS") return new Response(null, { headers });
      if (u.pathname === "/api/term") {
        state.sockets.push(`${port}:${u.searchParams.get("session")}`);
        const { socket, response } = Deno.upgradeWebSocket(req);
        socket.onopen = () =>
          socket.send(
            JSON.stringify({
              t: "hist",
              d: state.terminalScreens[u.searchParams.get("session") || ''] ?? `Fixture terminal: ${
                u.searchParams.get("session")
              }\r\n$ ready\r\n`,
            }),
          );
        socket.onmessage = e => {
          const message=JSON.parse(String(e.data));
          if(message.t!=='i')return;
          const session=u.searchParams.get('session')||'';
          state.terminalInputs.push({session,port,data:message.d});
          state.terminalInput?.(session,message.d,socket);
        };
        return response;
      }
      if (u.pathname.startsWith("/api/")) {
        state.calls.push(`${port}:${req.method}:${u.pathname}`);
        if (
          req.method === "POST" &&
          ["/api/send", "/api/paste"].includes(u.pathname)
        ) {
          const body = await req.json();
          state.requests.push({ port, path: u.pathname, body });
          const fail = state.sendFailure;
          if (state.sendDelay) {
            await new Promise((r) => setTimeout(r, state.sendDelay));
          }
          if (fail) return json({ error: "Fixture send failed" }, 503);
          return json({ ok: true });
        }
        if (u.pathname === "/api/devices/enroll") {
          const body = await req.json();
          if (state.enrollDelay) {
            await new Promise((r) => setTimeout(r, state.enrollDelay));
          }
          return body.code === "34679CDF"
            ? json({ token: "device-token", id: "phone", name: "Test phone" })
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
            previews: true,
            organization:true,
            version: "fixture",
            unlock: false,
          });
        }
        if(u.pathname==='/api/organization'){
          state.organizations[port]??={version:1,revision:0,spaces:[],assignments:[]};
          if(req.method==='POST'){
            const value=await req.json();if(state.organizationDelay)await new Promise(r=>setTimeout(r,state.organizationDelay));
            if(state.organizationFailure)return json({error:'Organization unavailable'},503);
            try{const doc=validateOrganization(value);if(doc.revision!==state.organizations[port].revision)return json({error:'Organization changed. Refresh before saving again'},409);doc.revision++;state.organizations[port]=doc;}
            catch(e){return json({error:e instanceof Error?e.message:String(e)},e instanceof OrganizationError?e.status:400);}
          }
          return json(state.organizations[port]);
        }
        if (u.pathname === "/api/previews") {
          return json(i ? [] : state.previews);
        }
        if (u.pathname === "/api/conversations") {
          return json({ available: !i, items: i ? [] : state.conversations });
        }
        if (u.pathname === "/api/herdr") {
          return json({ available: !i, items: i ? [] : state.herdrTerminals });
        }
        if (u.pathname === "/api/herdr/management") {
          const spaces: any[] = [];
          for (const terminal of i ? [] : state.herdrTerminals) {
            if (!terminal.space || !terminal.tab) continue;
            let space = spaces.find((s) => s.id === terminal.space.id);
            if (!space) {
              space = {
                ...terminal.space,
                tabs: [],
                revision: `space-${state.herdrRevision}`,
              };
              spaces.push(space);
            }
            let tab = space.tabs.find((t: any) => t.id === terminal.tab.id);
            if (!tab) {
              tab = {
                ...terminal.tab,
                pane: "fixture-pane",
                panes: 0,
                terminals: [],
                revision: `tab-${state.herdrRevision}`,
              };
              space.tabs.push(tab);
            }
            tab.terminals.push(terminal.id);
            tab.panes++;
          }
          return json({
            available: !i && !!spaces.length,
            writable: !i && state.herdrWritable,
            reason: state.herdrWritable
              ? ""
              : "Open Herdr to manage its spaces. Running terminals remain accessible.",
            core: "0123456789abcdef0123456789abcdef",
            spaces,
            activeSpace: spaces[0]?.id ?? "",
            activeTab: spaces[0]?.tabs[0]?.id ?? "",
            moveAcrossSpaces: false,
          });
        }
        if (u.pathname === "/api/herdr/action") {
          const body = await req.json();
          state.requests.push({ port, path: u.pathname, body });
          if (state.herdrActionFailure) {
            return json({
              error:
                "The work in this target changed. Review its terminals again before closing.",
            }, 409);
          }
          if (!state.herdrWritable) {
            return json({ error: "Open Herdr to manage its spaces." }, 409);
          }
          if (body.action === "space.rename") {
            state.herdrTerminals = state.herdrTerminals.map((t) =>
              t.space?.id === body.spaceId
                ? { ...t, space: { ...t.space, title: body.name } }
                : t
            );
          }
          if (body.action === "tab.rename") {
            state.herdrTerminals = state.herdrTerminals.map((t) =>
              t.space?.id === body.spaceId && t.tab?.id === body.tabId
                ? { ...t, tab: { ...t.tab, title: body.name } }
                : t
            );
          }
          if (body.action === "space.close") {
            state.herdrTerminals = state.herdrTerminals.filter((t) =>
              t.space?.id !== body.spaceId
            );
          }
          if (body.action === "tab.close") {
            state.herdrTerminals = state.herdrTerminals.filter((t) =>
              !(t.space?.id === body.spaceId && t.tab?.id === body.tabId)
            );
          }
          if (body.action === "terminal.stop") {
            state.herdrTerminals = state.herdrTerminals.filter((t) =>
              t.id !== body.terminalId
            );
          }
          state.herdrRevision++;
          return json({ ok: true });
        }
        if (u.pathname === "/api/herdr/connect") {
          const body = await req.json();
          state.requests.push({ port, path: u.pathname, body });
          if (state.connectDelay) {
            await new Promise((r) => setTimeout(r, state.connectDelay));
          }
          if (state.connectFailure) {
            return json({ error: "Herdr desktop session is unchanged" }, 503);
          }
          const terminal = state.herdrTerminals.find((c) => c.id === body.id);
          if (!terminal) {
            return json({ error: "Herdr terminal no longer running" }, 409);
          }
          terminal.session ??= `herdr-mobile-${terminal.address}`;
          if (!state.created.some((s) => s.session === terminal.session)) {
            state.created.push({
              session: terminal.session,
              command: "herdr-core",
              path: terminal.path,
              herdrId: terminal.id,
            });
          }
          return json({ ok: true, session: terminal.session });
        }
        if (u.pathname === "/api/conversations/connect") {
          const body = await req.json();
          state.requests.push({ port, path: u.pathname, body });
          if (state.connectDelay) {
            await new Promise((r) => setTimeout(r, state.connectDelay));
          }
          if (state.connectFailure) {
            return json({ error: "Desktop conversation is unchanged" }, 503);
          }
          const chat = state.conversations.find((c) => c.id === body.id);
          if (!chat) {
            return json({ error: "Conversation no longer running" }, 409);
          }
          chat.session ??= `mobile-${body.id.slice(-8)}`;
          if (!state.created.some((s) => s.session === chat.session)) {
            state.created.push({
              session: chat.session,
              command: "codex",
              path: chat.path,
              codexThreadId: chat.id,
              conversationTitle: chat.title,
            });
          }
          return json({ ok: true, session: chat.session });
        }
        if (u.pathname === "/api/previews/remove") {
          const body = await req.json();
          state.previews = state.previews.filter((p) => p.id !== body.id);
          return json({ ok: true });
        }
        if (u.pathname.startsWith("/api/previews/")) {
          const delay = state.previewDelay;
          if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
          return new Response(
            await Deno.readFile(
              new URL("../web/public/icon-192.png", import.meta.url),
            ),
            { headers: { ...headers, "content-type": "image/png" } },
          );
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
          if (state.conversationsOnly) return json(i ? [] : state.created);
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
              ].map((s) => ({ ...s, ...state.sessionOverrides[s.session] })),
          );
        }
        if (u.pathname === "/api/unmanaged") {
          if (state.empty) return json([]);
          return json(
            i ? [] : [{
              id: "unmanaged-4242",
              pid: 4242,
              path: "/home/test/orphan-project",
              agent: "claude-code",
              state: "blocked",
              tool: "Write",
              detail: "Review generated file",
              workspace: 2,
              address: "0x1",
              managed: false,
            }],
          );
        }
        if (u.pathname === "/api/dirs") {
          return json(["/home/test", "/home/test/project"]);
        }
        if (u.pathname === "/api/devices") {
          if (i === 2 && state.repair) return json({ error: "unauthorized" }, 401);
          return json({
            devices: [{
              id: "phone",
              name: "Test phone",
              current: true,
              lastSeen: Date.now(),
            }],
          });
        }
        if (u.pathname === "/api/desk/locked") return json({ locked: false });
        if (u.pathname === "/api/desk/shot") {
          return new Response(
            await Deno.readFile(
              new URL("../web/public/icon-192.png", import.meta.url),
            ),
            { headers: { ...headers, "content-type": "image/png" } },
          );
        }
        if (u.pathname === "/api/desk/state") {
          return json(i ? [] : state.windows);
        }
        if (u.pathname === "/api/usage") return json([]);
        return json({ ok: true });
      }
      if (u.pathname === "/__preview_harness") {
        return new Response(
          '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#0a0a0f"></body></html>',
          { headers: { "content-type": "text/html" } },
        );
      }
      const path = u.pathname === "/" ? "index.html" : u.pathname.slice(1);
      if (path.includes("..")) return new Response("", { status: 400 });
      try {
        const bytes = await Deno.readFile(
          state.uiDirectory+"/"+path,
        );
        const type = path.endsWith(".js")
          ? "text/javascript"
          : path.endsWith(".css")
          ? "text/css"
          : path.endsWith(".json") ? "application/json" : path.endsWith(".html")
          ? "text/html"
          : "application/octet-stream";
        return new Response(bytes, { headers: { "content-type": type,"cache-control":"no-store" } });
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
