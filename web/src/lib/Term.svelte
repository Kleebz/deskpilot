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
    ws.binaryType = "arraybuffer";

    ws.onopen = () => (state = "live");
    ws.onmessage = (e) => {
      term.write(typeof e.data === "string" ? e.data : new Uint8Array(e.data));
      activity();
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
  // right edge — worse the larger the font. Rebuilding is no more expensive
  // than the alternative, since any size change already forces a reconnect.
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
    term.onData((d) => ws?.readyState === WebSocket.OPEN && ws.send(d));
    connect();
  }

  // ---- drag to scroll ----
  //
  // A TUI holds the alternate screen, which has no scrollback, so there is
  // nothing for xterm's viewport to scroll and a drag does nothing at all.
  // Scrolling is the application's own, and it only learns about it as a key.
  //
  // It has to be PageUp/PageDown specifically. Mouse reporting is not enabled
  // by the agent — verified by sending both SGR (`ESC [ < 64 ; x ; y M`) and
  // legacy X10 wheel events to a live session, neither of which moved it by a
  // pixel. Arrow keys are worse than useless: Up recalls the previous prompt.
  const PAGEUP = "\x1b[5~";
  const PAGEDOWN = "\x1b[6~";

  // Pixels of drag per page. A page is roughly 25 lines — measured, by diffing
  // the pane before and after a single PageUp — and there is nothing finer to
  // send, so this cannot be made continuous, only well paced. Shorter than the
  // first attempt at 90, which needed most of the screen to move one page.
  const PER_PAGE = 55;

  // At most one page per touchmove, with the remainder carried in the
  // accumulator and spent on later events. Firing the whole backlog at once is
  // what made a quick flick feel like a teleport rather than a scroll.
  const MAX_BACKLOG = PER_PAGE * 4;
  // Slack before a touch counts as a drag rather than a tap, so tapping to
  // focus the keyboard still works.
  const SLOP = 12;

  let dragAt = 0, dragAcc = 0, dragging = false;

  const sendKey = (k) => ws?.readyState === WebSocket.OPEN && ws.send(k);

  function touchStart(e) {
    if (e.touches.length !== 1) return;
    dragAt = e.touches[0].clientY;
    dragAcc = 0;
    dragging = false;
  }

  function touchMove(e) {
    if (e.touches.length !== 1) return;
    const y = e.touches[0].clientY;
    dragAcc += y - dragAt;
    dragAt = y;
    if (!dragging && Math.abs(dragAcc) < SLOP) return;
    dragging = true;
    // Once this is a scroll it owns the gesture: without preventDefault the
    // rail underneath treats the same drag as a swipe between workspaces.
    e.preventDefault();
    // Dragging down reveals what came before, which is PageUp — the direction
    // a touch surface has trained everyone to expect.
    dragAcc = Math.max(-MAX_BACKLOG, Math.min(MAX_BACKLOG, dragAcc));
    if (dragAcc >= PER_PAGE) { sendKey(PAGEUP); dragAcc -= PER_PAGE; }
    else if (dragAcc <= -PER_PAGE) { sendKey(PAGEDOWN); dragAcc += PER_PAGE; }
  }

  // Reading fontPx first is deliberate: an early return above it would leave
  // the effect with no dependency on it, and font changes would never apply.
  //
  // Debounced because the size control cycles 10→14 one click at a time, and
  // each rebuild costs a PTY and a tmux client on the far end. Settle first.
  let bootTimer;
  $effect(() => {
    const px = fontPx;
    if (!host) return;
    clearTimeout(bootTimer);
    bootTimer = setTimeout(() => boot(px), 250);
    return () => clearTimeout(bootTimer);
  });

  onMount(() => {
    // Resizing has to reconnect: the PTY size is fixed when `script` spawns it,
    // so there is nothing to signal. Orientation changes are rare enough that a
    // reconnect is cheaper than plumbing a resize protocol.
    let last = "";
    const ro = new ResizeObserver(() => {
      if (!term) return;
      refit();
      const now = `${term.cols}x${term.rows}`;
      if (last && now !== last) {
        try { ws?.close(); } catch { /* already gone */ }
        connect();
      }
      last = now;
    });
    ro.observe(host);

    // Attached by hand rather than with ontouchmove={...}: Svelte delegates
    // touch events to the root, and a delegated touchmove is passive there, so
    // preventDefault would be ignored and every scroll would also swipe the
    // rail to the next workspace.
    host.addEventListener("touchstart", touchStart, { passive: true });
    host.addEventListener("touchmove", touchMove, { passive: false });

    return () => {
      host.removeEventListener("touchstart", touchStart);
      host.removeEventListener("touchmove", touchMove);
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
  /* Vertical drags belong to us — they page the agent's own scrollback. The
     browser keeps horizontal, or swiping between workspaces would stop working
     over a terminal, and keeps pinch so the text can still be zoomed. */
  .host { width: 100%; height: 100%; touch-action: pan-x pinch-zoom; }
  /* The columns above are computed against the full host width, so nothing may
     overlay the right edge. tmux owns scrollback anyway — a TUI on the
     alternate screen has none of its own to scroll. */
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
