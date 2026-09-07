// Phone layout, measured rather than eyeballed.
//
// Every UI change in this project has shipped on somebody looking at a phone
// and saying it seemed fine. That is not a check, and this project has already
// recorded what it costs: a layout was once declared "verified in a narrow
// viewport" when the browser window was 941px, because a resize had silently
// not taken effect and nobody compared the screenshot to what was asked for.
//
// So the first thing this asserts is that the viewport is the size it asked
// for. Everything after that is only meaningful if that holds.
//
//   deno run -A tests/layout.ts [--url https://host] [--token abc]
//
// Needs chromium on PATH and a running server. Not part of `deno test`: it
// starts a browser and talks to a live service, which is a different kind of
// slow and a different kind of flaky from a unit test.

const WIDTHS = [320, 360, 390, 430];
const HEIGHT = 844;
const DPR = 3;

// Landscape is a different layout, not a wider portrait: the header slims, the
// panes tighten and the machines strip has to earn its row again. It went
// unmeasured until a quarter of a 430px-tall screen was chrome.
const SIZES = [
  ...WIDTHS.map((width) => ({ width, height: HEIGHT })),
  { width: 932, height: 430 },
];

// Landscape deliberately drops to 38px controls to reclaim the transcript —
// see the max-height rule in Pane.svelte. Asserting 44px there would only
// assert that the decision had not been made.
const floorFor = (height: number) => (height <= 480 ? 38 : 44);

// Every size runs twice: once with the machine that served the page, and once
// with several paired. With one host the machines strip does not render at
// all, so a suite that only ever ran the first pass measured none of the
// multi-machine UI — which is exactly where the layout was wrong.
//
// Three of the four are plausible boxes that are simply off, because that is
// the normal state of a laptop and the state that used to leave another
// machine's sessions on screen under this one's name.
const MACHINES = (base: string, token: string) => [
  { origin: base, token, name: "desktop" },
  { origin: "https://framework.tail1234.ts.net", token: "x".repeat(64), name: "framework" },
  { origin: "https://mac-mini.tail1234.ts.net", token: "x".repeat(64), name: "mac-mini" },
  { origin: "https://build-server-rack.tail1234.ts.net", token: "x".repeat(64), name: "build-server-rack" },
];

type Cdp = {
  send: (method: string, params?: unknown, sessionId?: string) => Promise<any>;
  close: () => void;
};

async function connect(wsUrl: string): Promise<Cdp> {
  const ws = new WebSocket(wsUrl);
  await new Promise<void>((res, rej) => {
    ws.onopen = () => res();
    ws.onerror = () => rej(new Error("could not connect to chromium"));
  });

  let id = 0;
  const waiting = new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && waiting.has(msg.id)) {
      const w = waiting.get(msg.id)!;
      waiting.delete(msg.id);
      msg.error ? w.rej(new Error(msg.error.message)) : w.res(msg.result);
    }
  };

  return {
    send(method, params = {}, sessionId) {
      const mid = ++id;
      return new Promise((res, rej) => {
        waiting.set(mid, { res, rej });
        ws.send(JSON.stringify({ id: mid, method, params, sessionId }));
        setTimeout(() => {
          if (waiting.delete(mid)) rej(new Error(`${method} timed out`));
        }, 20000);
      });
    },
    close: () => ws.close(),
  };
}

