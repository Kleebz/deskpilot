// Real phone-sized same-origin iframe; measurements precede screenshots.
// deno run -A tests/previews-mobile.ts
import { assert } from "jsr:@std/assert@1";
import { connect } from "./browser.ts";
import { fixture } from "./mobile_fixture.ts";

const fx = await fixture();
const profile = await Deno.makeTempDir({
  prefix: "deskpilot-preview-browser-",
});
const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
const port = (listener.addr as Deno.NetAddr).port;
listener.close();
const chrome = new Deno.Command("chromium", {
  args: [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ],
  stdout: "null",
  stderr: "null",
}).spawn();
const sleep = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));
let cdp: Awaited<ReturnType<typeof connect>> | undefined;
try {
  let endpoint = "";
  for (let i = 0; i < 100; i++) {
    try {
      endpoint =
        (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json())
          .webSocketDebuggerUrl;
      break;
    } catch {
      await sleep();
    }
  }
  assert(endpoint, "Chromium did not start");
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
  const evaluate = async (expression: string) => {
    const r = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
    return r.result?.value;
  };
  const run = (code: string) =>
    evaluate(
      `(async()=>{const f=document.querySelector('iframe'),d=f.contentDocument,w=f.contentWindow;${code}})()`,
    );
  const read = (expression: string) => run(`return (${expression});`);
  const until = async (expression: string) => {
    for (let i = 0; i < 100; i++) {
      if (await read(expression)) return;
      await sleep();
    }
    throw Error(`Timed out: ${expression}\n${await read("d.body.innerText")}`);
  };
  const check = async (expression: string, label: string) => {
    assert(await read(expression), label);
    console.log(`PASS ${label}`);
  };
  const click = async (text: string) => {
    if(text==='Disconnect view')text='Disconnect mobile view';
    const exists = async (label:string) => read(`[...d.querySelectorAll('button')].some(b=>b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)})`);
    if(['Desktop','Previews','Settings','Pair computer'].includes(text)&&!await exists(text)) await click('Computer');
    if(['paste','copy','keys','normal','large'].includes(text)&&!await exists(text)) await click('Input tools');
    if(['End session','Disconnect mobile view'].includes(text)&&!await exists(text)) {
      await click(await exists('Terminal actions')?'Terminal actions':'Terminal actions');
    }
    if(text.startsWith('Back to ')&&await exists('Close panel')) await click('Close panel');
    if(text==='Back to sessions'&&!await exists(text)&&await exists('Back to Attention')) text='Back to Attention';
    await run(`[...([...d.querySelectorAll('dialog[open]')].at(-1)||d).querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}||b.getAttribute('aria-label')===${JSON.stringify(text)})?.click()`);
    await sleep();
  };
  const choose = async (machine: number) => {
    if(!await read(`!!d.querySelector('select[aria-label="Machine"]')`)) await click('Computer');
    await run(`{const e=d.querySelector('select[aria-label="Machine"]');if(e){e.value='http://127.0.0.1:${machine}';e.dispatchEvent(new w.Event('change',{bubbles:true}));}else d.querySelector('[data-host="http://127.0.0.1:${machine}"]').click();}`);
    await sleep();
    await click('Spaces');
  };
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1000,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source:
      `if(location.origin==='http://127.0.0.1:8892'&&!localStorage.getItem('dp_hosts')){localStorage.setItem('dp_hosts',JSON.stringify([{origin:location.origin,token:'fixture',name:'Desktop'},{origin:'http://127.0.0.1:8893',token:'fixture',name:'Headless'}]));localStorage.setItem('dp_host',location.origin);localStorage.setItem('dp_resume_v1',JSON.stringify({version:1,route:{host:location.origin,view:'previews'}}));}window.__errors=[];window.addEventListener('error',e=>__errors.push(e.message));`,
  });
  await send("Page.navigate", {
    url: "http://127.0.0.1:8892/__preview_harness",
  });
  await sleep(150);
  await evaluate(
    `{const f=document.createElement('iframe');f.src='/';f.style='display:block;border:0;width:390px;height:844px';document.body.append(f);}`,
  );
  await until(`d.querySelector('.selected-preview img')?.naturalWidth===192`);
  await check(
    `d.querySelector('.details p').textContent==='Login page layout'`,
    "latest task preview loads without opening a terminal",
  );
  await Deno.mkdir("/tmp/deskpilot-preview-review", { recursive: true });
  for (const width of [320, 360, 390, 430]) {
    await evaluate(`document.querySelector('iframe').style.width='${width}px'`);
    await sleep();
    await check(
      `w.innerWidth===${width}&&d.documentElement.scrollWidth<=${width}&&d.querySelector('header').scrollWidth<=d.querySelector('header').clientWidth&&[...d.querySelectorAll('header,nav,main,.selected-preview,.history,nav button,main button')].every(el=>{const r=el.getBoundingClientRect();return r.width===0||(r.left>=-1&&r.right<=${width}+1);})`,
      `${width}px preview layout stays inside its measured viewport`,
    );
    await check(
      `[...d.querySelectorAll('button,input,select')].every(el=>{const r=el.getBoundingClientRect();return r.width===0||r.height>=44;})`,
      `${width}px controls meet touch target sizes`,
    );
    const shot = await send("Page.captureScreenshot", {
      format: "png",
      clip: { x: 0, y: 0, width, height: 844, scale: 1 },
    });
    await Deno.writeFile(
      `/tmp/deskpilot-preview-review/previews-${width}.png`,
      Uint8Array.from(atob(shot.data), (c) => c.charCodeAt(0)),
    );
  }
  await run(`d.querySelector('[aria-label="Enlarge preview"]').click();`);
  await check(
    `d.querySelector('dialog').open`,
    "preview opens in a modal image viewer",
  );
  await click("Actual size");
  await check(
    `d.querySelector('dialog img').classList.contains('full')`,
    "actual-size image supports scrolling",
  );
  await click("Close preview");
  fx.state.previews.unshift({
    ...fx.state.previews[0],
    id: "preview-new",
    caption: "Latest test result",
    created: 1793000010000,
  });
  await click("Refresh");
  await until(
    `d.querySelector('.details p')?.textContent==='Latest test result'`,
  );
  await run(`d.querySelectorAll('.history button')[1].click();`);
  await until(
    `d.querySelector('.details p')?.textContent==='Login page layout'`,
  );
  await click("Refresh");
  await check(
    `d.querySelector('.details p').textContent==='Login page layout'`,
    "refresh preserves an older preview selected for review",
  );
  await run(`w.location.reload();`);
  await until(
    `d.querySelector('h1')?.textContent==='Previews'&&d.querySelector('.selected-preview img')?.naturalWidth===192&&d.querySelector('.details p')?.textContent==='Latest test result'`,
  );
  await click("Remove preview");
  await until(
    `d.querySelector('.details p')?.textContent==='Login page layout'`,
  );
  assert(
    !fx.state.previews.some((p) => p.id === "preview-new"),
    "latest image was not removed",
  );
  console.log("PASS history, preview-route reload, and image deletion");
  fx.state.previewDelay = 700;
  await run(`d.querySelectorAll('.history button')[1].click();`);
  await choose(8893);
  await until(`!!d.querySelector('.work-navigation')`);
  await click("Previews");
  await sleep(850);
  await check(
    `!d.querySelector('.selected-preview img')&&d.body.innerText.includes('No previews yet')`,
    "late image loading cannot leak into another machine",
  );
  await check(
    `d.body.innerText.includes('deskpilot preview screenshot.png')`,
    "headless empty view explains image publishing",
  );
  await choose(8892);
  fx.state.previewDelay = 0;
  await click("Previews");
  await until(`d.querySelector('.selected-preview img')?.naturalWidth===192`);
  fx.state.previews[0].caption = "A".repeat(1000);
  await click("Refresh");
  await check(
    `d.documentElement.scrollWidth===w.innerWidth`,
    "long captions wrap without horizontal overflow",
  );
  await check(`w.__errors.length===0`, "no preview browser runtime errors");
} finally {
  cdp?.close();
  try {
    chrome.kill();
  } catch { /*already stopped*/ }
  await chrome.status;
  await fx.close();
  for (let i = 0; i < 10; i++) {
    try {
      await Deno.remove(profile, { recursive: true });
      break;
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) break;
      if (i === 9) console.error(`Could not remove browser profile: ${e}`);
      else await sleep(100);
    }
  }
}
