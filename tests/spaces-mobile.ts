// The real mobile app, served by disposable API/WebSocket fixtures. No live services.
import { connect } from "./browser.ts";
import { fixture } from "./mobile_fixture.ts";
const fx = await fixture();
const space = {
  id: "product",
  title: "Product",
  path: "/home/test/project",
  order: 0,
};
const tab = { id: "mobile", title: "Mobile", order: 0 };
fx.state.herdrTerminals = [0, 1, 2].map((n) => ({
  id: `core/t${n}/1793397428670`,
  address: `t${n}`,
  title: n === 2 ? "Other tab" : "Native pane " + n,
  path: "/home/test/project",
  state: n === 0 ? "blocked" : "idle",
  agent: "shell",
  session: null,
  space,
  tab: n === 2 ? { id: "other", title: "Other", order: 1 } : tab,
  paneOrder: n,
}));
fx.state.conversations = [{
  id: "e263226a-1111-4111-8111-111111111111",
  title: "Reconnect race with a very long conversation title",
  path: "/home/test/project",
  state: "ready",
  session: null,
}];
// Ordinary output has local scrollback; full-screen adapters own their history.
fx.state.terminalScreens.detached = Array.from(
  { length: 140 },
  (_, n) => `HISTORY_LINE_${String(n).padStart(3, "0")}`,
).join("\r\n") + "\r\n$ ready";
fx.state.terminalScreens["herdr-mobile-t0"] =
  "\x1b[?1049h\x1b[?1003h\x1b[?1006h\x1b[HAPP_HISTORY_OFFSET:0";
fx.state.terminalScreens["herdr-mobile-t1"] =
  "\x1b[?1049h\x1b[HAPP_HISTORY_OFFSET:0";