// The assertions, run inside the page. Kept as one string so it is obvious that
// nothing here can reach outside the browser.
const MEASURE = (floor: number, machines: number) => `(() => {
  const out = { width: innerWidth, dpr: devicePixelRatio, problems: [] };
  const say = (m) => out.problems.push(m);

  // Panes must be exactly one viewport wide, or the horizontal snap lands
  // between screens. This is the check that caught min-width:auto inflating
  // every pane to fit its widest row.
  document.querySelectorAll(".rail > section").forEach((s, i) => {
    const w = Math.round(s.getBoundingClientRect().width);
    if (w !== innerWidth) say(\`pane \${i} is \${w}px, viewport is \${innerWidth}px\`);
  });

  // A header that scrolls sideways has already lost.
  const h = document.querySelector("header");
  if (h && h.scrollWidth > h.clientWidth) {
    say(\`header overflows by \${h.scrollWidth - h.clientWidth}px\`);
  }

  // Nothing may escape the pane that owns it. Compare against the clipping
  // ancestor, not the viewport: a child of an overflow:hidden ellipsis
  // container legitimately overhangs and is clipped when painted.
  document.querySelectorAll(".rail > section").forEach((pane, i) => {
    const pb = pane.getBoundingClientRect();
    pane.querySelectorAll("*").forEach((el) => {
      let clip = el.parentElement;
      while (clip && clip !== pane && getComputedStyle(clip).overflow === "visible") {
        clip = clip.parentElement;
      }
      if (clip !== pane) return;
      const b = el.getBoundingClientRect();
      if (b.width === 0 && b.height === 0) return;
      if (b.right > pb.right + 1 || b.left < pb.left - 1) {
        say(\`\${el.tagName.toLowerCase()}.\${el.className || "-"} escapes pane \${i}\`);
      }
    });
  });

  // 44px is the floor both iOS and Android recommend, and this project has
  // already audited its way out of 60 controls at 26px. Landscape trades down
  // to 38 on purpose; the caller says which applies.
  const tappable = document.querySelectorAll("button, input, select, a[href]");
  let small = 0;
  tappable.forEach((el) => {
    const b = el.getBoundingClientRect();
    if (b.height === 0) return;              // hidden, not a target
    if (b.height < ${floor}) {
      small++;
      if (small <= 5) say(\`\${el.tagName.toLowerCase()} "\${(el.textContent||"").trim().slice(0,18)}" is \${Math.round(b.height)}px tall\`);
    }
  });
  if (small > 5) say(\`…and \${small - 5} more controls under ${floor}px\`);

  // The machines strip, which only exists with more than one paired.
  const strip = document.querySelector("nav.machines");
  if (${machines} > 1 && !strip) say("the machines strip did not render");
  if (${machines} <= 1 && strip) say("the machines strip rendered for a single machine");
  if (strip) {
    const chips = [...strip.querySelectorAll("button.machine")];
    if (chips.length !== ${machines}) say(chips.length + " chips for ${machines} machines");
    chips.forEach((c) => {
      const b = c.getBoundingClientRect();
      if (b.height < ${floor}) say('chip "' + c.textContent.trim() + '" is ' + Math.round(b.height) + "px tall");
      // A chip that clips its own name cannot answer the one question it is
      // there to answer.
      if (c.scrollWidth > c.clientWidth + 1) say('chip "' + c.textContent.trim().slice(0,20) + '" clips its name');
    });
    // The strip scrolls sideways by design, but the machine you are *on* must
    // be visible without scrolling or you cannot tell where you are.
    const on = strip.querySelector("button.machine.on");
    if (!on) say("no chip is marked as the selected machine");
    else {
      const b = on.getBoundingClientRect(), sb = strip.getBoundingClientRect();
      if (b.left < sb.left - 1 || b.right > sb.right + 1) {
        say("the selected machine's chip is off-screen in the strip");
      }
    }
    // Chrome is what you pay before any content. The strip is a whole row of
    // it, and on a short screen that is the transcript you are not reading.
    const chrome = document.querySelector("header").getBoundingClientRect().height +
      strip.getBoundingClientRect().height;
    out.chrome = Math.round(chrome);
    // A quarter of the screen. Landscape used to sit at 108px of 430 because
    // the strip did not slim with the header the way everything else does.
    if (chrome > innerHeight * 0.25) {
      say("header and strip take " + Math.round(chrome) + "px of " + innerHeight + "px");
    }
  }

  // The index lists every machine with a name, an origin and a version on one
  // row. The name is the part that must survive.
  document.querySelectorAll(".mblock .row .nm").forEach((nm) => {
    if (nm.scrollWidth > nm.clientWidth + 1) say('index row "' + nm.textContent.trim() + '" clips the machine name');
  });

  out.counted = {
    panes: document.querySelectorAll(".rail > section").length,
    tappable: tappable.length,
    chips: document.querySelectorAll("button.machine").length,
  };
  return out;
})()`;

