// Actual service-worker upgrades in disposable Chromium and HTTP fixtures.
// DESKPILOT_TEST_WEB_DIST selects a staged build. An optional previous build
// exercises the first upgrade from a UI that predates the update notice.
import { connect } from "./browser.ts";
import { fixture } from "./mobile_fixture.ts";
import { assertEquals } from "jsr:@std/assert@1";
const fx = await fixture();
const candidate = fx.state.uiDirectory;
const previous = Deno.env.get("DESKPILOT_TEST_PREVIOUS_WEB_DIST");
const temp = await Deno.makeTempDir({ prefix: "deskpilot-ui-upgrade-" });
const copy = async (from: string, to: string) => {
  await Deno.mkdir(to, { recursive: true });
  for await (const e of Deno.readDir(from)) {
    if (e.isDirectory) await copy(from + "/" + e.name, to + "/" + e.name);
    else await Deno.copyFile(from + "/" + e.name, to + "/" + e.name);
  }
};
const candidateBuild =
  JSON.parse(await Deno.readTextFile(candidate + "/ui-build.json")).build;
const altered = async (name: string, build: string, broken = false) => {
  const dir = temp + "/" + name;
  await copy(candidate, dir);
  await Deno.writeTextFile(dir + "/ui-build.json", JSON.stringify({ build }));
  const updateJS = async (path: string) => {
    for await (const e of Deno.readDir(path)) {
      const file = path + "/" + e.name;
      if (e.isDirectory) await updateJS(file);
      else if (e.name.endsWith(".js")) {
        const text = await Deno.readTextFile(file);
        await Deno.writeTextFile(
          file,
          text.replaceAll(candidateBuild, build).replace(
            "deskpilot-shell-",
            "deskpilot-shell-" + name + "-",
          ),
        );
      }
    }
  };
  await updateJS(dir);
  if (broken) {
    const manifest = JSON.parse(
      await Deno.readTextFile(dir + "/.vite/manifest.json"),
    );
    manifest.bad = { file: "assets/not-published.js" };
    await Deno.writeTextFile(
      dir + "/.vite/manifest.json",
      JSON.stringify(manifest),
    );
  }
  return dir;
};
const baseline = previous || await altered("baseline", "000000000001");
const future = await altered("future", "000000000002");
const broken = await altered("broken", "000000000003", true);
fx.state.uiDirectory = baseline;
const inventory = await (await fetch("http://127.0.0.1:8892/api/sessions"))
  .json();
