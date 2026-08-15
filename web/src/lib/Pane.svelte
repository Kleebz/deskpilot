<script>
  import { post } from "./api.js";
  import WindowRow from "./WindowRow.svelte";
  import NewSession from "./NewSession.svelte";
  import Term from "./Term.svelte";
  import { vis } from "./visible.svelte.js";

  let { ws, session, windows, orphans, allNames, workspaces, active, onstatus, onchanged } = $props();

  // Pane-local state. This is the reason for the framework: a poll updates
  // `session`/`windows` from the parent without touching any of these, so a
  // half-typed prompt survives and the drawer you opened stays open.
  let input = $state("");
  let lastChange = $state(0);    // when output last moved
  let showWindows = $state(false);
  let showKeys = $state(false);

  // Two sizes, not a range. The useful choice on a phone is "as much of the
  // session as fits" against "readable without squinting"; the steps between
  // only trade columns for nothing. 10px gives ~59 columns at 390px, 14px ~42.
  const savedBig = localStorage.getItem("dp_big");
  let big = $state(
    savedBig !== null ? savedBig === "1" : Number(localStorage.getItem("dp_font")) >= 13,
  );
  const fontPx = $derived(big ? 14 : 10);
  $effect(() => localStorage.setItem("dp_big", big ? "1" : "0"));

  let creating = $state(false);

  const hasAgentWindow = $derived(windows.some((w) => /✳|✻/.test(w.title)));

  // The window hosting this session is not a separate thing to manage, so it
  // is tagged and excluded from the count. Otherwise one session in one
  // terminal plus one other window reads as three.
  const ownWindows = $derived(new Set(session?.windows ?? []));
  const otherCount = $derived(windows.filter((w) => !ownWindows.has(w.address)).length);

  // Ticks so `working` decays on its own. Deliberately NOT gated on page
  // visibility: if the clock stops while hidden, `working` can never expire and
  // the pane comes back claiming to be busy forever. Browsers throttle timers
  // in background tabs anyway, which is the correct amount of saving here.
  let now = $state(Date.now());
  $effect(() => {
    if (!active || !session) return;
    const id = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(id);
  });
  const working = $derived(lastChange > 0 && now - lastChange < 6000);

  // The border sweeps whenever you are actually looking at a session — slow and
  // cyan when quiet, faster and shot through with magenta when output is
  // moving. Idle-but-present should still feel alive; it just should not shout.
  // Gated on visibility so a backgrounded tab is not animating for nobody.
  const alive = $derived(!!session && active && vis.visible);

  // The terminal tells us when bytes arrive, which is what "busy" means. This
  // used to be a 3-second capture poll per visible pane, diffing the text to
  // infer the same thing; attaching a PTY makes that redundant.
  const activity = () => (lastChange = Date.now());

  async function send(ev) {
    ev.preventDefault();
    const text = input.trim();
    if (!text || !session) return;
    input = "";
    // Acknowledge the tap straight away, rather than waiting for the echo to
    // come back down the socket.
    lastChange = Date.now();
    try {
      await post("/send", { session: session.session, text });
      onstatus(`→ ${session.session}`);
    } catch (e) { onstatus(e.message, true); input = text; }
  }

  async function key(k) {
    if (!session) return;
    try {
      await post("/send", { session: session.session, keys: [k] });
    } catch (e) { onstatus(e.message, true); }
  }

  // Advice for a shell is wrong advice for an agent, so the hints follow
  // pane_current_command rather than assuming Claude is on the other end.
  const AGENT_HINTS = [
    "does the app on screen {ws} look right?",
    "what changed in the last commit?",
    "run the tests and summarise failures",
    "take a look at the browser window and describe it",
  ];
  const SHELL_HINTS = [
    "git status",
    "npm run build",
    "tail -f the log",
    "df -h",
  ];
  const isAgent = $derived(!/^(bash|zsh|fish|sh)$/.test(session?.command ?? ""));
  const hints = $derived((isAgent ? AGENT_HINTS : SHELL_HINTS)
    .map((h) => h.replace("{ws}", String(ws))));

  // Rotate only while the field is empty and the pane is on screen, so it never
  // shifts under someone mid-thought.
  let hintIdx = $state(0);
  $effect(() => {
    if (!active || !session || input || !vis.visible) return;
    const id = setInterval(() => (hintIdx = (hintIdx + 1) % hints.length), 6000);
    return () => clearInterval(id);
  });

  // PageUp/PageDown are the only way to see earlier output on a phone. A TUI
  // holds the alternate screen, which has no scrollback for the browser to
  // scroll and none that tmux records either — scrolling is the application's
  // job, and it only ever hears about it as a keypress. tmux `mouse on` covers
  // a wheel at the desk, but touch produces no wheel event.
  // Scroll keys lead: the row scrolls horizontally, so anything past the first
  // few is off-screen on a narrow phone, and these are the ones reached by
  // reflex while reading.
  const KEYS = [
    ["⇞", "PageUp"], ["⇟", "PageDown"],
    ["↑", "Up"], ["↓", "Down"], ["←", "Left"], ["→", "Right"],
    ["⏎", "Enter"], ["esc", "Escape"], ["tab", "Tab"], ["⇧tab", "BTab"],
    ["^C", "C-c"],
  ];
</script>