// The copy sheet and the paste drawer only exist after a tap, so MEASURE above
// — which reads whatever the app renders on load — never sees either. Both are
// full-width, so the narrowest phone is the only case worth repeating, and both
// need a session with a mounted terminal: on a host with none there is nothing
// to copy, and that is reported rather than failed.
const OPEN_CHECK = `(root, label) => {
  const problems = [];
  const rb = root.getBoundingClientRect();
  if (Math.round(rb.width) !== innerWidth) {
    problems.push(label + " is " + Math.round(rb.width) + "px, viewport is " + innerWidth + "px");
  }
  root.querySelectorAll("*").forEach((el) => {
    let clip = el.parentElement;
    while (clip && clip !== root && getComputedStyle(clip).overflow === "visible") clip = clip.parentElement;
    if (clip !== root) return;
    const b = el.getBoundingClientRect();
    if (b.width === 0 && b.height === 0) return;
    if (b.right > rb.right + 1 || b.left < rb.left - 1) {
      problems.push(el.tagName.toLowerCase() + "." + (el.className || "-") + " escapes " + label);
    }
  });
  // xterm's own helper textarea is offscreen input plumbing, not a target.
  root.querySelectorAll("button, input, select, textarea:not(.xterm-helper-textarea)").forEach((el) => {
    const b = el.getBoundingClientRect();
    if (b.height === 0) return;
    if (b.height < 44) {
      problems.push(el.tagName.toLowerCase() + ' "' + (el.textContent || "").trim().slice(0, 16) + '" is ' + Math.round(b.height) + "px tall");
    }
  });
  return problems;
}`;