const shell = inventory.find((s: any) => s.session === "detached");
fx.state.organizations[8892] = {
  version: 1,
  revision: 1,
  spaces: [{
    id: "local:saved",
    name: "Saved space",
    tabs: [{ id: "task:saved", name: "Saved tab" }],
  }],
  assignments: [{
    source: {
      kind: "session",
      id: shell.terminalId,
      generation: shell.generation,
    },
    task: "task:saved",
  }],
};
const chrome = new Deno.Command("chromium", {
  args: [
    "--headless=new",
    "--disable-background-networking",
    "--no-first-run",
    "--remote-debugging-port=9356",
    "--user-data-dir=" + temp + "/profile",
    "about:blank",
  ],
  stdout: "null",
  stderr: "null",
}).spawn();
const pause = (ms = 100) => new Promise((r) => setTimeout(r, ms));
let cdp, checks = 0;
try {
  let endpoint;
  for (let n = 0; n < 80; n++) {
    try {
      endpoint =
        (await (await fetch("http://127.0.0.1:9356/json/version")).json())
          .webSocketDebuggerUrl;
      break;
    } catch {}
    await pause();
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
  const ui = (s: string) =>
    run(
      'document.querySelector("iframe").contentWindow.eval(' +
        JSON.stringify(s) + ")",
    );
  const until = async (s: string) => {
    for (let n = 0; n < 160; n++) {
      try {
        if (await ui(s)) return;
      } catch {}
      await pause();
    }
    throw Error("Timed out " + s + "\n" + await ui("document.body.innerText"));
  };
  const check = async (s: string, label: string) => {
    if (!await ui(s)) {
      throw Error(label + "\n" + await ui("document.body.innerText"));
    }
    checks++;
    console.log("PASS " + label);
  };
  await send("Page.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source:
      'if(location.origin==="http://127.0.0.1:8892"&&!localStorage.getItem("dp_hosts")){localStorage.setItem("dp_hosts",JSON.stringify([{origin:location.origin,name:"Desktop",token:"fixture-device"}]));localStorage.setItem("dp_host",location.origin);}window.__errors=[];window.addEventListener("error",e=>__errors.push(e.message));',
  });
  await send("Page.navigate", {
    url: "http://127.0.0.1:8892/__preview_harness",
  });
  await pause(200);
  await run(
    'document.body.innerHTML=\'<iframe src="/" style="width:390px;height:844px;border:0"></iframe>\'',
  );
  await until(
    '!!document.querySelector("[aria-label=\\"Search spaces and work\\"]")',
  );
  await ui(
    '{const e=document.querySelector("[aria-label=\\"Search spaces and work\\"]");e.value="detached";e.dispatchEvent(new Event("input",{bubbles:true}));}',
  );
  await until('!!document.querySelector(".space-result")');
  await ui('document.querySelector(".space-result").click()');
  await until('!!document.querySelector(".composer input")');
  await ui(
    'document.querySelector(".composer input").value="draft before upgrade";document.querySelector(".composer input").dispatchEvent(new Event("input",{bubbles:true}));window.dispatchEvent(new Event("pagehide"));',
  );
  await until("!!navigator.serviceWorker.controller");
  fx.state.uiDirectory = candidate;
  await ui(
    '(async()=>{await(await navigator.serviceWorker.getRegistration("/")).update();})()',
  );
  await until(
    "(async()=>{const channel=new MessageChannel();return await new Promise(resolve=>{const t=setTimeout(()=>resolve(false),1000);channel.port1.onmessage=e=>{clearTimeout(t);channel.port1.close();resolve(e.data.build===" +
      JSON.stringify(candidateBuild) +
      ')};navigator.serviceWorker.controller?.postMessage({type:"DESKPILOT_BUILD"},[channel.port2]);});})()',
  );
  await check(
    'document.querySelector(".composer input").value==="draft before upgrade"',
    "installing a replacement worker does not reload or discard the old UI draft",
  );
  await ui("location.reload()");
  await until(
    '!!document.querySelector(".composer input")&&!!document.querySelector(".app-shell")',
  );
  await check(
    'document.querySelector(".composer input").value==="draft before upgrade"&&JSON.parse(localStorage.getItem("dp_hosts"))[0].token==="fixture-device"',
    "upgrade from the previously built UI preserves its exact-source draft and pairing",
  );
  await check(
    'document.querySelector(".session-title").textContent.includes("Saved space / Saved tab")',
    "previous computer-owned organization survives UI upgrade",
  );
  await until("!!navigator.serviceWorker.controller");
  fx.state.uiDirectory = future;
  const before = await ui("performance.timeOrigin");
  await ui('window.dispatchEvent(new Event("online"))');
  await until('!!document.querySelector(".update-notice")');
  await check(
    "performance.timeOrigin===" + before +
      '&&document.querySelectorAll(".update-notice").length===1&&document.querySelector(".composer input").value==="draft before upgrade"',
    "a successfully installed future UI produces one notice without reloading the composer",
  );
  await ui(
    'document.querySelector(".composer input").value="newer unsent upgrade draft";document.querySelector(".composer input").dispatchEvent(new Event("input",{bubbles:true}));document.querySelector(".update-notice button").click();',
  );
  await until(
    "performance.timeOrigin!==" + before +
      '&&!!document.querySelector(".composer input")',
  );
  await check(
    'document.querySelector(".composer input").value==="newer unsent upgrade draft"&&!document.querySelector(".update-notice")&&JSON.parse(localStorage.getItem("dp_hosts"))[0].token==="fixture-device"',
    "explicit Reload saves the latest typing, preserves pairing and opens the new UI",
  );
  assertEquals(fx.state.organizations[8892].revision, 1);
  fx.state.uiDirectory = broken;
  await ui('window.dispatchEvent(new Event("online"))');
  await pause(2500);
  await check(
    '!document.querySelector(".update-notice")&&document.querySelector(".composer input").value==="newer unsent upgrade draft"',
    "a failed partial installation never advertises readiness or replaces the usable UI",
  );
  await send("Network.enable");
  await send("Network.emulateNetworkConditions", {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0,
  });
  await ui('window.dispatchEvent(new Event("pagehide"));location.reload()');
  await until(
    '!!document.querySelector(".app-shell")&&document.body.textContent.includes("Using saved UI")',
  );
  await check(
    'document.body.textContent.includes("Cannot reach")&&!!document.querySelector("button[aria-label=\\"Computer\\"]")',
    "cold offline launch uses the cached UI and exposes computer recovery",
  );
  await check(
    'JSON.parse(localStorage.getItem("dp_hosts"))[0].token==="fixture-device"&&Object.values(JSON.parse(localStorage.getItem("dp_resume_v1")).drafts).some(d=>d.input==="newer unsent upgrade draft")',
    "offline launch retains pairing and saved source draft without replaying input",
  );
  console.log("PASS " + checks + " actual service-worker upgrade checks");
} finally {
  cdp?.close();
  chrome.kill("SIGTERM");
  await chrome.status;
  await fx.close();
  for (let n = 0; n < 10; n++) {
    try {
      await Deno.remove(temp, { recursive: true });
      break;
    } catch {
      await pause(150);
    }
  }
}
