<script>
  import { api, token, setToken } from "./lib/api.js";
  import Pane from "./lib/Pane.svelte";
  import Overview from "./lib/Overview.svelte";

  const WORKSPACES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  let sessions = $state([]);
  let windows = $state([]);
  let locked = $state(false);
  let status = $state("…");
  let bad = $state(false);
  let needToken = $state(!token);
  let tokenInput = $state("");
  let rail = $state(null);
  let activeWs = $state(1);

  const orphans = $derived(sessions.filter((s) => s.workspace === null));

  function onstatus(text, isErr = false) { status = text; bad = isErr; }

  async function refresh() {
    try {
      const [s, w, l] = await Promise.all([
        api("/sessions"), api("/desk/state"), api("/desk/locked"),
      ]);
      sessions = s; windows = w; locked = l.locked;
      needToken = false;
      const det = s.filter((x) => x.workspace === null).length;
      onstatus(locked
        ? "screen locked — text only"
        : `${s.length} session${s.length === 1 ? "" : "s"}` +
          (det ? `, ${det} detached` : ""));
    } catch (e) {
      if (e.status === 401) { needToken = true; onstatus("token required", true); }
      else onstatus(e.message, true);
    }
  }

  // Structural poll only — sessions and window geometry. Pane contents refresh
  // themselves, and only for the visible pane.
  $effect(() => {
    refresh();
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
  <b>deskpilot</b>
  <button class="dots" onclick={() => jump(0)} title="all sessions">
    <i class:on={activeWs === 0} class="idx"></i>
    {#each WORKSPACES as n}
      <i class:on={n === activeWs} class:has={occupied(n)}></i>
    {/each}
  </button>
  <span class="sp"></span>
  <span class:err={bad} class="dim status">{status}</span>
  <button onclick={refresh}>↻</button>
</header>

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
        workspaces={WORKSPACES}
        active={ws === activeWs}
        {onstatus}
        onchanged={refresh} />
    {/each}
  </div>
{/if}

<style>
  header {
    display: flex; gap: .5rem; align-items: center;
    padding: .5rem .75rem; border-bottom: 1px solid var(--line);
    position: sticky; top: 0; background: var(--bg); z-index: 3;
  }
  header b { font-weight: 600; letter-spacing: .02em; }
  .sp { flex: 1; }
  .status { font-size: 12px; text-align: right; }
  .dots {
    display: flex; gap: 4px; align-items: center;
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
  }
  .rail::-webkit-scrollbar { display: none; }
  .gate { padding: 1rem; display: flex; flex-direction: column; gap: .6rem; }
  .gate p { margin: 0; font-size: 12px; line-height: 1.5; }
</style>