<section class:composing={!!session}>
  {#if session}
    <!-- Transcript is the hero: it fills the pane, the composer pins to the
         bottom, and everything secondary hides behind a toggle. -->
    <div class="bar">
      <span class="badge">ws{ws}</span>
      <span class="name">{session.session}</span>
      {#if working}<span class="pulse" title="output changing"></span>{/if}
      <button class="sm ghost" class:on={big} title="text size"
              onclick={() => (big = !big)}>{big ? "large" : "normal"}</button>
      <button class="sm ghost" onclick={() => (showWindows = !showWindows)}>
        {otherCount} other
      </button>
    </div>

    {#if showWindows}
      <div class="drawer">
        {#each windows as w (w.address)}
          <WindowRow win={w} {workspaces} {onstatus} {onchanged} self={ownWindows.has(w.address)} />
        {:else}
          <div class="why">No windows on this screen.</div>
        {/each}
      </div>
    {/if}

    <!-- Only the pane you are on holds a terminal. Each one costs a PTY and a
         tmux client, so mounting all ten would open ten of each to render nine
         screens nobody is looking at. Swiping back re-attaches and tmux
         repaints immediately. -->
    {#if active}
      <Term session={session.session} {fontPx} {alive} busy={working} onactivity={activity} />
    {:else}
      <div class="idle"></div>
    {/if}

    <div class="composer">
      <form onsubmit={send}>
        <input
          bind:value={input}
          placeholder={hints[hintIdx % hints.length]}
          autocomplete="off" autocapitalize="off" autocorrect="off" />
        <button class="sm ghost keytoggle" class:on={showKeys} type="button"
                aria-label="keys" onclick={() => (showKeys = !showKeys)}>⌨</button>
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
    /* `always` makes momentum stop at the next pane instead of flying past
       several. Without it a slightly-too-hard swipe overshoots and the rail
       feels loose. */
    scroll-snap-stop: always;
    display: flex; flex-direction: column;
  }
  /* With a session the pane does not scroll — the transcript does. */
  @media (max-height: 480px) {
    /* Reclaim vertical space for the transcript: tighter padding, and the
       title bar loses its own line by sitting inline. */
    section.composing { padding: .35rem .5rem; gap: .3rem; }
    .bar { font-size: .9rem; }
    .name { font-size: .95rem; }
    .keys button { min-height: 38px; }
    form input, form button { min-height: 38px; }
  }
  section.composing {
    padding: .6rem; gap: .5rem; overflow: hidden;
    /* the composer is the lowest thing on screen — keep it clear of the
       gesture bar */
    padding-bottom: calc(.6rem + env(safe-area-inset-bottom, 0px));
  }
  .scroll {
    display: flex; flex-direction: column; gap: .55rem;
    padding: .7rem; padding-bottom: calc(.7rem + env(safe-area-inset-bottom, 0px));
    overflow-y: auto; min-width: 0;
  }

  .bar { display: flex; align-items: center; gap: .4rem; min-width: 0; }
  .name {
    flex: 1; min-width: 0; font-size: 1.05rem; font-weight: 600; color: var(--ok);
    text-shadow: 0 0 18px color-mix(in srgb, var(--ok) 30%, transparent);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .name.none { font-size: .95rem; font-weight: 400; color: var(--dim); }
  .badge {
    font-size: .6rem; letter-spacing: .08em; text-transform: uppercase; flex: none;
    color: var(--bg); background: var(--ok); border-radius: 4px; padding: .1rem .3rem;
    box-shadow: 0 0 12px -2px color-mix(in srgb, var(--ok) 55%, transparent);
  }
  .ghost { border-color: transparent; color: var(--dim); }
  .ghost.on { color: var(--ok); }
  .keytoggle { min-width: 44px; font-size: 16px; }
  .keytoggle.on { color: var(--ok); background: color-mix(in srgb, var(--ok) 10%, transparent); }
  .pulse {
    width: 7px; height: 7px; border-radius: 50%; flex: none;
    background: var(--ok);
    box-shadow: 0 0 10px color-mix(in srgb, var(--ok) 80%, transparent);
    animation: breathe 1.2s ease-in-out infinite;
  }
  @keyframes breathe { 0%,100% { opacity: .25 } 50% { opacity: 1 } }
  @media (prefers-reduced-motion: reduce) { .pulse { animation: none; opacity: .8 } }

  .drawer {
    display: flex; flex-direction: column; gap: .4rem; min-width: 0;
    max-height: 40vh; overflow-y: auto;
    border: 1px solid var(--card-line); border-radius: var(--radius);
    padding: .4rem; background: var(--panel);
  }

  /* Holds the terminal's place on panes that are off screen, so a swipe does
     not reveal a collapsed layout mid-flight. */
  .idle {
    flex: 1; min-height: 0;
    border: 1px solid var(--card-line); border-radius: var(--radius);
    background: var(--card);
  }

  .composer { display: flex; flex-direction: column; gap: .4rem; min-width: 0; }
  form { display: flex; gap: .4rem; min-width: 0; }
  form input { flex: 1; min-width: 0; }
  /* A 4x2 grid of full-width buttons read as a keypad and ate ~110px. A single
     scrolling row keeps the 44px touch target but reads as a toolbar. */
  .keys {
    display: flex; gap: .35rem; overflow-x: auto;
    scrollbar-width: none; padding-bottom: .1rem;
    /* the fade is the only cue that this row scrolls */
    mask-image: linear-gradient(to right, #000 calc(100% - 24px), transparent);
  }
  .keys::-webkit-scrollbar { display: none; }
  .keys button {
    flex: 0 0 auto; min-width: 3rem; font-size: 14px; padding: .3rem .5rem;
    background: var(--card);
  }

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
</style>