async function openStates(cdp: Cdp, base: string, token: string): Promise<number> {
  const width = 320;
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const run = async (expression: string) => {
    const r = await cdp.send("Runtime.evaluate", {
      expression, returnByValue: true, awaitPromise: true,
    }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result?.value;
  };

  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width, height: HEIGHT, deviceScaleFactor: DPR, mobile: true,
  }, sessionId);
  await cdp.send("Page.enable", {}, sessionId);
  // Reading the clipboard back is the only way to know `copy all` did anything.
  await cdp.send("Browser.grantPermissions", {
    origin: base, permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"],
  });
  await cdp.send("Page.navigate", { url: `${base}/?token=${token}` }, sessionId);

  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    await new Promise((r) => setTimeout(r, 250));
    ready = await run(`!!document.querySelector(".rail > section")`) === true;
  }
  if (!ready) {
    console.log(`\x1b[31m✗\x1b[0m ${width}px — the app never rendered a rail`);
    await cdp.send("Target.closeTarget", { targetId });
    return 1;
  }

  // Swipe to the first screen holding a session: only the pane you are on
  // mounts a terminal, and the terminal is what the copy sheet reads.
  const pane = await run(`(() => {
    const rail = document.querySelector(".rail");
    const panes = [...document.querySelectorAll(".rail > section")];
    const i = panes.findIndex((p) => p.classList.contains("composing"));
    if (i < 0) return -1;
    rail.scrollTo({ left: i * rail.clientWidth });
    rail.dispatchEvent(new Event("scroll"));
    return i;
  })()`);
  if (pane < 0) {
    console.log(`\x1b[2m·\x1b[0m copy and paste not measured — no session to open one on`);
    await cdp.send("Target.closeTarget", { targetId });
    return 0;
  }
  await new Promise((r) => setTimeout(r, 3500));   // connect, then prime scrollback

  let failures = 0;

  await run(`[...document.querySelectorAll(".rail > section button")]
    .find((b) => b.textContent.trim() === "copy")?.click()`);
  await new Promise((r) => setTimeout(r, 600));
  const sheet = await run(`(async () => {
    const s = document.querySelector(".sheet");
    if (!s) return { problems: ["the copy sheet did not open"] };
    const pre = s.querySelector("pre");
    const want = pre.textContent;
    const problems = (${OPEN_CHECK})(s, "the copy sheet");
    if (!want.trim()) problems.push("the sheet is empty — the terminal buffer read as nothing");
    if (getComputedStyle(pre).webkitUserSelect === "none") {
      problems.push("the text is not selectable, which is the point of the sheet");
    }
    [...s.querySelectorAll("button")].find((b) => b.textContent.trim() === "copy all").click();
    await new Promise((r) => setTimeout(r, 500));
    let got = "";
    try { got = await navigator.clipboard.readText(); } catch (e) { problems.push("clipboard unreadable: " + e.message); }
    if (got !== want) problems.push("clipboard holds " + got.length + " chars, the sheet shows " + want.length);
    const lines = want.split("\\n");
    return { problems, chars: want.length, lines: lines.length, longest: Math.max(...lines.map((l) => l.length)) };
  })()`);
  if (sheet.problems.length) {
    failures++;
    console.log(`\x1b[31m✗\x1b[0m ${width}px copy sheet`);
    for (const p of sheet.problems) console.log(`    ${p}`);
  } else {
    console.log(`\x1b[32m✓\x1b[0m ${width}px copy sheet  (${sheet.lines} lines, ${sheet.chars} chars on the clipboard, longest line ${sheet.longest})`);
  }

  await run(`[...document.querySelectorAll(".sheet button")]
    .find((b) => b.textContent.trim() === "close")?.click()`);
  await new Promise((r) => setTimeout(r, 300));

  await run(`[...document.querySelectorAll(".rail > section button")]
    .find((b) => b.textContent.trim() === "paste")?.click()`);
  await new Promise((r) => setTimeout(r, 600));
  const drawer = await run(`(() => {
    const pane = [...document.querySelectorAll(".rail > section")].find((p) => p.querySelector(".paste"));
    if (!pane) return { problems: ["the paste drawer did not open"] };
    const problems = (${OPEN_CHECK})(pane, "the pane");
    if (!pane.querySelector(".paste textarea")) problems.push("the drawer has nowhere to paste into");
    const input = pane.querySelector(".composer form input");
    return { problems, inputWidth: Math.round(input.getBoundingClientRect().width) };
  })()`);
  if (drawer.problems.length) {
    failures++;
    console.log(`\x1b[31m✗\x1b[0m ${width}px paste drawer`);
    for (const p of drawer.problems) console.log(`    ${p}`);
  } else {
    console.log(`\x1b[32m✓\x1b[0m ${width}px paste drawer  (composer input still ${drawer.inputWidth}px wide)`);
  }

  await cdp.send("Target.closeTarget", { targetId });
  return failures;
}

