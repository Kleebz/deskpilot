<script>
  import { onMount } from "svelte";
  import { Terminal } from "@xterm/xterm";
  import { FitAddon } from "@xterm/addon-fit";
  import "@xterm/xterm/css/xterm.css";
  import { token } from "./api.js";

  let { session, fontPx = 12, onstatus } = $props();

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

  function connect() {
    if (!term) return;
    state = "connecting";
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
    };
    ws.onclose = () => (state = "closed");
    ws.onerror = () => (state = "closed");
  }

  onMount(() => {
    term = new Terminal({
      theme, fontSize: fontPx, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      cursorBlink: true, scrollback: 2000, allowProposedApi: true,
      // A phone has no scrollbar to grab and tmux owns its own scrollback,
      // so let touch scrolling reach the browser rather than the terminal.
      macOptionIsMeta: true,
    });
    fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();
    term.onData((d) => ws?.readyState === WebSocket.OPEN && ws.send(d));
    connect();

    // Resizing has to reconnect: the PTY size is fixed when `script` spawns it,
    // so there is nothing to signal. Orientation changes are rare enough that a
    // reconnect is cheaper than plumbing a resize protocol.
    let last = `${term.cols}x${term.rows}`;
    const ro = new ResizeObserver(() => {
      fit.fit();
      const now = `${term.cols}x${term.rows}`;
      if (now !== last) {
        last = now;
        try { ws?.close(); } catch { /* already gone */ }
        connect();
      }
    });
    ro.observe(host);

    return () => {
      ro.disconnect();
      try { ws?.close(); } catch { /* already gone */ }
      term.dispose();
    };
  });

  // Font size is a control in the pane bar; applying it needs a refit and,
  // because the geometry changed, a reconnect.
  $effect(() => {
    if (!term) return;
    term.options.fontSize = fontPx;
    fit?.fit();
  });
</script>

<div class="wrap">
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
    background: #12141e; padding: .4rem; overflow: hidden;
  }
  .host { width: 100%; height: 100%; }
  .state {
    position: absolute; inset: auto .5rem .5rem auto;
    display: flex; align-items: center; gap: .4rem;
    font-size: 11px; color: var(--dim);
    background: color-mix(in srgb, var(--bg) 85%, transparent);
    border: 1px solid var(--card-line); border-radius: 8px; padding: .25rem .5rem;
  }
</style>
