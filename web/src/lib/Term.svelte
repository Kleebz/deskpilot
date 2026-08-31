<script>
  import { onMount } from "svelte";
  import { Terminal } from "@xterm/xterm";
  import { FitAddon } from "@xterm/addon-fit";
  import "@xterm/xterm/css/xterm.css";
  import { token } from "./api.js";

  let { session, fontPx = 10, alive = false, busy = false, onactivity } = $props();

  let host = $state(null);
  let term, fit, ws;
  let state = $state("connecting");

  // The palette the rest of the app uses, so a terminal does not arrive looking
  // like a different program. Values are the desktop's Cyberpunk Cyan theme.
  const theme = {
    background: "#12141e", foreground: "#e0f7ff",
    cursor: "#00ffff", cursorAccent: "#0a0a0f", selectionBackground: "#00ffff44",
    black: "#1a1a24", red: "#ff2a6d", green: "#39ff14", yellow: "#ffd700",
    blue: "#00ffff", magenta: "#ff00ff", cyan: "#00cccc", white: "#c0c5ce",
    brightBlack: "#4a4a5c", brightRed: "#ff5c8d", brightGreen: "#5fff44",
    brightYellow: "#ffe44d", brightBlue: "#66ffff", brightMagenta: "#ff66ff",
    brightCyan: "#33dddd", brightWhite: "#ffffff",
  };

  // Fit, then correct the column count against what was actually laid out.
  //
  // FitAddon is not trustworthy on its own here. It divides by a cached cell
  // width, so it can come out a column optimistic — and it always subtracts a
  // scrollbar this app never shows, costing two or three columns, which is a
  // lot when there are only forty. Measuring the rendered grid gives the true
  // cell width, and the column count follows from it exactly.
  //
  // .xterm-screen is the only honest thing to measure: the terminal's own root
  // element is width:100% and so always equals the host, fit or not.
  function refit() {
    if (!fit || !term || !host) return;
    try { fit.fit(); } catch { return; }
    const screen = host.querySelector(".xterm-screen");
    if (!screen || !term.cols) return;
    const cell = parseFloat(getComputedStyle(screen).width) / term.cols;
    if (!(cell > 0)) return;
    const cols = Math.max(20, Math.floor(host.clientWidth / cell));
    if (cols !== term.cols) term.resize(cols, term.rows);
  }

  // Data arriving is the signal that something is happening on the other end.
  // It replaces diffing successive captures: no polling, no protocol to speak,
  // and it is exactly as agent-agnostic — bytes are bytes.
  let quietUntil = 0;
  let lastPing = 0;
  function activity() {
    const t = performance.now();
    // Attaching repaints the whole screen, which is not news. Nor is every
    // frame of a spinner worth a state update.
    if (t < quietUntil || t - lastPing < 500) return;
    lastPing = t;
    onactivity?.();
  }

  function connect() {
    if (!term) return;
    state = "connecting";
    quietUntil = performance.now() + 1200;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    // A WebSocket cannot carry an Authorization header; the same-origin cookie
    // covers it, and the token is a fallback for a session that has not got one.
    const q = new URLSearchParams({
      session, cols: String(term.cols), rows: String(term.rows),
    });
    if (token) q.set("token", token);
    ws = new WebSocket(`${proto}://${location.host}/api/term?${q}`);

    ws.onopen = () => (state = "live");
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === "hist") {
        // The scrollback the session already had, so the pane opens where the
        // work is rather than blank until something new is printed.
        term.reset();
        term.write(m.d);
        term.scrollToBottom();
      } else if (m.t === "o") {
        term.write(m.d);
        activity();
      } else if (m.t === "end") {
        state = "closed";
      }
    };
    ws.onclose = () => (state = "closed");
    ws.onerror = () => (state = "closed");
  }

  function teardown() {
    try { ws?.close(); } catch { /* already gone */ }
    ws = undefined;
    try { term?.dispose(); } catch { /* already gone */ }
    term = undefined;
    fit = undefined;
  }

  // Build the terminal at a given font size.
  //
  // This recreates rather than assigning term.options.fontSize, because that
  // assignment changes the CSS font-size without remeasuring the character
  // cell: the glyphs grow, the grid does not, and the text spills past the
  // right edge — worse the larger the font. This is now the only thing that
  // reattaches; a plain resize no longer does.
  function boot(px) {
    teardown();
    term = new Terminal({
      theme, fontSize: px,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      cursorBlink: true, scrollback: 2000, allowProposedApi: true,
      macOptionIsMeta: true,
    });
    fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    refit();
    term.onData((d) => {
      if (ws?.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ t: "i", d }));
    });
    connect();
  }

  // ---- drag to scroll ----
  //
  // xterm's scrollable element is .xterm-viewport, but .xterm-screen is
  // positioned over it and paints on top, so a touch drag lands on the screen
  // and the viewport never scrolls. xterm 6's own touch handling is for
  // selection only. Native scrolling therefore does not happen by itself, and
  // this has to move the buffer directly.
  //
  // It is still far simpler than what it replaces: the scrollback is xterm's
  // own now, so a drag is a local call rather than keys sent to tmux and a
  // round trip. Nothing is sent to the far end at all.
  const SLOP = 12;          // px before a touch counts as a drag, so taps focus
  const FRICTION = 0.92;    // per-frame decay of a throw
  const THROW = 11;         // px of coast per px/ms of release speed

  let dragAt = 0, dragAcc = 0, dragging = false;
  let vel = 0, glide = 0, lastMoveAt = 0, raf = 0, lastFrame = 0;

  // Row height off the rendered grid, for the same reason refit() measures the
  // cell width there: it is the only honest source.
  function rowPx() {
    const screen = host?.querySelector(".xterm-screen");
    if (!screen || !term?.rows) return 16;
    const h = parseFloat(getComputedStyle(screen).height) / term.rows;
    return h > 0 ? h : 16;
  }

  function drain() {
    const px = rowPx();
    let lines = 0;
    while (dragAcc >= px) { lines--; dragAcc -= px; }   // drag down -> earlier
    while (dragAcc <= -px) { lines++; dragAcc += px; }
    if (lines) term?.scrollLines(lines);
  }

  function pump(ts) {
    const dt = lastFrame ? Math.min(ts - lastFrame, 50) : 16;
    lastFrame = ts;
    if (glide) {
      dragAcc += glide * (dt / 16);
      glide *= FRICTION;
      if (Math.abs(glide) < 0.4) glide = 0;
    }
    drain();
    if (!dragging && !glide) { raf = 0; dragAcc = 0; return; }
    raf = requestAnimationFrame(pump);
  }

  function startPump() {
    if (raf) return;
    lastFrame = 0;
    raf = requestAnimationFrame(pump);
  }

  function touchStart(e) {
    if (e.touches.length !== 1) return;
    dragAt = e.touches[0].clientY;
    lastMoveAt = e.timeStamp;
    dragAcc = 0; vel = 0; glide = 0; dragging = false;
  }

  function touchMove(e) {
    if (e.touches.length !== 1) return;
    const y = e.touches[0].clientY;
    const dy = y - dragAt;
    const dt = Math.max(e.timeStamp - lastMoveAt, 1);
    dragAt = y;
    lastMoveAt = e.timeStamp;
    dragAcc += dy;
    vel = vel * 0.7 + (dy / dt) * 0.3;
    if (!dragging && Math.abs(dragAcc) < SLOP) return;
    dragging = true;
    // Once this is a scroll it owns the gesture, or the rail underneath treats
    // the same drag as a swipe between screens.
    e.preventDefault();
    drain();
  }

  function touchEnd(e) {
    if (!dragging) return;
    dragging = false;
    // A lift after a pause is a stop, not a throw.
    if (e.timeStamp - lastMoveAt < 100) glide = vel * THROW;
    startPump();
  }

  function touchCancel() { dragging = false; glide = 0; dragAcc = 0; }

  // Reading fontPx first is deliberate: an early return above it would leave
  // the effect with no dependency on it, and font changes would never apply.
  //
  // Debounced because the size control cycles one click at a time, and each
  // rebuild costs a tmux client on the far end. Settle first.
  let bootTimer;
  $effect(() => {
    const px = fontPx;
    if (!host) return;
    clearTimeout(bootTimer);
    bootTimer = setTimeout(() => boot(px), 250);
    return () => clearTimeout(bootTimer);
  });

  onMount(() => {
    // A resize is a message, not a reconnect. Under the old pty the size was
    // fixed when `script` spawned it, so every geometry change had to drop the
    // connection and build a new one — including the soft keyboard opening,
    // which changes the viewport height at the exact moment you tap to type.
    // Control mode takes the new size as a request and keeps the session.
    let last = "";
    const ro = new ResizeObserver(() => {
      if (!term) return;
      refit();
      const now = `${term.cols}x${term.rows}`;
      if (last && now !== last && ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ t: "r", c: term.cols, r: term.rows }));
      }
      last = now;
    });
    ro.observe(host);

    // Attached by hand rather than with ontouchmove={...}: Svelte delegates
    // touch events to the root, and a delegated touchmove is passive there, so
    // preventDefault would be ignored and every scroll would also swipe the
    // rail to the next screen.
    host.addEventListener("touchstart", touchStart, { passive: true });
    host.addEventListener("touchmove", touchMove, { passive: false });
    host.addEventListener("touchend", touchEnd, { passive: true });
    host.addEventListener("touchcancel", touchCancel, { passive: true });

    return () => {
      host.removeEventListener("touchstart", touchStart);
      host.removeEventListener("touchmove", touchMove);
      host.removeEventListener("touchend", touchEnd);
      host.removeEventListener("touchcancel", touchCancel);
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      ro.disconnect();
      teardown();
    };
  });