// Switching machines must leave nothing of the previous one behind.
//
// This is the check that would have caught the worst of it: select a machine
// that is off and the index went on showing the *previous* machine's sessions
// — the same rows, the same "6 on screen" count — under the new machine's name
// with an offline banner above them. Nothing on that screen was true.
//
// It also asserts that the devices panel follows the selection. It used to
// track nothing at all, because api() only resolves which machine it is
// talking to after its first await, so the effect that loaded it had no
// dependency on the selection and never re-ran.
async function switchClears(cdp: Cdp, base: string, token: string): Promise<number> {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const run = async (expression: string) => {
    const r = await cdp.send("Runtime.evaluate", {
      expression, returnByValue: true, awaitPromise: true,
    }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result?.value;
  };
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 390, height: HEIGHT, deviceScaleFactor: DPR, mobile: true,
  }, sessionId);
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Page.navigate", { url: `${base}/?token=${token}` }, sessionId);
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await run(`!!document.querySelector(".rail > section")`) === true) break;
  }
  await run(seedExpr(base, token, MACHINES(base, token).length));
  // Which machine each request went to is the only way to tell a panel that
  // followed the switch from one that merely looks the same.
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `window.__calls=[];const f=window.fetch;` +
      `window.fetch=(u,o)=>{try{window.__calls.push(String(u.url??u))}catch{}return f(u,o)};`,
  }, sessionId);
  await cdp.send("Page.navigate", { url: `${base}/` }, sessionId);
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await run(`!!document.querySelector("nav.machines")`) === true) break;
  }
  await new Promise((r) => setTimeout(r, 3000));

  // Session rows are bare children of the index section; the machines and
  // devices lists keep theirs inside .mblock.
  const ROWS = `document.querySelectorAll(".rail > section")[0]
    .querySelectorAll(":scope > .row").length`;
  const before = await run(ROWS);
  const problems: string[] = [];
  if (!before) problems.push("no sessions on the first machine, so there is nothing to leave behind");

  await run(`window.__calls=[];` +
    `[...document.querySelectorAll("nav.machines button")].find((b)=>b.textContent.includes("mac-mini")).click();true`);
  // Long enough for the request to the machine that is off to hit its deadline.
  await new Promise((r) => setTimeout(r, 11000));

  const after = await run(`(() => ({
    rows: ${ROWS},
    offline: !!document.querySelector(".offline"),
    selected: document.querySelector("nav.machines button.on")?.textContent.trim() ?? "",
    devicesAsked: window.__calls.some((u) => u.includes("mac-mini") && u.includes("/devices")),
  }))()`);

  if (after.rows) problems.push(`${after.rows} session rows survived the switch to a machine that is off`);
  if (!after.offline) problems.push("no offline banner for a machine that cannot be reached");
  if (!after.selected.includes("mac-mini")) problems.push(`selected chip is "${after.selected}"`);
  if (!after.devicesAsked) problems.push("the devices panel never asked the machine that was switched to");

  await cdp.send("Target.closeTarget", { targetId });
  if (problems.length) {
    console.log(`\x1b[31m✗\x1b[0m switching machines`);
    for (const p of problems) console.log(`    ${p}`);
    return 1;
  }
  console.log(`\x1b[32m✓\x1b[0m switching machines  (${before} rows cleared, offline banner shown, devices refetched)`);
  return 0;
}

// Pairs the first `n` of MACHINES into this browser's keyring and selects the
// real one. The app reads the list at load, so a reload has to follow.
//
// Always written, never assumed absent: every size shares one browser profile
// and therefore one localStorage, so the single-machine pass measured whatever
// the previous size had paired and reported four chips where it expected one.
const seedExpr = (base: string, token: string, n: number) => {
  const list = JSON.stringify(JSON.stringify(MACHINES(base, token).slice(0, n)));
  return `localStorage.setItem("dp_hosts", ${list});
    localStorage.setItem("dp_host", ${JSON.stringify(base)}); true`;
};

