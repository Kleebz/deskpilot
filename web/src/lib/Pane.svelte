<script>
  import { api, post, waitFor } from "./api.js";
  import WindowRow from "./WindowRow.svelte";
  import NewSession from "./NewSession.svelte";
  import Term from "./Term.svelte";
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
  let lastChange = $state(0);    // when the transcript last differed
  let sent = $state("");         // echoed locally until the capture catches up
  let showWindows = $state(false);
  let showKeys = $state(false);

  // Prose reflows fine at any width. Aligned output — code, diffs, ls, tables —
  // does not: re-wrapping at 51 columns destroys the columns that carry the
  // meaning. So wrapping is a choice, not a setting to get right once.
  // Persisted, because it is a preference about how you read, not per-session.
  let wrap = $state(localStorage.getItem("dp_wrap") !== "0");
  let fontPx = $state(Number(localStorage.getItem("dp_font")) || 12);
  $effect(() => localStorage.setItem("dp_wrap", wrap ? "1" : "0"));
  $effect(() => localStorage.setItem("dp_font", String(fontPx)));
  const cycleFont = () => (fontPx = fontPx >= 14 ? 10 : fontPx + 1);

  // Two ways to read a session, kept side by side deliberately so the choice
  // can be reversed. `text` scrapes capture-pane and re-flows it — cheap, and
  // prose reads well. `term` attaches a real PTY at this screen's size, so the
  // program lays out for the phone instead of being re-flowed after the fact.
  let mode = $state(localStorage.getItem("dp_mode") || "text");
  $effect(() => localStorage.setItem("dp_mode", mode));
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

  async function load() {
    if (!session) return;
    try {
      const r = await api(
        `/capture?session=${encodeURIComponent(session.session)}&lines=200`,
      );
      const wasPinned = pinned;
      // Comparing captures is the only agent-agnostic way to know something is
      // happening — no spinner to parse, no protocol to speak.
      if (r.text !== output) lastChange = Date.now();
      output = r.text.trimEnd();
      if (sent && output.includes(sent)) sent = "";   // the real transcript has it now
      if (wasPinned) queueMicrotask(() => pre?.scrollTo(0, pre.scrollHeight));
    } catch (e) {
      onstatus(e.message, true);
    }
  }

  // Only the visible pane polls, and only while the page is actually on screen.
  // Ten panes each refetching would be pure waste; polling a backgrounded tab
  // is worse than waste on cellular.
  $effect(() => {
    if (!active || !session) return;
    void vis.wokeAt;
    load();                       // once regardless, same reason as App
    if (!vis.visible) return;
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  });

  // Shrinking the container leaves scrollTop where it was, which is no longer
  // the bottom — so a keyboard opening scrolls the latest output out of view.
  $effect(() => {
    void vis.resizedAt;
    if (pinned) queueMicrotask(() => pre?.scrollTo(0, pre.scrollHeight));
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
    // Acknowledge the tap straight away. Waiting for the next poll to notice a
    // change leaves a gap where nothing confirms the prompt landed.
    lastChange = Date.now();
    sent = text;
    try {
      await post("/send", { session: session.session, text });
      onstatus(`→ ${session.session}`);
      setTimeout(load, 600);
    } catch (e) { onstatus(e.message, true); input = text; sent = ""; }
  }

  async function key(k) {
    if (!session) return;
    try {
      await post("/send", { session: session.session, keys: [k] });
      setTimeout(load, 400);
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

  const KEYS = [
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
      <button class="sm ghost" title="text size" onclick={cycleFont}>{fontPx}px</button>
      <button class="sm ghost" class:on={mode === "term"} title="reading mode"
              onclick={() => (mode = mode === "term" ? "text" : "term")}>
        {mode === "term" ? "term" : "text"}
      </button>
      {#if mode === "text"}
        <button class="sm ghost" class:on={!wrap} title={wrap ? "wrapping" : "not wrapping"}
                onclick={() => (wrap = !wrap)}>{wrap ? "wrap" : "wide"}</button>
      {/if}
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

    {#if mode === "term"}
      <Term session={session.session} {fontPx} {onstatus} />
    {:else}
      <pre class:sweeping={alive} class:busy={working} class:nowrap={!wrap}
           style="font-size:{fontPx}px" bind:this={pre} onscroll={onScroll}>{output || "…"}{#if sent}
  <span class="pending">› {sent}</span>{/if}</pre>
    {/if}

    {#if !pinned}
      <button class="sm jump" onclick={toBottom}>↓ latest</button>
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

  pre {
    flex: 1; min-height: 0; margin: 0; overflow: auto;
    white-space: pre-wrap; word-break: break-word;
    line-height: 1.5; padding: .6rem;
    border: 1px solid var(--card-line); border-radius: var(--radius);
    background: var(--card);
  }

  /* Keep the columns and scroll sideways instead of reflowing. Prose reads
     better wrapped; code, diffs and ls output only make sense aligned. */
  pre.nowrap {
    white-space: pre;
    word-break: normal;
    overflow-x: auto;
  }
  /* Cyan-to-magenta always. Only the speed changes with state — an earlier
     version dropped magenta when idle, and losing the colour reads as the
     animation having stopped even though it is still turning. */
  pre.sweeping {
    border-color: transparent;
    background:
      linear-gradient(var(--card), var(--card)) padding-box,
      conic-gradient(from var(--angle), var(--ok), var(--magenta), var(--ok)) border-box;
    animation: sweep 6s linear infinite;
  }
  pre.sweeping.busy { animation-duration: 2.2s; }

  @media (prefers-reduced-motion: reduce) {
    pre.sweeping, pre.sweeping.busy { animation: none; --angle: 45deg; }
  }

  .jump { position: absolute; align-self: center; margin-top: -2.4rem; opacity: .9; }
  .pending { color: var(--dim); font-style: italic; }

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
  .win {
    display: flex; gap: .35rem; align-items: center; min-width: 0;
    background: var(--card);
    border: 1px solid var(--card-line); border-radius: var(--radius);
    padding: .4rem .5rem;
  }
  .t {
    flex: 1; min-width: 0; font-size: 12px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
</style>