</script>

<div class="wrap" class:sweeping={alive} class:busy>
  <div class="host" bind:this={host}></div>
  {#if state !== "live"}
    <div class="state">
      {state === "connecting" ? "connecting…" : "disconnected"}
      {#if state === "closed"}
        <button class="sm" onclick={connect}>reconnect</button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .wrap {
    position: relative; flex: 1; min-height: 0;
    border: 1px solid var(--card-line); border-radius: var(--radius);
    background: var(--card); padding: .35rem .3rem; overflow: hidden;
  }

  /* The border sweeps whenever you are actually looking at a live session —
     slow when quiet, faster when output is moving. Cyan-to-magenta in both
     states: an earlier version dropped the magenta when idle, and losing the
     colour reads as the animation having stopped even though it is still
     turning.

     --card is the same value the terminal paints its own background with, so
     the padding-box fill meets the glyphs with no seam. */
  .wrap.sweeping {
    border-color: transparent;
    background:
      linear-gradient(var(--card), var(--card)) padding-box,
      conic-gradient(from var(--angle), var(--ok), var(--magenta), var(--ok)) border-box;
    animation: sweep 6s linear infinite;
  }
  .wrap.sweeping.busy { animation-duration: 2.2s; }

  @media (prefers-reduced-motion: reduce) {
    .wrap.sweeping, .wrap.sweeping.busy { animation: none; --angle: 45deg; }
  }
  /* Vertical drags belong to us — .xterm-screen covers the scrollable viewport,
     so the browser cannot scroll it and we move the buffer ourselves. The
     browser keeps horizontal, or swiping between screens would stop working
     over a terminal, and keeps pinch so the text can still be zoomed. */
  .host { width: 100%; height: 100%; touch-action: pan-x pinch-zoom; }
  /* The columns are computed against the full host width, so nothing may
     overlay the right edge. Scrolling is by touch and wheel, not by grabbing a
     2px bar on a phone. */
  .host :global(.xterm-viewport) { scrollbar-width: none; }
  .host :global(.xterm-viewport::-webkit-scrollbar) { width: 0; height: 0; }
  .state {
    position: absolute; inset: auto .5rem .5rem auto;
    display: flex; align-items: center; gap: .4rem;
    font-size: 11px; color: var(--dim);
    background: color-mix(in srgb, var(--bg) 85%, transparent);
    border: 1px solid var(--card-line); border-radius: 8px; padding: .25rem .5rem;
  }
</style>