async function main() {
  const args = new Map<string, string>();
  for (let i = 0; i < Deno.args.length; i += 2) {
    args.set(Deno.args[i].replace(/^--/, ""), Deno.args[i + 1] ?? "");
  }
  const base = args.get("url") ?? "http://127.0.0.1:8790";
  const token = args.get("token") ??
    (await Deno.readTextFile(`${Deno.env.get("HOME")}/.config/deskpilot/token`)).trim();

  const port = 9333;
  const profile = await Deno.makeTempDir();
  const chrome = new Deno.Command("chromium", {
    args: [
      "--headless=new", `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
      // The server is reached over https with a real cert, but a local run may
      // not be; this is a throwaway profile talking to one machine.
      "--ignore-certificate-errors",
      "about:blank",
    ],
    stdout: "null", stderr: "null",
  }).spawn();

  let wsUrl = "";
  for (let i = 0; i < 40 && !wsUrl; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      wsUrl = (await r.json()).webSocketDebuggerUrl;
    } catch { /* not up yet */ }
  }
  if (!wsUrl) {
    chrome.kill();
    console.error("chromium did not start a debugging endpoint");
    Deno.exit(1);
  }

  const cdp = await connect(wsUrl);
  let failures = 0;

  for (const { width, height } of SIZES) {
    // Once with only the machine that served the page, once with several
    // paired. The second pass is the only one that renders the strip at all.
    for (const machines of [1, MACHINES(base, token).length]) {
      const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });

      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width, height, deviceScaleFactor: DPR, mobile: true,
      }, sessionId);
      await cdp.send("Page.enable", {}, sessionId);

      // Wait for the rail to exist rather than for a fixed time: the app
      // fetches before it can render anything worth measuring.
      const railUp = async () => {
        for (let i = 0; i < 40; i++) {
          await new Promise((r) => setTimeout(r, 250));
          const res = await cdp.send("Runtime.evaluate", {
            expression: `!!document.querySelector(".rail > section")`,
            returnByValue: true,
          }, sessionId);
          if (res.result?.value === true) return true;
        }
        return false;
      };

      await cdp.send("Page.navigate", { url: `${base}/?token=${token}` }, sessionId);
      let ready = await railUp();

      if (ready) {
        await cdp.send("Runtime.evaluate", {
          expression: seedExpr(base, token, machines), returnByValue: true,
        }, sessionId);
        await cdp.send("Page.navigate", { url: `${base}/` }, sessionId);
        ready = await railUp();
        // The strip renders as soon as the list has two entries, but the names
        // on the chips are what each machine calls itself, and that arrives
        // with the capabilities reply.
        await new Promise((r) => setTimeout(r, machines > 1 ? 2500 : 800));
      }

      const res = await cdp.send("Runtime.evaluate", {
        expression: MEASURE(floorFor(height), machines), returnByValue: true,
      }, sessionId);
      const m = res.result?.value;

      const size = height === HEIGHT ? `${width}px` : `${width}x${height}`;
      const label = `${size.padEnd(9)} ${machines} machine${machines > 1 ? "s" : " "}`;

      if (!ready || !m) {
        console.log(`\x1b[31m✗\x1b[0m ${label} — the app never rendered a rail`);
        failures++;
      } else if (m.width !== width) {
        // The lesson from last time: if this is wrong, everything below it is a
        // measurement of something else.
        console.log(`\x1b[31m✗\x1b[0m ${label} — viewport is actually ${m.width}px, measurements would be meaningless`);
        failures++;
      } else if (m.problems.length) {
        console.log(`\x1b[31m✗\x1b[0m ${label}  (${m.counted.panes} panes, ${m.counted.tappable} controls)`);
        for (const p of m.problems) console.log(`    ${p}`);
        failures++;
      } else {
        console.log(`\x1b[32m✓\x1b[0m ${label}  (${m.counted.panes} panes, ${m.counted.tappable} controls${m.chrome ? `, ${m.chrome}px chrome` : ""})`);
      }

      await cdp.send("Target.closeTarget", { targetId });
    }
  }

  failures += await openStates(cdp, base, token);
  failures += await switchClears(cdp, base, token);

  cdp.close();
  chrome.kill();
  await chrome.status;
  await Deno.remove(profile, { recursive: true }).catch(() => {});

  console.log(failures ? `\n${failures} check(s) failed` : "\nlayout is sound at every width, alone and with several machines");
  Deno.exit(failures ? 1 : 0);
}

await main();
