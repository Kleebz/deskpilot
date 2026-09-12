// Mobile navigation and layout, using disposable fixtures and a fresh browser profile.
// deno run -A tests/layout.ts — screenshots go to /tmp/deskpilot-mobile-review.
import { connect } from "./browser.ts";
import { fixture } from "./mobile_fixture.ts";
const fx = await fixture();
const profile = await Deno.makeTempDir({ prefix: "dp-mobile-browser-" });
const chrome = new Deno.Command("chromium", {
  args: [
    "--headless=new",
    "--remote-debugging-port=9342",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ],
  stdout: "null",
  stderr: "null",
}).spawn();
const pause = (ms = 100) => new Promise((r) => setTimeout(r, ms));
let cdp;
try {
  let endpoint;
  for (let i = 0; i < 50; i++) {
    try {
      endpoint =
        (await (await fetch("http://127.0.0.1:9342/json/version")).json())
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
  const send = (method: string, params = {}) =>
    cdp!.send(method, params, sessionId);
  const run = async (expression: string) => {
    const r = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
    return r.result?.value;
  };
  const check = async (expression: string, label: string) => {
    if (!await run(expression)) throw Error(label);
    console.log(`✓ ${label}`);
  };
  const until = async (expression: string) => {
    for (let i = 0; i < 100; i++) {
      if (await run(expression)) return;
      await pause();
    }
    throw Error(
      `Timed out: ${expression}\n${await run("document.body.innerText")}`,
    );
  };
  const click = async (text: string) => {
    await run(
      `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${
        JSON.stringify(text)
      })?.click()`,
    );
    await pause();
  };
  const input = async (selector: string, value: string) => {
    await run(
      `{const el=document.querySelector(${
        JSON.stringify(selector)
      }); el.value=${
        JSON.stringify(value)
      };el.dispatchEvent(new Event('input',{bubbles:true}));}`,
    );
    await pause();
  };
  const choose = async (port: number) => {
    await run(
      `{const el=document.querySelector('select[aria-label="Machine"]');el.value='http://127.0.0.1:${port}';el.dispatchEvent(new Event('change',{bubbles:true}));}`,
    );
    await pause();
  };
  const metrics = async (width: number, height: number) => {
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await pause();
  };
  const swipeLeft = async (selector: string) => {
    const box = await run(
      `(() => { const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {left:r.left,top:r.top,width:r.width,height:r.height}; })()`,
    );
    const y = box.top + box.height * .55;
    const xs = [.82, .65, .48, .31, .14].map((n) => box.left + box.width * n);
    await send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: xs[0], y }],
    });
    for (const x of xs.slice(1)) {
      await send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y }],
      });
      await pause(20);
    }
    await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await pause(500);
  };
  // A phone-sized viewport alone still exposes a mouse pointer in Chromium.
  await send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 1,
  });
  await send("Page.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source:
      `if(!localStorage.getItem('dp_hosts')){localStorage.setItem('dp_hosts',JSON.stringify([{origin:'http://127.0.0.1:8892',token:'fixture',name:'Omarchy',alias:'Desktop'},{origin:'http://127.0.0.1:8893',token:'fixture',name:'Omarchy',alias:'Headless'},{origin:'http://127.0.0.1:8895',token:'fixture',name:'Omarchy',alias:'Offline'}]));localStorage.setItem('dp_host','http://127.0.0.1:8892')}window.__errors=[];window.addEventListener('error', e=>window.__errors.push(e.message));`,
  });
  await metrics(390, 844);
  await send("Page.navigate", { url: "http://127.0.0.1:8892" });
  await until(`document.querySelectorAll('.session-row').length===27`);
  await until(`!!document.querySelector('.attention-row')`);
  await check(
    `document.querySelector('.attention-row').textContent.includes('headless-job') && document.querySelector('.attention-row').textContent.includes('Headless')`,
    "cross-machine attention names the machine and blocked session",
  );
  await run(`document.querySelector('.attention-row').click()`);
  await until(`document.querySelector('.name')?.textContent==='headless-job'`);
  await check(
    `document.querySelector('select[aria-label="Machine"]').value.endsWith('8893')`,
    "cross-machine attention opens the correct machine and session",
  );
  await click("Back to sessions");
  await choose(8892);
  await until(`document.querySelectorAll('.session-row').length===27`);
  await check(
    `document.querySelector('.session-row').textContent.includes('detached')`,
    "attention first, including detached sessions",
  );
  await check(
    `document.getElementById('session-project-0').textContent.includes('Ready') && document.getElementById('session-project-1').textContent.includes('Terminal')`,
    "done and unknown have distinct session labels",
  );
  await run(`document.querySelector('main').scrollTop=650`);
  const scroll = await run(`document.querySelector('main').scrollTop`);
  await run(`document.getElementById('session-detached').click()`);
  await until(`!!document.querySelector('.composer input')`);
  await input(".composer input", "draft for detached");
  await click("Back to sessions");
  await check(
    `document.querySelector('main').scrollTop===${scroll}`,
    "Back to sessions restores scroll",
  );
  await run(`document.getElementById('session-detached').click()`);
  await pause();
  await check(
    `document.querySelector('.composer input').value==='draft for detached'`,
    "terminal draft survives navigation",
  );
  await pause(5200);
  await check(
    `document.querySelector('.composer input').value==='draft for detached'`,
    "polling preserves composer draft",
  );
  if (!fx.state.sockets.includes("8892:detached")) {
    throw Error("Detached terminal identity not opened");
  }
  await click("Back to sessions");
  for (const name of ["same-screen-a", "same-screen-b"]) {
    await run(`document.getElementById('session-${name}').click()`);
    await until(`document.querySelector('.name')?.textContent==='${name}'`);
    await pause(700);
    if (!fx.state.sockets.includes(`8892:${name}`)) {
      throw Error(
        `Wrong terminal for ${name}: ${
          JSON.stringify(fx.state.sockets)
        } errors=${await run("JSON.stringify(window.__errors)")}`,
      );
    }
    await click("Back to sessions");
  }
  console.log("✓ exact terminals for two sessions on one workspace");
  await choose(8893);
  await until(`document.getElementById('session-headless-job')`);
  await check(
    `document.querySelector('main').scrollTop===0 && ![...document.querySelectorAll('nav button')].some(b=>b.textContent==='Screens')`,
    "machine switch starts at top and honors headless capability",
  );
  await choose(8893);
  await check(
    `document.querySelector('select[aria-label="Machine"]').value.endsWith('8893')`,
    "selecting current machine is a no-op",
  );
  await click("New session");
  await check(
    `!document.body.innerText.includes('Desktop placement')`,
    "headless creation has no workspace selector",
  );
  await input('input[placeholder="e.g. api-review"]', "created-headless");
  await pause(5100);
  await check(
    `document.querySelector('input[placeholder="e.g. api-review"]').value==='created-headless'`,
    "polling preserves creation draft",
  );
  await click("Create session");
  await until(
    `document.querySelector('.name')?.textContent==='created-headless'`,
  );
  if (fx.state.created[0]?.workspace !== null) {
    throw Error("Headless creation placed a window");
  }
  console.log("✓ creation opens returned session");
  await click("Back to sessions");
  await choose(8892);
  await until(`document.getElementById('session-detached')`);
  await click("Screens");
  await run(
    `{const el=document.querySelector('select[aria-label="Desktop workspace"]');el.value='2';el.dispatchEvent(new Event('change',{bubbles:true}));}`,
  );
  await until(`Math.abs(document.querySelector('.screen-rail').scrollLeft-document.querySelector('.screen-rail').clientWidth)<2`);
  await check(
    `document.querySelector('[aria-label="Screen 2"] .session-row') && document.querySelector('[aria-label="Screen 2"] .win') && !document.querySelector('[aria-label="Screen 2"]').inert`,
    "Screens selector retains sessions and window controls",
  );
  await swipeLeft('.screen-rail');
  await until(`document.querySelector('select[aria-label="Desktop workspace"]').value==='3'`);
  await check(
    `document.querySelector('[aria-label="Screen 2"]').inert && !document.querySelector('[aria-label="Screen 3"]').inert`,
    "Screens swipe updates the selector and active panel",
  );
  await run(`document.getElementById('new-session-3').click()`);
  await check(
    `document.querySelector('form select:last-of-type')!==null && document.body.innerText.includes('Desktop placement')`,
    "desktop creation exposes optional placement",
  );
  await check(
    `document.querySelectorAll('form select')[1].value==='3'`,
    "Screens creation defaults to the swiped workspace",
  );
  await click("Cancel");
  await until(`document.querySelector('h1')?.textContent==='Screens'`);
  await check(
    `document.activeElement.id==='new-session-3'`,
    "Cancel restores invoking control focus",
  );
  await click("Sessions");
  await click("New session");
  await check(
    `document.querySelectorAll('form select')[1].selectedOptions[0].textContent==='Screen 3'`,
    "creation draft is retained across cancellation",
  );
  await click("Cancel");
  await click("Screens");
  await until(`document.querySelector('select[aria-label="Desktop workspace"]').value==='3'`);
  await run(`{const rail=document.querySelector('.screen-rail');rail.scrollTo({left:rail.scrollWidth,behavior:'auto'});rail.dispatchEvent(new Event('scroll'));}`);
  await until(`document.querySelector('select[aria-label="Desktop workspace"]').value==='10'`);
  await run(`{const rail=document.querySelector('.screen-rail');rail.scrollTo({left:-rail.clientWidth,behavior:'auto'});rail.dispatchEvent(new Event('scroll'));}`);
  await until(`document.querySelector('select[aria-label="Desktop workspace"]').value==='1'`);
  await run(`{const el=document.querySelector('select[aria-label="Desktop workspace"]');el.value='3';el.dispatchEvent(new Event('change',{bubbles:true}));}`);
  await until(`Math.abs(document.querySelector('.screen-rail').scrollLeft-document.querySelector('.screen-rail').clientWidth*2)<2`);
  await choose(8893);
  await until(`document.getElementById('session-headless-job')`);
  await choose(8892);
  await until(`document.getElementById('session-detached')`);
  await click("Screens");
  await until(`document.querySelector('select[aria-label="Desktop workspace"]').value==='3'`);
  await check(
    `Math.abs(document.querySelector('.screen-rail').scrollLeft-document.querySelector('.screen-rail').clientWidth*2)<2`,
    "screen selection is bounded and restored per machine",
  );
  await click("Sessions");
  await click("Add machine");
  await input(".pair-form input", "http://127.0.0.1:8894");
  await input(".code-in", "BADCODE");
  await click("Pair machine");
  await until(`document.querySelector('[role="alert"]')`);
  await check(
    `document.querySelector('.code-in').value==='BADCODE' && document.querySelector('[role="alert"]').textContent.includes('Invalid pairing code')`,
    "pairing failure retains values beside form",
  );
  await click("Cancel");
  await check(
    `document.activeElement.id==='add-machine'`,
    "pair cancellation restores focus",
  );
  await click("Add machine");
  await input(".code-in", "34679CDF");
  await click("Pair machine");
  await until(
    `document.querySelector('h1')?.textContent==='Sessions' && document.querySelector('select[aria-label="Machine"]').value.endsWith('8894')`,
  );
  await check(
    `document.querySelector('main').scrollTop===0`,
    "successful pairing opens machine sessions at top",
  );
  await click("Add machine");
  await input(".pair-form input", "http://127.0.0.1:8892/?code=34679CDF");
  await click("Pair machine");
  await until(
    `document.querySelector('h1')?.textContent==='Sessions' && document.querySelector('select[aria-label="Machine"]').value.endsWith('8892')`,
  );
  await check(
    `document.querySelector('main').scrollTop===0 && JSON.parse(localStorage.getItem('dp_hosts')).find(h=>h.origin.endsWith('8892')).alias==='Desktop'`,
    "already-paired success opens sessions at top without losing its label",
  );
  // Leaving an in-flight pairing must not select its machine when it finishes.
  fx.state.enrollDelay = 700;
  await click("Add machine");
  await input(".pair-form input", "http://127.0.0.1:8894/?code=34679CDF");
  await click("Pair machine");
  await click("Cancel");
  await pause(900);
  await check(
    `document.querySelector('h1')?.textContent==='Sessions' && document.querySelector('select[aria-label="Machine"]').value.endsWith('8892')`,
    "cancelled in-flight pairing cannot navigate",
  );
  fx.state.enrollDelay = 0;
  await click("Manage");
  await until(`document.body.innerText.includes('Authorized devices')`);
  await check(
    `document.body.innerText.includes('Test phone') && !document.querySelector('.session-row')`,
    "management separates authorized devices from sessions",
  );
  await click("rename label");
  await input('input[aria-label="machine label"]', "Studio");
  await click("save");
  await check(
    `document.querySelector('select[aria-label="Machine"]').selectedOptions[0].textContent.startsWith('Studio') && JSON.parse(localStorage.getItem('dp_hosts')).find(h=>h.origin.endsWith('8892')).alias==='Studio' && document.body.innerText.includes('Reported as Omarchy')`,
    "local machine label is shown and persisted separately from hostname",
  );
  await click("Sessions");
  await click("Refresh");
  await until(`document.getElementById('session-detached')`);
  await check(
    `document.querySelector('select[aria-label="Machine"]').selectedOptions[0].textContent.startsWith('Studio')`,
    "capability refresh preserves local machine label",
  );
  await run("location.reload()");
  await until(`document.getElementById('session-detached')`);
  await check(
    `document.querySelector('select[aria-label="Machine"]').selectedOptions[0].textContent.startsWith('Studio')`,
    "machine label survives reload",
  );
  await click("Manage");
  await until(`document.body.innerText.includes('Authorized devices')`);
  await click("rename label");
  await click("use reported name");
  await check(
    `document.querySelector('select[aria-label="Machine"]').selectedOptions[0].textContent.startsWith('Omarchy') && !('alias' in JSON.parse(localStorage.getItem('dp_hosts')).find(h=>h.origin.endsWith('8892')))`,
    "machine label can be reset to the reported hostname",
  );
  await click("rename label");
  await input('input[aria-label="machine label"]', "Desktop");
  await click("save");
  await click("Sessions");
  await click("Add machine");
  await input(
    ".pair-form input",
    "http://127.0.0.1:8894/?token=" + "a".repeat(64),
  );
  await click("Pair machine");
  await until(
    `document.querySelector('h1')?.textContent==='Sessions' && document.querySelector('select[aria-label="Machine"]').value.endsWith('8894')`,
  );
  await check(
    `JSON.parse(localStorage.getItem('dp_hosts')).find(h=>h.origin.endsWith('8894')).token==='${
      "a".repeat(64)
    }'`,
    "legacy token pairing remains compatible",
  );
  await choose(8892);
  await until(`document.getElementById('session-detached')`);
  fx.state.createDelay = 700;
  await click("New session");
  await input('input[placeholder="e.g. api-review"]', "late-created");
  await click("Create session");
  await choose(8893);
  await pause(900);
  await check(
    `document.querySelector('h1')?.textContent==='Sessions' && document.querySelector('select[aria-label="Machine"]').value.endsWith('8893')`,
    "late creation cannot navigate another machine",
  );
  fx.state.createDelay = 0;
  await choose(8892);
  await until(`document.getElementById('session-detached')`);
  fx.state.delay = 1400;
  await click("Refresh");
  await choose(8893);
  await until(`document.getElementById('session-headless-job')`);
  await pause(1600);
  await check(
    `!document.getElementById('session-detached')`,
    "late response cannot replace another machine data",
  );
  await choose(8892);
  await check(
    `document.querySelector('h1')?.textContent==='Loading sessions…'`,
    "loading is distinct from empty",
  );
  await until(`document.getElementById('session-detached')`);
  fx.state.delay = 0;
  fx.state.auth = true;
  await click("Refresh");
  await until(
    `document.querySelector('h1')?.textContent==='Authentication required'`,
  );
  fx.state.auth = false;
  await choose(8895);
  await until(`document.querySelector('h1')?.textContent==='Machine offline'`);
  await check(
    `!!document.querySelector('select[aria-label="Machine"]') && !!document.getElementById('add-machine')`,
    "offline keeps machine picker and pairing available",
  );
  await choose(8892);
  await until(`document.getElementById('session-detached')`);
  fx.state.empty = true;
  await click("Refresh");
  await until(`document.body.innerText.includes('No sessions yet')`);
  fx.state.empty = false;
  await click("Refresh");
  await until(`document.getElementById('session-detached')`);
  await click("Add machine");
  await run("history.back()");
  await until(`document.querySelector('h1')?.textContent==='Sessions'`);
  console.log("✓ browser Back navigation");
  await Deno.mkdir("/tmp/deskpilot-mobile-review", { recursive: true });
  const measure = async (label: string, width: number) => {
    await check(
      `innerWidth===${width} && document.documentElement.scrollWidth<=innerWidth && [...document.querySelectorAll('main,header,nav,.composing')].every(el=>el.getBoundingClientRect().right<=innerWidth+1)`,
      `${label}: no page overflow`,
    );
    await check(
      `[...document.querySelectorAll('button,input,select')].filter(el=>{const r=el.getBoundingClientRect();return r.width && r.height && r.top>=0 && r.bottom<=innerHeight}).every(el=>el.getBoundingClientRect().height>=(innerHeight<=480?38:44))`,
      `${label}: touch target heights`,
    );
    if (label.endsWith("terminal")) {
      await check(
        `document.querySelector('.composer input').getBoundingClientRect().width>=70 && document.querySelector('.composer').getBoundingClientRect().bottom<=innerHeight+1 && document.querySelector('.wrap').getBoundingClientRect().height>=80`,
        `${label}: usable composer and terminal`,
      );
    }
  };
  for (
    const [width, height] of [[320, 844], [360, 844], [390, 844], [430, 844], [
      932,
      430,
    ]]
  ) {
    await metrics(width, height);
    await measure(`${width}×${height} sessions`, width);
    let shot = await send("Page.captureScreenshot", { format: "png" });
    await Deno.writeFile(
      `/tmp/deskpilot-mobile-review/sessions-${width}.png`,
      Uint8Array.from(atob(shot.data), (c) => c.charCodeAt(0)),
    );
    await run(`document.getElementById('session-detached').click()`);
    await until(`!!document.querySelector('.composer input')`);
    await measure(`${width}×${height} terminal`, width);
    await click("paste");
    await measure(`${width}×${height} paste drawer`, width);
    await click("cancel");
    await until(
      `!!document.querySelector(".xterm-screen") && !document.querySelector(".wrap .state")`,
    );
    await check(
      `(() => {
      const helper = document.querySelector('.xterm-helper-textarea');
      const composer = document.querySelector('.composer input');
      const screen = document.querySelector('.xterm-screen');
      if (!matchMedia('(pointer: coarse)').matches || !helper || !composer || !screen) return false;
      if (!helper.readOnly || helper.tabIndex !== -1) return false;
      composer.focus();
      screen.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      return document.activeElement === composer;
    })()`,
      `${width}×${height}: terminal tap preserves composer focus and blocks mobile IME input`,
    );
    shot = await send("Page.captureScreenshot", { format: "png" });
    await Deno.writeFile(
      `/tmp/deskpilot-mobile-review/terminal-${width}.png`,
      Uint8Array.from(atob(shot.data), (c) => c.charCodeAt(0)),
    );
    await click("Back to sessions");
    await click("Add machine");
    await measure(`${width}×${height} pairing`, width);
    await click("Cancel");
    await click("Screens");
    await until(`document.querySelector('h1')?.textContent==='Screens'`);
    await measure(`${width}×${height} screens`, width);
    await check(
      `(() => { const rail=document.querySelector('.screen-rail'); const panel=rail.children[0].getBoundingClientRect().width; return [...rail.children].every(p=>Math.abs(p.getBoundingClientRect().width-rail.clientWidth)<1) && Math.abs(rail.scrollWidth-panel*10)<2; })()`,
      `${width}×${height}: screen panels match the rail width`,
    );
    await click("Sessions");
    await click("Manage");
    await until(`document.body.innerText.includes('Authorized devices')`);
    await click("rename label");
    await measure(`${width}×${height} machine rename`, width);
    await click("cancel");
    await click("Sessions");
  }
  await metrics(390, 420);
  await click("New session");
  await run(
    `document.querySelector('form input').focus()`,
  );
  await pause();
  await check(
    `document.querySelector('.form-actions').getBoundingClientRect().bottom<=innerHeight`,
    "form actions remain visible with reduced keyboard viewport",
  );
  await click("Cancel");
  await check(`window.__errors.length===0`, `no browser runtime errors`);
  console.log("Screenshots: /tmp/deskpilot-mobile-review");
} finally {
  cdp?.close();
  try {
    chrome.kill();
  } catch { /* exited */ }
  await fx.close();
  await Deno.remove(profile, { recursive: true }).catch(() => {});
}
