<script>
  import { api, token, setToken } from "./lib/api.js";
  import Pane from "./lib/Pane.svelte";
  import Overview from "./lib/Overview.svelte";
  import { vis } from "./lib/visible.svelte.js";

  const WORKSPACES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  let sessions = $state([]);
  let windows = $state([]);
  let locked = $state(false);
  let status = $state("");
  let bad = $state(false);
  let needToken = $state(!token);
  let offline = $state(false);
  let lastSeen = $state(null);
  let tokenInput = $state("");
  let rail = $state(null);
  let activeWs = $state(1);

  const orphans = $derived(sessions.filter((s) => s.workspace === null));
  const allNames = $derived(sessions.map((s) => s.session));

  // The header shows transient feedback and then gets out of the way. Errors
  // persist — they are not noise, and a stale error is better than a silent
  // failure. Successes clear themselves.
  let clearTimer;
  function onstatus(text, isErr = false) {
    status = text;
    bad = isErr;
    clearTimeout(clearTimer);
    if (!isErr && text) clearTimer = setTimeout(() => { if (status === text) status = ""; }, 4000);
  }

  async function refresh() {
    try {
      const [s, w, l] = await Promise.all([
        api("/sessions"), api("/desk/state"), api("/desk/locked"),
      ]);
      sessions = s; windows = w; locked = l.locked;
      needToken = false;
      offline = false;
      lastSeen = new Date();
      // The header is for transient messages. Counts belong in the index,
      // where there is room and where you go to act on them — repeating them
      // in a 12px truncating strip was noise that crowded out real feedback.
      if (locked) onstatus("locked");
      else if (bad) onstatus("");   // recovered from an error
    } catch (e) {
      if (e.status === 401) { needToken = true; onstatus("token required", true); }
      else if (e.unreachable) { offline = true; onstatus("offline", true); }
      else onstatus(e.message, true);
    }
  }

  // Structural poll only — sessions and window geometry. Pane contents refresh
  // themselves, and only for the visible pane.
  //
  // Reading vis.visible and vis.wokeAt makes this effect re-run when the page
  // is backgrounded or comes back, so returning to the app refetches at once
  // rather than waiting for a timer the browser had suspended.
  // Fetch once unconditionally: a page can start hidden — restored in a
  // background tab, or a PWA launched behind the lock screen — and gating the
  // first load on visibility leaves it permanently empty. Only the *polling*
  // is conditional.
  $effect(() => {
    void vis.wokeAt;
    refresh();
    if (!vis.visible) return;
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  });

  // Rail position 0 is the index; workspace N is therefore at position N.
  function onRailScroll() {
    if (!rail) return;
    activeWs = Math.round(rail.scrollLeft / (rail.clientWidth || 1));
  }

  function jump(ws) {
    rail?.scrollTo({ left: ws * (rail.clientWidth || 1), behavior: "smooth" });
  }

  function saveToken(ev) {
    ev.preventDefault();
    setToken(tokenInput.trim());
    tokenInput = "";
    refresh();
  }

  const sessionFor = (ws) => sessions.find((s) => s.workspace === ws) ?? null;
  const windowsFor = (ws) => windows.filter((w) => w.workspace === ws);
  const occupied = (ws) => sessions.some((s) => s.workspace === ws) || windowsFor(ws).length > 0;
</script>

<header>
  <b class="brand">deskpilot</b>
  <button class="dots" onclick={() => jump(0)} title="all sessions">
    <i class:on={activeWs === 0} class="idx"></i>
    {#each WORKSPACES as n}
      <i class:on={n === activeWs} class:has={occupied(n)}></i>
    {/each}
  </button>
  <span class:err={bad} class="dim status">{status}</span>
  <button class="reload" onclick={refresh}>↻</button>
</header>

{#if offline && !needToken}
  <div class="offline">
    <b>Can't reach the desktop.</b>
    Check Tailscale is switched on — the app being signed in is not the same as the
    tunnel running. The page is not broken; nothing answered.
    {#if lastSeen}<br /><span class="dim">Last contact {lastSeen.toLocaleTimeString()}.</span>{/if}
    <button onclick={refresh}>retry</button>
  </div>
{/if}

{#if needToken}
  <form class="gate" onsubmit={saveToken}>
    <p class="dim">
      Paste the bearer token from <code>~/.config/deskpilot/token</code>, or open the
      QR link once and it stores itself.
    </p>
    <input bind:value={tokenInput} placeholder="token" autocomplete="off" />
    <button>save</button>
  </form>
{:else}
  <div class="rail" bind:this={rail} onscroll={onRailScroll}>
    <Overview
      {sessions}
      workspaces={WORKSPACES}
      {locked}
      {onstatus}
      onchanged={refresh}
      onjump={jump} />
    {#each WORKSPACES as ws (ws)}
      <Pane
        {ws}
        session={sessionFor(ws)}
        windows={windowsFor(ws)}
        {orphans}
        {allNames}
        workspaces={WORKSPACES}
        active={ws === activeWs}
        {onstatus}
        onchanged={refresh} />
    {/each}
  </div>
{/if}

<style>
  /* Every child is flex:none except the status, which absorbs the slack and
     truncates. Without this the header overflowed below ~360px. */
  header {
    display: flex; gap: .5rem; align-items: center; min-width: 0;
    padding: .5rem .6rem; border-bottom: 1px solid var(--line);
    position: sticky; top: 0; background: var(--bg); z-index: 3;
  }
  .brand { flex: none; font-weight: 600; letter-spacing: .02em; }
  .reload { flex: none; }
  .status {
    flex: 1 1 auto; min-width: 0; font-size: 12px; text-align: right;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  /* Narrow phones: the wordmark is the first thing that can go. */
  @media (max-width: 359px) {
    .brand { display: none; }
    header { gap: .4rem; }
  }
  .dots {
    display: flex; gap: 4px; align-items: center; flex: none;
    border: 0; padding: .3rem .2rem; background: transparent;
  }
  .dots i {
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--line); display: block;
  }
  .dots i.has { background: var(--dim); }
  /* the index marker is a square so it reads as "not a screen" */
  .dots i.idx { border-radius: 2px; background: var(--dim); }
  .dots i.on { background: var(--ok); }
  .rail {
    display: flex; overflow-x: auto; scroll-snap-type: x mandatory;
    height: calc(100dvh - 46px); scrollbar-width: none;
    /* Without contain, a swipe past the last pane scrolls the page behind it. */
    overscroll-behavior-x: contain;
  }
  .rail::-webkit-scrollbar { display: none; }
  .offline {
    margin: .6rem; padding: .6rem .7rem; border-radius: 8px; line-height: 1.5;
    font-size: 12px; border: 1px solid var(--err);
    background: color-mix(in srgb, var(--err) 12%, transparent);
  }
  .offline button { margin-top: .4rem; display: block; }
  .gate { padding: 1rem; display: flex; flex-direction: column; gap: .6rem; }
  .gate p { margin: 0; font-size: 12px; line-height: 1.5; }
</style>
