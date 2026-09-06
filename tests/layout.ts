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
const MEASURE = `(() => {
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
  // already audited its way out of 60 controls at 26px.
  const tappable = document.querySelectorAll("button, input, select, a[href]");
  let small = 0;
  tappable.forEach((el) => {
    const b = el.getBoundingClientRect();
    if (b.height === 0) return;              // hidden, not a target
    if (b.height < 44) {
      small++;
      if (small <= 5) say(\`\${el.tagName.toLowerCase()} "\${(el.textContent||"").trim().slice(0,18)}" is \${Math.round(b.height)}px tall\`);
    }
  });
  if (small > 5) say(\`…and \${small - 5} more controls under 44px\`);

  out.counted = { panes: document.querySelectorAll(".rail > section").length, tappable: tappable.length };
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

  for (const width of WIDTHS) {
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });

    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width, height: HEIGHT, deviceScaleFactor: DPR, mobile: true,
    }, sessionId);
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Page.navigate", { url: `${base}/?token=${token}` }, sessionId);

    // Wait for the rail to exist rather than for a fixed time: the app fetches
    // before it can render anything worth measuring.
    let ready = false;
    for (let i = 0; i < 40 && !ready; i++) {
      await new Promise((r) => setTimeout(r, 250));
      const res = await cdp.send("Runtime.evaluate", {
        expression: `!!document.querySelector(".rail > section")`,
        returnByValue: true,
      }, sessionId);
      ready = res.result?.value === true;
    }

    const res = await cdp.send("Runtime.evaluate", {
      expression: MEASURE, returnByValue: true,
    }, sessionId);
    const m = res.result?.value;

    if (!ready || !m) {
      console.log(`\x1b[31m✗\x1b[0m ${width}px — the app never rendered a rail`);
      failures++;
    } else if (m.width !== width) {
      // The lesson from last time: if this is wrong, everything below it is a
      // measurement of something else.
      console.log(`\x1b[31m✗\x1b[0m ${width}px — viewport is actually ${m.width}px, measurements would be meaningless`);
      failures++;
    } else if (m.problems.length) {
      console.log(`\x1b[31m✗\x1b[0m ${width}px  (${m.counted.panes} panes, ${m.counted.tappable} controls)`);
      for (const p of m.problems) console.log(`    ${p}`);
      failures++;
    } else {
      console.log(`\x1b[32m✓\x1b[0m ${width}px  (${m.counted.panes} panes, ${m.counted.tappable} controls, dpr ${m.dpr})`);
    }

    await cdp.send("Target.closeTarget", { targetId });
  }

  failures += await openStates(cdp, base, token);

  cdp.close();
  chrome.kill();
  await chrome.status;
  await Deno.remove(profile, { recursive: true }).catch(() => {});

  console.log(failures ? `\n${failures} width(s) failed` : "\nlayout is sound at every width");
  Deno.exit(failures ? 1 : 0);
}

await main();