const offsets: Record<string, number> = {};
fx.state.terminalInput = (session, data, socket) => {
  const up = /^\x1b\[<64;\d+;\d+M$/.test(data) || data === "\x1b[5~";
  const down = /^\x1b\[<65;\d+;\d+M$/.test(data) || data === "\x1b[6~";
  if (!up && !down) return;
  offsets[session] = Math.max(0, (offsets[session] || 0) + (up ? 1 : -1));
  socket.send(
    JSON.stringify({
      t: "o",
      d: "\x1b[H\x1b[2KAPP_HISTORY_OFFSET:" + offsets[session],
    }),
  );
};
const profile = await Deno.makeTempDir({ prefix: "dp-spaces-live-" });
const chrome = new Deno.Command("chromium", {
  args: [
    "--headless=new",
    "--disable-background-networking",
    "--no-first-run",
    "--remote-debugging-port=9348",
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  stdout: "null",
  stderr: "null",
}).spawn();
const pause = (ms = 80) => new Promise((r) => setTimeout(r, ms));
let cdp;
let count = 0;
const layouts: any[] = [];
try {
  let endpoint;
  for (let i = 0; i < 70; i++) {
    try {
      endpoint =
        (await (await fetch("http://127.0.0.1:9348/json/version")).json())
          .webSocketDebuggerUrl;
      break;
    } catch {
      await pause();
    }
  }
  if (!endpoint) throw Error("Chromium did not start");
  cdp = await connect(endpoint);
  const { targetId } = await cdp.send("Target.createTarget", {
    url: "about:blank",
  });
  const { sessionId } = await cdp.send("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  const send = (m: string, p = {}) => cdp!.send(m, p, sessionId);
  const run = async (expression: string) => {
    const r = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
    return r.result?.value;
  };
  const ui = (source: string) =>
    run(
      `document.querySelector('iframe').contentWindow.eval(${
        JSON.stringify(source)
      })`,
    );
  const until = async (e: string) => {
    for (let n = 0; n < 120; n++) {
      try {
        if (await ui(e)) return;
      } catch {}
      await pause();
    }
    throw Error(
      "Timed out: " + e + "\n" + await ui("document.body.innerText") +
        " ERRORS " + await ui("JSON.stringify(window.__errors)"),
    );
  };
  const check = async (e: string, label: string) => {
    if (!await ui(e)) {
      throw Error(label + "\n" + await ui("document.body.innerText"));
    }
    console.log("✓ " + label);
    count++;
  };
  const click = async (label: string) => {
    const ok = await ui(
      `(()=>{const scope=[...document.querySelectorAll('dialog[open]')].at(-1)||document;const e=[...scope.querySelectorAll('button')].find(e=>e.getAttribute('aria-label')===${
        JSON.stringify(label)
      }||e.textContent.trim()===${
        JSON.stringify(label)
      });if(!e||e.disabled)return false;e.click();return true;})()`,
    );
    if (!ok) {
      throw Error(
        "Missing button: " + label + "\n" + await ui("document.body.innerText"),
      );
    }
    await pause();
  };
  const input = async (selector: string, value: string) => {
    await ui(
      `{const e=document.querySelector(${JSON.stringify(selector)});e.value=${
        JSON.stringify(value)
      };e.dispatchEvent(new Event('input',{bubbles:true}));}`,
    );
    await pause();
  };
  const choose = async (port: number) => {
    await ui(
      `{const e=document.querySelector('select[aria-label="Machine"]');e.value='http://127.0.0.1:${port}';e.dispatchEvent(new Event('change',{bubbles:true}));}`,
    );
    await pause();
  };
  const size = async (w: number, h: number) => {
    await run(
      `{const f=document.querySelector('iframe');f.style.width='${w}px';f.style.height='${h}px';}`,
    );
    await pause();
  };
  const measure = async (label: string) => {
    if (await ui(`!!document.querySelector('.composing')`)) {
      await until(
        `!!document.querySelector('.xterm-screen')&&!document.querySelector('.wrap .state')`,
      );
    }
    const m = await ui(
      `(()=>{const targets=[...document.querySelectorAll('button,input,select,textarea')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.height&&!e.classList.contains('xterm-helper-textarea')&&!e.closest('[aria-hidden="true"],[inert]')&&(!document.querySelector('dialog[open]')||!!e.closest('dialog[open]'));});return {width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,short:targets.filter(e=>e.getBoundingClientRect().height<43.9).map(e=>({text:e.textContent,height:e.getBoundingClientRect().height})),escaped:targets.filter(e=>{const r=e.getBoundingClientRect();return !e.closest('.task-tabs,.pane-tabs')&&(r.left<-.5||r.right>innerWidth+.5)}).map(e=>e.textContent),grid:document.querySelector('.xterm-screen')?.getBoundingClientRect().height,composer:document.querySelector('.composer input')?.getBoundingClientRect().width}})()`,
    );
    layouts.push({ label, ...m });
    if (m.overflow || m.short.length || m.escaped.length) {
      throw Error(label + " " + JSON.stringify(m));
    }
    if (m.width === 390 && m.height === 430 && m.grid && m.grid < 258) {
      throw Error("Terminal grid below 60% " + JSON.stringify(m));
    }
  };
  const swipe = async () => {
    await until(
      `!!document.querySelector('.xterm-screen')&&!document.querySelector('.wrap .state')`,
    );
    const r = await ui(
      `(()=>{const r=document.querySelector('.xterm-screen').getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};})()`,
    );
    await send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: r.x + r.w * .8, y: r.y + r.h * .5 }],
    });
    for (const f of [.6, .4, .2]) {
      await send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: r.x + r.w * f, y: r.y + r.h * .5 }],
      });
      await pause(20);
    }
    await send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await pause();
  };
  const dragHistory = async (direction = 1) => {
    await until(
      `!!document.querySelector('.xterm-screen')&&!document.querySelector('.wrap .state')`,
    );
    const r = await ui(
      `(()=>{const r=document.querySelector('.xterm-screen').getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})()`,
    );
    const points =
      (direction > 0 ? [.2, .35, .5, .65, .8] : [.8, .65, .5, .35, .2]).map(
        (f) => ({ x: r.x + r.w * .5, y: r.y + r.h * f }),
      );
    await send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [points[0]],
    });
    for (const point of points.slice(1)) {
      await send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [point],
      });
      await pause(35);
    }
    await send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await pause(150);
  };
  const reload = async () => {
    const origin = await ui("performance.timeOrigin");
    await ui("location.reload()");
    await until(
      `performance.timeOrigin!==${origin}&&!!document.querySelector('.app-shell')`,
    );
  };
  const shot = async (name: string, w = 390, h = 844) => {
    await ui(
      "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))",
    );
    const r = await send("Page.captureScreenshot", {
      format: "png",
      clip: { x: 0, y: 0, width: w, height: h, scale: 1 },
    });
    await Deno.writeFile(
      `/tmp/deskpilot-spaces-live/${name}.png`,
      Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0)),
    );
  };
  await Deno.mkdir("/tmp/deskpilot-spaces-live", { recursive: true });
  await send("Page.enable");
  await send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 1,
  });
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source:
      `if(location.origin==='http://127.0.0.1:8892'&&!localStorage.getItem('dp_hosts')){localStorage.setItem('dp_hosts',JSON.stringify([{origin:location.origin,token:'fixture',name:'Desktop',alias:'Desktop'},{origin:'http://127.0.0.1:8893',token:'fixture',name:'Headless',alias:'Headless'},{origin:'http://127.0.0.1:8895',token:'fixture',name:'Offline'}]));localStorage.setItem('dp_host',location.origin)}window.__errors=[];window.addEventListener('error',e=>__errors.push(e.message));window.addEventListener('unhandledrejection',e=>__errors.push(String(e.reason)));`,
  });
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1600,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Page.navigate", { url: "http://127.0.0.1:8892/" });
  await pause(250);
  await run(
    `document.body.innerHTML='<iframe src="/" style="display:block;border:0;width:390px;height:844px"></iframe>';document.body.style.margin='0'`,
  );
  await until(
    `!!document.querySelector('.work-navigation') && document.querySelectorAll('[data-space]').length>=2`,
  );
  await check(
    `!document.querySelector('nav[aria-label="Views"],.task-tabs,.pane-tabs')&&!!document.querySelector('.work-navigation [aria-label="Needs attention"]')`,
    "one hierarchy with attention as a filter and no duplicate navigation",
  );
  for (const w of [320, 360, 390, 430]) {
    await size(w, 844);
    await measure("Spaces " + w);
  }
  await size(390, 844);
  await shot("spaces");
  await check(
    `document.querySelector('[aria-label="Toggle Available conversations"]')?.getAttribute('aria-expanded')==='false' && !document.querySelector('[data-space^="unassigned:"]').textContent.includes('Reconnect race')`,
    "unorganized conversations start collapsed outside ordinary terminals",
  );
  await click("Toggle Available conversations");
  for (const w of [320, 360, 390, 430]) {
    await size(w, 844);
    await measure("Available conversations " + w);
  }
  await size(390, 844);
  await ui(
    `document.querySelector('[data-space^="available:"]').scrollIntoView({block:"start"})`,
  );
  await shot("available");
  await click(
    "Hide conversation: Reconnect race with a very long conversation title",
  );
  fx.state.organizations[8892].revision++;
  await click("Hide from Deskpilot");
  await until(`!!document.querySelector('dialog [role="alert"]')`);
  await measure("Hide review with conflict");
  await shot("hide-review");
  await check(
    `document.querySelector('dialog').textContent.includes('Refresh before saving')`,
    "a conflicting hide preserves its review and requires an explicit refresh",
  );
  await click("Refresh organization");
  await click("Hide from Deskpilot");
  await until(`!document.querySelector('dialog[open]')`);
  await check(
    JSON.stringify(
      fx.state.organizations[8892].hidden?.[0]?.id ===
          fx.state.conversations[0].id &&
        !fx.state.requests.some((r) =>
          r.path === "/api/conversations/connect" || r.path === "/api/kill"
        ),
    ),
    "hide saves the exact conversation without creating a mobile attachment",
  );
  await reload();
  await until(
    `!!document.querySelector('[aria-label="Show hidden conversations"]')`,
  );
  await input('[aria-label="Search spaces and work"]', "Reconnect race");
  await check(
    `document.querySelectorAll('.space-result').length===0`,
    "hidden conversation stays out of search after reload",
  );
  await ui(
    `document.querySelector('[aria-label="Show hidden conversations"]').click()`,
  );
  await until(`document.querySelectorAll('.space-result').length===1`);
  await click(
    "Restore conversation: Reconnect race with a very long conversation title",
  );
  await click("Restore conversation");
  await until(`!document.querySelector('dialog[open]')`);
  await check(
    JSON.stringify(!fx.state.organizations[8892].hidden?.length),
    "restoring makes the conversation discoverable without changing source work",
  );
  await input('[aria-label="Search spaces and work"]', "");

  await input('[aria-label="Search spaces and work"]', "project-17");
  await check(
    `document.querySelectorAll('.space-result').length===1`,
    "search finds work among more than twenty terminals",
  );
  await input('[aria-label="Search spaces and work"]', "");
  await ui(`document.getElementById('session-detached').click()`);
  await until(`!!document.querySelector('.xterm-screen')`);
  await input(".composer input", "ordinary exact draft");
  await until(
    `document.querySelector('.xterm-rows').textContent.includes('$ ready')`,
  );
  await ui(`window.__composer=document.querySelector('.composer input');window.__screen=document.querySelector('.xterm-screen')`);
  const originalSockets=fx.state.sockets.length;
  for(const w of [959,960,1024,1280,1440]){await size(w,844);await measure('Responsive terminal '+w);await check(`document.querySelector('.composer input')===window.__composer&&document.querySelector('.xterm-screen')===window.__screen&&${JSON.stringify(fx.state.sockets.length===originalSockets)}`, 'responsive '+w+' keeps the terminal connection and composer mounted');}
  await size(1280,844);await shot('desktop',1280,844);
  await size(390,844);await click('Open spaces');await size(960,844);
  await check(`!document.querySelector('dialog[open]')&&!!document.querySelector('.work-sidebar')&&document.querySelector('.composer input')===window.__composer`, 'opening the desktop sidebar dismisses the mobile drawer without replacing work');
  await size(390,844);await click('Computer');
  await check(`document.querySelector('.composer input')===window.__composer&&document.querySelector('.xterm-screen')===window.__screen&&${JSON.stringify(fx.state.sockets.length===originalSockets)}`, 'Computer is an overlay and preserves the active terminal connection');
  await click('Close Computer');
  await click('Computer');await click('Pair computer');await until(`!!document.querySelector('[aria-label="Computer address"]')||!!document.querySelector('.pairing')||document.body.textContent.includes('Pair computer')`);
  await click('Cancel');await until(`!!document.querySelector('dialog[aria-label="Computer"]')`);
  await check(`document.querySelector('.composer input').value==='ordinary exact draft'`, 'pairing from Computer cancels back to its overlay with the source draft intact');
  await click('Close Computer');
  await ui(`document.querySelector('.composer input').focus()`);
  await until(`!!document.querySelector('.xterm-screen')&&!document.querySelector('.wrap .state')&&document.querySelector('.xterm-rows').textContent.includes('$ ready')`);
  const firstVisible = await ui(
    `document.querySelector('.xterm-rows>div').textContent`,
  );
  await ui(`document.querySelector('.composer input').focus()`);
  await dragHistory();
  await check(
    `document.querySelector('.xterm-rows>div').textContent!==${
      JSON.stringify(firstVisible)
    } && document.activeElement===document.querySelector('.composer input') && document.querySelector('.composer input').value==='ordinary exact draft'`,
    "vertical touch scrolls ordinary history without losing composer focus or draft",
  );
  await check(
    JSON.stringify(fx.state.terminalInputs.length === 0),
    "ordinary scrollback sends no input to the source",
  );
  await dragHistory(-1);

  for (
    const [w, h] of [
      [320, 844],
      [360, 844],
      [390, 844],
      [430, 844],
      [932, 430],
      [320, 430],
      [390, 430],
    ]
  ) {
    await size(w, h);
    await measure("Real terminal " + w + "x" + h);
  }
  await shot("keyboard", 390, 430);
  await size(390, 844);
  await click("Open spaces");
  await click("New space");
  await input('[aria-label="Space name"]', "Deskpilot");
  await input('[aria-label="First tab name"]', "Mobile");
  await click("Create space");
  await until(`!document.querySelector('dialog[aria-label="New space"]')`);
  await click("Close panel");
  await click("Terminal actions");
  await click("Move to tab");
  const firstTask = fx.state.organizations[8892].spaces[0].tabs[0].id;
  await ui(
    `{const s=document.querySelector('[aria-label="Destination tab"]');s.value=${
      JSON.stringify(firstTask)
    };s.dispatchEvent(new Event('change',{bubbles:true}));}`,
  );
  await click("Move work");
  await until(`!document.querySelector('dialog[aria-label="Move to tab"]')`);
  await click("Close panel");
  await check(
    `document.querySelector('.session-title').textContent.includes('Deskpilot / Mobile') && document.querySelector('.composer input').value==='ordinary exact draft'`,
    "persisted assignment preserves the exact source draft",
  );
  await click("Input tools");
  await click("normal");
  await measure("Readable terminal font");
  await check(
    `document.querySelector('.xterm-screen').getBoundingClientRect().right<=document.querySelector('.host').getBoundingClientRect().right+1`,
    "readable text size refits the actual terminal grid",
  );
  await click("large");
  await click("copy");
  await until(
    `!!document.querySelector('dialog[aria-label="Copy terminal output"]')`,
  );
  await ui("history.back()");
  await until(
    `!document.querySelector('dialog[aria-label="Copy terminal output"]')`,
  );
  await check(
    `document.querySelector('.composer input').value==='ordinary exact draft'`,
    "Back dismisses selectable copy before leaving its terminal",
  );
  await click("Input tools");

  fx.state.sendDelay = 300;
  fx.state.sendFailure = true;
  await click("Send prompt");
  await input(".composer input", "newer unsent text");
  await pause(400);
  await check(
    `document.querySelector('.composer input').value.includes('ordinary exact draft') && document.querySelector('.composer input').value.includes('newer unsent text')`,
    "failed send restores the original draft without discarding newer typing",
  );
  fx.state.sendFailure = false;
  fx.state.sendDelay = 0;
  await input(".composer input", "ordinary exact draft");

  await click("Open spaces");
  await click("Manage space: Deskpilot");
  await click("Add tab");
  await input('[aria-label="Tab name"]', "Build");
  await click("Create tab");
  await until(`!!document.querySelector('dialog[aria-label="Build"]')`);
  await measure("Empty task");
  await click("Start terminal");
  await until(`!!document.querySelector('[aria-label="Command preset"]')`);
  await input("main form input", "created-in-task");
  await click("Create terminal");
  await until(
    `document.querySelector('.session-title')?.textContent.includes('created-in-task')`,
  );
  await check(
    `document.querySelector('.session-title').textContent.includes('Deskpilot / Build') && ${
      fx.state.created.filter((s) => s.session === "created-in-task").length ===
        1
    }`,
    "real session creation assigns its confirmed runtime identity to the chosen task once",
  );
  await until(`!!document.querySelector('.xterm-screen')&&!document.querySelector('.wrap .state')&&document.querySelector('.xterm-rows').textContent.includes('created-in-task')`);
  await input('.composer input','created tab draft');
  await ui(`window.__createdScreen=document.querySelector('.xterm-screen')`);
  await click('Open spaces');await click('Manage tab: Build');
  await input('[aria-label="Tab name"]','Build checks');await click('Save tab name');
  await click('Move tab earlier');
  await check(JSON.stringify(fx.state.organizations[8892].spaces[0].tabs[0].name==='Build checks'),'local tab rename and reorder save through the source computer');
  await click('Remove tab organization');await click('Close panel');
  await check(`document.querySelector('.session-title').textContent.includes('Unassigned')&&document.querySelector('.composer input').value==='created tab draft'&&document.querySelector('.xterm-screen')===window.__createdScreen`, 'removing a local tab preserves its running terminal, connection and draft');
  await click("Open spaces");
  await input('[aria-label="Search spaces and work"]', "detached");
  await ui(`document.querySelector('dialog .space-result').click()`);
  await until(`!document.querySelector('dialog')`);
  await check(
    `document.querySelector('.composer input').value==='ordinary exact draft'`,
    "task switching returns to the original draft",
  );
  await click("Input tools");
  await click("paste");
  await input(".paste textarea", "separate paste draft");
  await reload();
  await until(`!!document.querySelector('.composer input')`);
  await click("Input tools");
  await click("paste");
  await check(
    `document.querySelector('.paste textarea').value==='separate paste draft' && document.querySelector('.composer input').value==='ordinary exact draft'`,
    "relaunch restores stable source identity and both drafts",
  );
  await click("cancel");
  await click("Input tools");
  await click("Open spaces");
  await input('[aria-label="Search spaces and work"]', "Native pane 0");
  await ui(`document.querySelector('dialog .space-result').click()`);
  await until(
    `document.querySelector('.session-title')?.textContent.includes('Native pane 0')`,
  );
  await check(
    `document.querySelector('.session-title').textContent.includes('Product / Mobile') && !document.querySelector('.pane-tabs,.task-tabs')`,
    "native spaces, tabs and split scope use real discovery and attachment",
  );
  await input(".composer input", "native draft");
  await ui(`document.querySelector('.composer input').focus()`);
  await dragHistory();
  await until(
    `!document.querySelector('.xterm-rows').textContent.includes('APP_HISTORY_OFFSET:0')`,
  );
  await check(
    JSON.stringify(
      (offsets["herdr-mobile-t0"] || 0) > 0 &&
        fx.state.terminalInputs.filter((i) => i.session === "herdr-mobile-t0")
          .every((i) => /^\x1b\[<64;\d+;\d+M$/.test(i.data)),
    ),
    "Herdr-style full-screen history receives wheel-up reports from vertical touch",
  );
  await check(
    `document.activeElement===document.querySelector('.composer input') && document.querySelector('.composer input').value==='native draft' && document.querySelector('.session-title').textContent.includes('Native pane 0')`,
    "application scrolling preserves the composer and selected native pane",
  );
  const previousOffset = offsets["herdr-mobile-t0"];
  await dragHistory(-1);
  await check(
    JSON.stringify((offsets["herdr-mobile-t0"] || 0) < previousOffset),
    "reverse touch scroll returns toward the latest application output",
  );
  await shot("native-history");
  const beforeHorizontal = fx.state.terminalInputs.length;

  await ui(`document.querySelector('.composer input').focus()`);
  await swipe();
  await until(
    `document.querySelector('.session-title')?.textContent.includes('Native pane 1')`,
  );
  await check(
    `document.querySelector('.composer input').value==='' && document.activeElement===document.querySelector('.composer input')`,
    "native sibling has its own draft and touch switching retains composer focus",
  );

  await check(
    JSON.stringify(fx.state.terminalInputs.length === beforeHorizontal),
    "horizontal session swipes do not scroll or type into either source",
  );
  await dragHistory();
  await check(
    JSON.stringify(
      (offsets["herdr-mobile-t1"] || 0) > 0 &&
        fx.state.terminalInputs.filter((i) => i.session === "herdr-mobile-t1")
          .every((i) => i.data === "\x1b[5~"),
    ),
    "full-screen applications without mouse reporting receive PageUp instead of prompt-history arrows",
  );
  await click("Previous terminal");
  await until(
    `document.querySelector('.composer input')?.value==='native draft'`,
  );
  await click("Terminal actions");
  await click("Manage space");
  await click("Close space…");
  await measure("Native close review");
  fx.state.herdrActionFailure = true;
  await click("Stop & close");
  await until(`!!document.querySelector('dialog [role="alert"]')`);
  await check(
    `document.querySelector('dialog [role="alert"]').textContent.includes('changed') && ${
      fx.state.herdrTerminals.length === 3
    }`,
    "native management rejects a stale reviewed subtree while preserving running work",
  );
  fx.state.herdrActionFailure = false;
  await click("Close");
  await click("Close panel");

  await click("Open spaces");
  await input('[aria-label="Search spaces and work"]', "Reconnect race");
  await ui(`document.querySelector('dialog .space-result').click()`);
  await until(
    `document.querySelector('.session-title')?.textContent.includes('Reconnect race')`,
  );
  await input(".composer input", "conversation draft");
  await click("Open spaces");
  await click(
    "Hide conversation: Reconnect race with a very long conversation title",
  );
  await click("Hide from Deskpilot");
  await until(
    `!document.querySelector('dialog[aria-label="Hide conversation"]')`,
  );
  await click("Close panel");
  await check(
    `document.querySelector('.composer input').value==='conversation draft' && document.querySelector('.session-title').textContent.includes('Reconnect race')`,
    "hiding active work preserves its terminal and draft",
  );
  await click("Open spaces");
  await ui(
    `{const e=document.querySelector('[aria-label="Show hidden conversations"]');if(!e.checked)e.click();}`,
  );
  await click(
    "Restore conversation: Reconnect race with a very long conversation title",
  );
  await click("Restore conversation");
  await click("Close panel");

  await check(
    JSON.stringify(
      fx.state.requests.some((r) =>
        r.path === "/api/conversations/connect" &&
        r.body.id === fx.state.conversations[0].id
      ),
    ),
    "conversation attachment stays bound to its exact source",
  );
  await click("Open spaces");
  await input('[aria-label="Search spaces and work"]', "Native pane 0");
  fx.state.connectDelay = 500;
  await ui(`document.querySelector('dialog .space-result').click()`);
  await click("Close panel");
  await pause(650);
  await check(
    `document.querySelector('.composer input').value==='conversation draft'`,
    "canceling pending attachment ignores late navigation",
  );
  fx.state.connectDelay = 0;
  await click("Open spaces");
  await input('[aria-label="Search spaces and work"]','');
  await ui(`{const e=document.querySelector('[aria-label="Search scope"]');e.value='all';e.dispatchEvent(new Event('change',{bubbles:true}));}`);
  await click("Needs attention");
  await until(`document.querySelectorAll('dialog .space-result').length>=3`);
  await check(
    `document.querySelector('dialog [aria-label="Search scope"]').value==='all'`,
    "attention explicitly searches across computers",
  );
  await shot("attention");
  const studioRoute = await ui(
    `JSON.parse(localStorage.getItem('dp_resume_v1')).route`,
  );
  fx.state.auth = true;
  await ui(`document.querySelector('dialog .space-result').click()`);
  await pause(100);
  await check(
    `document.querySelector('.composer input').value==='conversation draft'`,
    "failed authentication preserves the current terminal and draft",
  );
  fx.state.auth = false;
  await click("Close panel");
  await click("Computer");
  await click("Settings");
  await until(`document.querySelector('h1')?.textContent==='Settings'`);
  await click("Computers & pairing");
  await click("Pair computer");
  await click("Cancel");
  await check(
    `document.querySelector('.machine-summary')&&document.activeElement.id==='settings-pair'`,
    "pairing cancellation restores its invoking subsection",
  );
  await click("Computer");
  await click("Previews");
  await until(`document.querySelector('h1')?.textContent==='Previews'`);
  await check(
    `document.body.textContent.includes('Website')`,
    "independent previews remain available",
  );
  await click("Computer");
  await click("Desktop");
  await until(`document.querySelector('h1')?.textContent==='Desktop'`);
  await measure("Desktop");
  await check(
    `!!document.querySelector('.screen-rail')`,
    "desktop controls retain their real API-backed screen rail",
  );
  await click("Spaces");
  await input('[aria-label="Search spaces and work"]', "detached");
  await ui(`document.querySelector('.space-result').click()`);
  await until(
    `document.querySelector('.composer input')?.value==='ordinary exact draft'`,
  );

  await click("Computer");
  await ui(
    `document.querySelector('[data-host="http://127.0.0.1:8893"]').click()`,
  );
  await until(`!!document.getElementById('session-headless-job')`);
  await ui(`document.getElementById('session-headless-job').click()`);
  await until(`!!document.querySelector('.composer input')`);
  await input(".composer input", "headless-only draft");
  await click("Computer");
  await ui(
    `document.querySelector('[data-host="http://127.0.0.1:8892"]').click()`,
  );
  await until(
    `document.querySelector('.composer input')?.value==='ordinary exact draft'`,
  );
  await check(
    `document.querySelector('.terminal-context').textContent.includes('Desktop')`,
    "explicit computer switching restores that computer’s terminal and draft",
  );
  await click("Computer");
  await ui(
    `document.querySelector('[data-host="http://127.0.0.1:8893"]').click()`,
  );
  await until(
    `document.querySelector('.composer input')?.value==='headless-only draft'`,
  );
  await check(
    `document.querySelector('.terminal-context').textContent.includes('Headless')`,
    "headless computer keeps a separate draft and view",
  );
  await click("Computer");
  await ui(
    `document.querySelector('[data-host="http://127.0.0.1:8892"]').click()`,
  );
  await until(
    `document.querySelector('.composer input')?.value==='ordinary exact draft'`,
  );
  // A same-name replacement must not receive the old draft or group.
  const identity = fx.state.terminalIds["8892:detached"];
  fx.state.sessionOverrides.detached = {
    terminalId: "$999",
    generation: "fixture:replacement",
  };
  await click("Computer");
  await click("Close Computer");
  await pause(5200);
  await until(`!document.querySelector('.composer input')`);
  await check(
    `document.body.textContent.includes('closed or changed')`,
    "same-name replacement cannot inherit the saved terminal view",
  );
  await click("Spaces");
  await input('[aria-label="Search spaces and work"]', "detached");
  await ui(`document.querySelector('.space-result').click()`);
  await until(`!!document.querySelector('.composer input')`);
  await check(
    `document.querySelector('.composer input').value==='' && document.querySelector('.session-title').textContent.includes('Unassigned')`,
    "replacement identity starts unassigned with an empty draft",
  );

  await click("Terminal actions");
  await click("Move to tab");
  fx.state.organizations[8892].revision++;
  fx.state.organizations[8892].spaces[0].tabs.push({
    id: "task:remote",
    name: "Remote change",
  });
  await ui(
    `{const e=document.querySelector('[aria-label="Destination tab"]');e.value=${
      JSON.stringify(firstTask)
    };e.dispatchEvent(new Event('change',{bubbles:true}));}`,
  );
  await click("Move work");
  await until(`!!document.querySelector('dialog [role="alert"]')`);
  await check(
    `document.querySelector('.composer input').value==='' && document.querySelector('dialog[aria-label="Move to tab"]').textContent.includes('changed')`,
    "concurrent organization edits preserve the form and current terminal on conflict",
  );
  await click("Refresh organization");
  await pause(100);
  await click("Move work");
  await until(`!document.querySelector('dialog[aria-label="Move to tab"]')`);
  await click("Close panel");
  await check(
    `${
      fx.state.organizations[8892].spaces[0].tabs.some((t:any) =>
        t.id === "task:remote"
      )
    }`,
    "explicit refresh and retry preserve another device’s organization change",
  );
  const replacementRef = await ui(
    `JSON.parse(localStorage.getItem('dp_resume_v1')).route.ref`,
  );
  const migration = await ui(
    `JSON.parse(localStorage.getItem('dp_resume_v1'))`,
  );
  delete migration.route.ref;
  delete migration.route.scope;
  delete migration.route.order;
  migration.drafts = {
    '["http://127.0.0.1:8892","detached"]': {
      input: "earlier layout text",
      clip: "earlier paste",
    },
  };
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source:
      `if(location.origin==='http://127.0.0.1:8892'){localStorage.setItem('dp_resume_v1',${
        JSON.stringify(JSON.stringify(migration))
      });history.replaceState(null,'',location.href);}`,
  });
  await reload();
  await until(
    `document.querySelector('h1')?.textContent==='Confirm saved work'`,
  );
  await check(
    `!document.querySelector('.composer input')`,
    "a name-only saved view requires confirmation before opening current work",
  );
  await click("Open current work");
  await until(`!!document.querySelector('.composer input')`);

  await check(
    `document.querySelector('.composer input').value===''`,
    "an earlier name-only draft is preserved without silently assigning it to current work",
  );
  await click("Terminal actions");
  await click("Review saved draft from the earlier layout");
  await click("Add to this terminal’s drafts");
  await click("Close panel");
  await check(
    `document.querySelector('.composer input').value==='earlier layout text'`,
    "explicit restoration migrates an earlier draft into the confirmed runtime identity",
  );
  await check(
    `window.__errors.length===0`,
    "live Spaces has no browser runtime errors",
  );
  await Deno.writeTextFile(
    "/tmp/deskpilot-spaces-live/verification.json",
    JSON.stringify({ checks: count, layouts }, null, 2),
  );
  console.log(
    `PASS ${count} live Spaces checks / ${layouts.length} measured layouts`,
  );
} finally {
  cdp?.close();
  chrome.kill("SIGTERM");
  await chrome.status;
  await fx.close();
  await Deno.remove(profile, { recursive: true }).catch(() => {});
}
