<script>
  import { api, post, waitFor } from "./api.js";
  import WindowRow from "./WindowRow.svelte";

  let { ws, session, windows, orphans, workspaces, active, onstatus, onchanged } = $props();

  // Pane-local state. This is the reason for the framework: a poll updates
  // `session`/`windows` from the parent without touching any of these, so the
  // output keeps its scroll position, half-typed prompts survive, and a
  // screenshot you are looking at stays on screen.
  let output = $state("");
  let input = $state("");
  let starting = $state(false);
  let pre = $state(null);
  let pinned = $state(true);   // stick to the bottom unless the user scrolls up

  const hasAgentWindow = $derived(windows.some((w) => /✳|✻/.test(w.title)));

  async function load() {
    if (!session) return;
    try {
      const r = await api(
        `/capture?session=${encodeURIComponent(session.session)}&lines=200`,
      );
      const wasPinned = pinned;
      output = r.text.trimEnd();
      if (wasPinned) queueMicrotask(() => pre?.scrollTo(0, pre.scrollHeight));
    } catch (e) {
      onstatus(e.message, true);
    }
  }

  // Only the visible pane polls. Ten panes each refetching would be pure waste,
  // and on cellular it would be rude.
  $effect(() => {
    if (!active || !session) return;
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  });

  function onScroll() {
    if (!pre) return;
    pinned = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 40;
  }

  async function send(ev) {
    ev.preventDefault();
    const text = input.trim();
    if (!text || !session) return;
    input = "";
    try {
      await post("/send", { session: session.session, text });
      onstatus(`→ ${session.session}`);
      setTimeout(load, 600);
    } catch (e) { onstatus(e.message, true); input = text; }
  }

  async function key(k) {
    if (!session) return;
    try {
      await post("/send", { session: session.session, keys: [k] });
      setTimeout(load, 400);
    } catch (e) { onstatus(e.message, true); }
  }

  async function start() {
    const suggested = suggestName();
    const name = prompt(
      "Name this session — what it is, not where it sits. Windows move.",
      suggested,
    );
    if (!name) return;
    starting = true;
    try {
      await post("/sessions", { name, workspace: ws, command: "bash" });
      await waitFor(async () => {
        const list = await api("/sessions");
        return list.some((s) => s.session === name && s.workspace === ws);
      });
      onstatus(`started ${name} on screen ${ws}`);
      onchanged();
    } catch (e) { onstatus(e.message, true); }
    finally { starting = false; }
  }

  function suggestName() {
    const taken = new Set(orphans.map((o) => o.session));
    for (let i = 1; i < 100; i++) if (!taken.has(`s${i}`)) return `s${i}`;
    return "s";
  }

  async function adopt(name) {
    try {
      await post("/sessions/attach", { session: name, workspace: ws });
      onstatus(`opening ${name}…`);
      await waitFor(async () => {
        const list = await api("/sessions");
        return list.some((s) => s.session === name && s.workspace === ws);
      });
      onchanged();
    } catch (e) { onstatus(e.message, true); }
  }

  async function kill(name) {
    if (!confirm(`Kill session "${name}"? Anything running in it is lost.`)) return;
    try { await post("/sessions/kill", { session: name }); onstatus(`killed ${name}`); onchanged(); }
    catch (e) { onstatus(e.message, true); }
  }

  const KEYS = [
    ["↑", "Up"], ["↓", "Down"], ["←", "Left"], ["→", "Right"],
    ["⏎", "Enter"], ["esc", "Escape"], ["tab", "Tab"], ["^C", "C-c"],
  ];
</script>

<section>
  <h2 class="first">screen {ws}</h2>

  {#if session}
    <div class="name"><span class="badge">ws{ws}</span>{session.session}</div>

    <pre bind:this={pre} onscroll={onScroll}>{output || "…"}</pre>

    {#if !pinned}
      <button class="sm jump" onclick={() => { pinned = true; pre?.scrollTo(0, pre.scrollHeight); }}>
        ↓ jump to latest
      </button>
    {/if}

    <form onsubmit={send}>
      <input
        bind:value={input}
        placeholder="prompt {session.session}"
        autocomplete="off" autocapitalize="off" autocorrect="off" />
      <button>send</button>
    </form>

    <div class="keys">
      {#each KEYS as [label, k]}
        <button onclick={() => key(k)}>{label}</button>
      {/each}
    </div>
  {:else}
    <div class="name none">no session on this screen</div>

    {#if hasAgentWindow}
      <div class="why">
        There is an agent running here, but it was started outside tmux so there is no
        handle to type into. You can still move, tile and <b>look</b> at its window
        below. Restart it with the wrapper to make it promptable.
      </div>
    {/if}

    {#if orphans.length}
      <div class="why">
        {orphans.length} session{orphans.length > 1 ? "s are" : " is"} running with no
        window. Closing a terminal detaches a session rather than killing it — that is
        what keeps work alive when your phone drops.
      </div>
      {#each orphans as o (o.session)}
        <div class="win">
          <span class="t">{o.session} <span class="dim">{o.path}</span></span>
          <button class="sm" onclick={() => adopt(o.session)}>open here</button>
          <button class="sm" onclick={() => kill(o.session)}>kill</button>
        </div>
      {/each}
    {/if}

    <button disabled={starting} onclick={start}>
      {starting ? "starting…" : "start a session here"}
    </button>
  {/if}

  <h2>windows{windows.length ? "" : " · none"}</h2>
  {#each windows as w (w.address)}
    <WindowRow win={w} {workspaces} {onstatus} {onchanged} />
  {/each}
</section>

<style>
  section {
    flex: 0 0 100%; scroll-snap-align: start;
    display: flex; flex-direction: column; gap: .55rem;
    padding: .7rem; overflow-y: auto;
  }
  h2 {
    margin: 0; font-size: .72rem; letter-spacing: .09em; text-transform: uppercase;
    color: var(--dim); border-top: 1px solid var(--line); padding-top: .5rem;
  }
  h2.first { border-top: 0; padding-top: 0; }
  .name {
    font-size: 1.15rem; font-weight: 600; color: var(--ok);
    display: flex; align-items: center; gap: .4rem; word-break: break-all;
  }
  .name.none { font-size: .95rem; font-weight: 400; color: var(--dim); }
  .badge {
    font-size: .6rem; font-weight: 400; letter-spacing: .08em; text-transform: uppercase;
    color: var(--bg); background: var(--ok); border-radius: 4px; padding: .1rem .3rem;
  }
  .why {
    font-size: 11.5px; color: var(--dim); line-height: 1.5;
    border-left: 2px solid var(--line); padding-left: .5rem;
  }
  pre {
    margin: 0; min-height: 9rem; max-height: 46vh; overflow: auto;
    white-space: pre-wrap; word-break: break-word; font-size: 11.5px;
    padding: .5rem; border: 1px solid var(--line); border-radius: 8px;
    background: var(--panel);
  }
  .jump { align-self: flex-start; }
  form { display: flex; gap: .4rem; }
  form input { flex: 1; min-width: 0; }
  .keys { display: flex; gap: .3rem; flex-wrap: wrap; }
  .keys button { font-size: 13px; padding: .35rem .5rem; min-width: 2.2rem; }
  .win {
    display: flex; gap: .35rem; align-items: center;
    border: 1px solid var(--line); border-radius: 8px; padding: .4rem .5rem;
  }
  .t {
    flex: 1; min-width: 0; font-size: 12px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
</style>
