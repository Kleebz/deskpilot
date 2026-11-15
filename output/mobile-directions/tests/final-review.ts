// Isolated proposed-shell review. Requires the sample server on localhost:5178.
// Does not load web/dist, host credentials or real APIs.
import { connect } from "./cdp.ts";
const dir = await Deno.makeTempDir({ prefix: "deskpilot-final-review-" });
const chrome = new Deno.Command("chromium", {
  args: [
    "--headless=new",
    "--no-first-run",
    "--disable-background-networking",
    "--remote-debugging-port=9391",
    "--user-data-dir=" + dir,
    "about:blank",
  ],
  stdout: "null",
  stderr: "null",
}).spawn();
const reviewOrigin=Deno.env.get("DESKPILOT_REVIEW_ORIGIN")||"http://127.0.0.1:5178";
const out = new URL("../artifacts/final-review/", import.meta.url);
await Deno.mkdir(out, { recursive: true });
const pause = (ms = 80) => new Promise((r) => setTimeout(r, ms));
let cdp;
let count = 0;
const layouts: any[] = [];
try {
  let endpoint;
  for (let n = 0; n < 80; n++) {
    try {
      endpoint =
        (await (await fetch("http://127.0.0.1:9391/json/version")).json())
          .webSocketDebuggerUrl;
      break;
    } catch {}
    await pause();
  }
  if (!endpoint) throw Error("Chromium unavailable");
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
  const ui = (s: string) =>
    run(
      'document.querySelector("iframe").contentWindow.eval(' +
        JSON.stringify(s) + ")",
    );
  const until = async (s: string) => {
    for (let n = 0; n < 100; n++) {
      try {
        if (await ui(s)) return;
      } catch {}
      await pause();
    }
    throw Error("Timed out: " + s + "\n" + await ui("document.body.innerText"));
  };
  const check = async (s: string, label: string) => {
    if (!await ui(s)) {
      throw Error(label + "\n" + await ui("document.body.innerText"));
    }
    count++;
    console.log("✓ " + label);
  };
  const click = async (s: string) => {
    await ui("document.querySelector(" + JSON.stringify(s) + ").click()");
    await pause();
  };
  const size = async (w: number, h: number) => {
    await run(
      'Object.assign(document.querySelector("iframe").style,{width:"' + w +
        'px",height:"' + h + 'px"})',
    );
    await pause();
    if (await ui("innerWidth") !== w || await ui("innerHeight") !== h) {
      throw Error("Frame viewport differs from target");
    }
  };
  const shot = async (name: string) => {
    const box = await run(
      '(()=>{const r=document.querySelector("iframe").getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()',
    );
    const r = await send("Page.captureScreenshot", {
      format: "png",
      clip: box,
      captureBeyondViewport: true,
    });
    await Deno.writeFile(
      new URL(name + ".png", out),
      Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0)),
    );
  };
  const layout = async (label: string) => {
    const m = await ui(
      '(()=>{const modal=[...document.querySelectorAll("dialog[open]")].at(-1),root=modal||document;const targets=[...root.querySelectorAll("button,input,select,textarea")].filter(e=>e.getClientRects().length);return{width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,short:targets.filter(e=>e.getBoundingClientRect().height<43.9).map(e=>e.textContent),escaped:targets.filter(e=>{const r=e.getBoundingClientRect();return r.left<-.5||r.right>innerWidth+.5}).map(e=>e.textContent),output:document.querySelector(".output").getBoundingClientRect().height,sidebar:getComputedStyle(document.querySelector(".desktop-nav")).display}})()',
    );
    if (m.overflow || m.short.length || m.escaped.length) {
      throw Error(label + JSON.stringify(m));
    }
    if (m.width === 390 && m.height === 430 && m.output < 258) {
      throw Error("Reduced output below 60%");
    }
    layouts.push({ label, ...m });
  };
  await send("Page.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source:
      'window.__errors=[];window.addEventListener("error",e=>__errors.push(e.message));window.addEventListener("unhandledrejection",e=>__errors.push(String(e.reason)));',
  });
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1600,
    height: 1250,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Page.navigate", { url: reviewOrigin+"/final-review/" });
  await until(
    'document.querySelector("#terminal-name")?.textContent==="Mobile navigation"',
  );
  for (const w of [320, 360, 390, 430]) {
    await size(w, 844);
    await layout("Phone " + w);
    await click("#spaces-open");
    await layout("Drawer " + w);
    await click(".close-nav");
  }
  for (
    const [w, h] of [
      [390, 430],
      [932, 430],
      [959, 844],
      [960, 844],
      [1024, 840],
      [1280, 840],
      [1440, 840],
    ]
  ) {
    await size(w, h);
    await layout("Shell " + w + "x" + h);
  }
  await size(1280, 840);
  await shot("desktop");
  await check(
    'getComputedStyle(document.querySelector(".desktop-nav")).display==="block"&&!document.querySelector(".bottom-dock,.task-tabs,.pane-tabs")',
    "one persistent desktop hierarchy, with no competing tab strips or dock",
  );
  await size(390, 844);
  await shot("phone");
  await ui(
    'document.querySelector("#prompt").value="Original exact draft";document.querySelector("#prompt").dispatchEvent(new Event("input",{bubbles:true}))',
  );
  await click("#spaces-open");
  await check(
    'document.querySelector("#navigator [data-open=\\"native-1\\"]").getAttribute("aria-current")==="true"&&document.querySelector("#navigator [data-expand=\\"available\\"]").getAttribute("aria-expanded")==="false"',
    "phone drawer highlights current work and keeps available conversations collapsed",
  );
  await shot("drawer");
  await click('#navigator [data-open="native-2"]');
  await check(
    '!document.querySelector("#navigator").open&&document.querySelector("#prompt").value===""',
    "explicit terminal selection closes the drawer and keeps a separate draft",
  );
  await click("#previous");
  await check(
    'document.querySelector("#prompt").value==="Original exact draft"',
    "previous terminal restores its own draft",
  );
  await click("#spaces-open");
  await click('#navigator [data-expand="available"]');
  await click('#navigator [data-hide="chat-1"]');
  await click('[data-confirm-hide="chat-1"]');
  await check(
    '!document.querySelector("#navigator [data-open=\\"chat-1\\"]")&&document.querySelector("#navigator #show-hidden")',
    "hidden conversation is recoverable without cluttering normal work",
  );
  await click("#navigator #show-hidden");
  await click('#navigator [data-hide="chat-1"]');
  await click('[data-confirm-hide="chat-1"]');
  await check(
    '!!document.querySelector("#navigator [data-open=\\"chat-1\\"]")',
    "Restore returns the same sample conversation",
  );
  await click(".close-nav");
  await click("#computer-open");
  await click('#panel-body [data-panel="settings"]');
  await click('#panel-body [data-panel="machines"]');
  await click('#panel-body [data-panel="pair"]');
  await click("#panel-body [data-back]");
  await check(
    'document.querySelector("#panel-title").textContent==="Computers & pairing"&&document.activeElement.dataset.panel==="pair"',
    "pairing cancellation returns to the exact invoking settings subsection and control",
  );
  await click("#panel-close");
  await size(390, 430);
  await layout("Keyboard terminal");
  await shot("keyboard");
  await check(
    'document.querySelector("#prompt").value==="Original exact draft"',
    "breakpoint and reduced viewport changes preserve the same composer draft",
  );
  await run(
    'document.querySelector("iframe").contentWindow.postMessage({scenario:"ordinary"},location.origin)',
  );
  await pause();
  await click("#spaces-open");
  await layout("Without Herdr");
  await check(
    '!document.querySelector("#navigator [data-expand=\\"space:Deskpilot\\"]")&&!!document.querySelector("#navigator [data-open=\\"local-1\\"]")',
    "ordinary work uses the same hierarchy with Herdr absent",
  );
  await shot("without-herdr");
  await click(".close-nav");
  await size(390, 844);
  for (const s of ["offline", "auth", "update"]) {
    await run(
      'document.querySelector("iframe").contentWindow.postMessage({scenario:' +
        JSON.stringify(s) + "},location.origin)",
    );
    await pause();
    await layout(s);
    await shot(s);
  }
  await check(
    'document.querySelector("#feedback").textContent.includes("Reload")',
    "available UI update has a visible deliberate reload path",
  );
  await check(
    "window.__errors.length===0",
    "review has no browser runtime errors",
  );
  await check(
    '!performance.getEntriesByType("resource").some(e=>new URL(e.name).pathname.startsWith("/api/"))',
    "review loads no production API resources",
  );
  await Deno.writeTextFile(
    new URL("verification.json", out),
    JSON.stringify(
      {
        checks: count,
        layouts,
        boundary:
          "Design sample only; production xterm/transport and physical Android validation remain release gates",
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS " + count + " review checks / " + layouts.length + " layouts",
  );
} finally {
  cdp?.close();
  chrome.kill("SIGTERM");
  await chrome.status;
  for (let n = 0; n < 10; n++) {
    try {
      await Deno.remove(dir, { recursive: true });
      break;
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) break;
      if (n === 9) throw e;
      await pause(150);
    }
  }
}
