<script>
  import { api, post, waitFor } from "./api.js";
  import WindowRow from "./WindowRow.svelte";
  import NewSession from "./NewSession.svelte";
  import { vis } from "./visible.svelte.js";

  let { ws, session, windows, orphans, allNames, workspaces, active, onstatus, onchanged } = $props();

  // Pane-local state. This is the reason for the framework: a poll updates
  // `session`/`windows` from the parent without touching any of these, so the
  // transcript keeps its scroll position, half-typed prompts survive, and a
  // screenshot you are looking at stays on screen.
  let output = $state("");
  let input = $state("");
  let pre = $state(null);
  let pinned = $state(true);     // stick to the bottom unless the user scrolls up
  let showWindows = $state(false);
  let showKeys = $state(false);
  let creating = $state(false);

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

  // Only the visible pane polls, and only while the page is actually on screen.
  // Ten panes each refetching would be pure waste; polling a backgrounded tab
  // is worse than waste on cellular.
  $effect(() => {
    if (!active || !session || !vis.visible) return;
    void vis.wokeAt;
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  });

  function onScroll() {
    if (!pre) return;
    pinned = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 40;
  }

  function toBottom() {
    pinned = true;
    pre?.scrollTo(0, pre.scrollHeight);
  }

  async function send(ev) {
    ev.preventDefault();
    const text = input.trim();
    if (!text || !session) return;
    input = "";
    pinned = true;
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

  const KEYS = [
    ["↑", "Up"], ["↓", "Down"], ["←", "Left"], ["→", "Right"],
    ["⏎", "Enter"], ["esc", "Escape"], ["tab", "Tab"], ["^C", "C-c"],
  ];
</script>

<section class:composing={!!session}>
  {#if session}
    <!-- Transcript is the hero: it fills the pane, the composer pins to the
         bottom, and everything secondary hides behind a toggle. -->
    <div class="bar">
      <span class="badge">ws{ws}</span>
      <span class="name">{session.session}</span>
      <button class="sm ghost" onclick={() => (showWindows = !showWindows)}>
        {windows.length} win
      </button>
    </div>

    {#if showWindows}
      <div class="drawer">
        {#each windows as w (w.address)}
          <WindowRow win={w} {workspaces} {onstatus} {onchanged} />
        {:else}
          <div class="why">No windows on this screen.</div>
        {/each}
      </div>
    {/if}

    <pre bind:this={pre} onscroll={onScroll}>{output || "…"}</pre>

    {#if !pinned}
      <button class="sm jump" onclick={toBottom}>↓ latest</button>
    {/if}

    <div class="composer">
      <form onsubmit={send}>
        <input
          bind:value={input}
          placeholder="prompt {session.session}"
          autocomplete="off" autocapitalize="off" autocorrect="off" />
        <button class="ghost" type="button" onclick={() => (showKeys = !showKeys)}>⌨</button>
        <button>send</button>
      </form>
      {#if showKeys}
        <div class="keys">
          {#each KEYS as [label, k]}
            <button onclick={() => key(k)}>{label}</button>
          {/each}
        </div>
      {/if}
    </div>
  {:else}
    <div class="scroll">
      <h2 class="first">screen {ws}</h2>
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
          window — see the <b>sessions</b> index at the far left to open or kill them.
        </div>
      {/if}

      {#if creating}
        <NewSession
          {ws}
          taken={allNames}
          {onstatus}
          onchanged={() => { creating = false; onchanged(); }}
          oncancel={() => (creating = false)} />
      {:else}
        <button onclick={() => (creating = true)}>start a session here</button>
      {/if}

      <h2>windows{windows.length ? "" : " · none"}</h2>
      {#each windows as w (w.address)}
        <WindowRow win={w} {workspaces} {onstatus} {onchanged} />
      {/each}
    </div>
  {/if}
</section>

<style>
  /* min-width:0 is load-bearing. Flex items default to min-width:auto, which
     refuses to shrink below content size — a pane then inflates past the
     viewport to fit its widest row and the whole rail goes wonky. */
  section {
    flex: 0 0 100%; width: 100%; max-width: 100%;
    min-width: 0; min-height: 0;
    scroll-snap-align: start;
    display: flex; flex-direction: column;
  }
  /* With a session the pane does not scroll — the transcript does. */
  section.composing { padding: .6rem; gap: .5rem; overflow: hidden; }
  .scroll {
    display: flex; flex-direction: column; gap: .55rem;
    padding: .7rem; overflow-y: auto; min-width: 0;
  }

  .bar { display: flex; align-items: center; gap: .4rem; min-width: 0; }
  .name {
    flex: 1; min-width: 0; font-size: 1.05rem; font-weight: 600; color: var(--ok);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .name.none { font-size: .95rem; font-weight: 400; color: var(--dim); }
  .badge {
    font-size: .6rem; letter-spacing: .08em; text-transform: uppercase;
    color: var(--bg); background: var(--ok); border-radius: 4px; padding: .1rem .3rem;
  }
  .ghost { border-color: transparent; color: var(--dim); }

  .drawer {
    display: flex; flex-direction: column; gap: .4rem; min-width: 0;
    max-height: 40vh; overflow-y: auto;
    border: 1px solid var(--line); border-radius: 8px; padding: .4rem;
  }

  pre {
    flex: 1; min-height: 0; margin: 0; overflow: auto;
    white-space: pre-wrap; word-break: break-word;
    font-size: 12px; line-height: 1.5; padding: .6rem;
    border: 1px solid var(--line); border-radius: 8px; background: var(--panel);
  }
  .jump { position: absolute; align-self: center; margin-top: -2.4rem; opacity: .9; }

  .composer { display: flex; flex-direction: column; gap: .4rem; min-width: 0; }
  form { display: flex; gap: .4rem; min-width: 0; }
  form input { flex: 1; min-width: 0; }
  .keys { display: flex; gap: .3rem; flex-wrap: wrap; }
  .keys button { font-size: 13px; padding: .35rem .5rem; min-width: 2.2rem; }

  h2 {
    margin: 0; font-size: .72rem; letter-spacing: .09em; text-transform: uppercase;
    color: var(--dim); border-top: 1px solid var(--line); padding-top: .5rem;
  }
  h2.first { border-top: 0; padding-top: 0; }
  .why {
    font-size: 11.5px; color: var(--dim); line-height: 1.5; min-width: 0;
    border-left: 2px solid var(--line); padding-left: .5rem;
    overflow-wrap: anywhere;
  }
  .win {
    display: flex; gap: .35rem; align-items: center; min-width: 0;
    border: 1px solid var(--line); border-radius: 8px; padding: .4rem .5rem;
  }
  .t {
    flex: 1; min-width: 0; font-size: 12px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
</style>
