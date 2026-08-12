<script>
  import { api, post, waitFor } from "./api.js";
  import NewSession from "./NewSession.svelte";
  import Install from "./Install.svelte";

  let { sessions, workspaces, locked, onstatus, onchanged, onjump } = $props();

  // The workspace-swipe model can only show a session that is on a workspace.
  // Detached ones — the normal result of closing a terminal — would otherwise
  // be invisible everywhere, so this pane is the one place that lists all of
  // them regardless of where they are.
  const placed = $derived(sessions.filter((s) => s.workspace !== null));
  const detached = $derived(sessions.filter((s) => s.workspace === null));

  let target = $state({});
  let creating = $state(false);
  let newWs = $state(1);
  const allNames = $derived(sessions.map((s) => s.session));
  let pw = $state("");
  let unlocking = $state(false);

  // The password is held only in this field, sent once, and cleared. It is
  // never stored — not in localStorage, not with the bearer token, nowhere.
  async function unlock(ev) {
    ev.preventDefault();
    if (!pw) return;
    unlocking = true;
    const secret = pw;
    pw = "";
    try {
      // desk.sh polls PAM for up to 10s; the default 8s client deadline would
      // abort a successful unlock and report it as unreachable.
      await post("/unlock", { password: secret }, { timeoutMs: 20000 });
      onstatus("unlocked");
      onchanged();
    } catch (e) { onstatus(e.message, true); }
    finally { unlocking = false; }
  }

  async function adopt(name) {
    const ws = Number(target[name] ?? 0);
    if (!ws) { onstatus("pick a screen first", true); return; }
    try {
      await post("/sessions/attach", { session: name, workspace: ws });
      onstatus(`opening ${name} on screen ${ws}…`);
      await waitFor(async () => {
        const list = await api("/sessions");
        return list.some((s) => s.session === name && s.workspace === ws);
      });
      onchanged();
      onjump(ws);
    } catch (e) { onstatus(e.message, true); }
  }

  async function kill(name) {
    if (!confirm(`Kill session "${name}"? Anything running in it is lost.`)) return;
    try {
      await post("/sessions/kill", { session: name });
      onstatus(`killed ${name}`);
      onchanged();
    } catch (e) { onstatus(e.message, true); }
  }
</script>

<section>
  <h2 class="first">
    sessions
    {#if sessions.length}
      <span class="count">
        {placed.length} on screen{detached.length ? ` · ${detached.length} detached` : ""}
      </span>
    {/if}
  </h2>

  {#if locked}
    <div class="why">
      Screen is locked, so screenshots would return the password prompt. Sessions and
      window state are unaffected.
    </div>
    <form class="unlock" onsubmit={unlock}>
      <input
        type="password" bind:value={pw} disabled={unlocking}
        placeholder="desktop password" autocomplete="current-password" />
      <button disabled={unlocking || !pw}>{unlocking ? "…" : "unlock"}</button>
    </form>
    <div class="hint dim">
      Typed into hyprlock through PAM, exactly as if entered at the desk — a wrong
      password fails normally. Sent once and never stored.
    </div>
  {/if}

  <!-- Creating belongs here as well as on a pane. The index is where you manage
       sessions, and with none running every pane says "no session on this
       screen" — accurate, and no help at all. -->
  {#if creating}
    <div class="pick">
      <span class="lbl">screen</span>
      <select bind:value={newWs}>
        {#each workspaces as n}<option value={n}>{n}</option>{/each}
      </select>
    </div>
    <NewSession
      ws={newWs}
      taken={allNames}
      {onstatus}
      onchanged={() => { creating = false; onchanged(); onjump(newWs); }}
      oncancel={() => (creating = false)} />
  {/if}

  {#if placed.length}
    {#each placed as s (s.session)}
      <div class="row">
        <button class="go" onclick={() => onjump(s.workspace)}>
          <span class="badge">ws{s.workspace}</span>
          <span class="nm">{s.session}</span>
          <span class="path dim">{s.path}</span>
        </button>
        <button class="sm danger" onclick={() => kill(s.session)}>kill</button>
      </div>
    {/each}
  {:else if !detached.length}
    <div class="why">
      Nothing is running yet. Start one above — pick a project directory and whether to
      run a shell or an agent.
    </div>
  {/if}

  {#if detached.length}
    <h2>detached · {detached.length}</h2>
    <div class="why">
      Running, but with no window. Closing a terminal detaches a session rather than
      killing it — that is what keeps work alive when your phone drops.
    </div>
    {#each detached as s (s.session)}
      <div class="row static">
        <span class="nm">{s.session}</span>
        <span class="path dim">{s.path}</span>
      </div>
      <div class="acts">
        <select bind:value={target[s.session]}>
          <option value="">screen…</option>
          {#each workspaces as n}<option value={n}>{n}</option>{/each}
        </select>
        <button class="sm" onclick={() => adopt(s.session)}>open</button>
        <button class="sm danger" onclick={() => kill(s.session)}>kill</button>
      </div>
    {/each}
  {/if}

  <div class="foot"></div>
  <Install />
  <div class="hint dim">Swipe right for screens 1–10.</div>

  <!-- Pinned to the bottom: the top of an 844px screen is a stretch one-handed,
       and this is the action you reach for most. -->
  {#if !creating}
    <button class="new" onclick={() => (creating = true)}>+ new session</button>
  {/if}
</section>

<style>
  section {
    flex: 0 0 100%; width: 100%; max-width: 100%; min-width: 0;
    scroll-snap-align: start;
    /* `always` makes momentum stop at the next pane instead of flying past
       several. Without it a slightly-too-hard swipe overshoots and the rail
       feels loose. */
    scroll-snap-stop: always;
    display: flex; flex-direction: column; gap: .5rem;
    padding: .7rem;
    /* Android's gesture bar and iOS's home indicator overlap the bottom of the
       viewport. Without this the sticky action sits underneath them. */
    padding-bottom: calc(.7rem + env(safe-area-inset-bottom, 0px));
    overflow-y: auto;
  }
  h2 {
    margin: .2rem 0 0; font-size: .72rem; letter-spacing: .09em; text-transform: uppercase;
    color: var(--dim); border-top: 1px solid var(--line); padding-top: .5rem;
  }
  h2.first { border-top: 0; padding-top: 0; }
  .count { float: right; text-transform: none; letter-spacing: 0; }
  .row {
    display: flex; align-items: center; gap: .45rem; min-width: 0;
    width: 100%; text-align: left;
    border: 1px solid var(--line); border-radius: 8px; padding: .4rem .5rem;
  }
  /* the tap-to-jump area; the kill button sits outside it so we never nest
     interactive elements inside a button */
  .go {
    flex: 1; min-width: 0; display: flex; align-items: center; gap: .45rem;
    border: 0; padding: .2rem 0; text-align: left; background: transparent;
  }
  .row.static { border-style: dashed; }
  .nm { font-weight: 600; color: var(--ok); flex: 0 1 auto; min-width: 0;
         overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .path {
    flex: 1; min-width: 0; font-size: 11px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .badge {
    flex: none;
    font-size: .6rem; letter-spacing: .08em; text-transform: uppercase;
    color: var(--bg); background: var(--ok); border-radius: 4px; padding: .1rem .3rem;
  }
  .acts { display: flex; gap: .4rem; padding-left: .5rem; min-width: 0; }
  /* extra separation before a destructive control */
  .acts .danger, .row .danger { margin-left: .5rem; }
  .acts select { flex: 1; min-width: 0; }
  .why {
    font-size: 11.5px; color: var(--dim); line-height: 1.5; min-width: 0;
    border-left: 2px solid var(--line); padding-left: .5rem;
    overflow-wrap: anywhere;
  }
  .hint { font-size: 11px; padding-top: .25rem; line-height: 1.5; }
  .foot { margin-top: auto; }
  .new {
    border-color: var(--ok); color: var(--ok);
    position: sticky; bottom: env(safe-area-inset-bottom, 0px); width: 100%;
    background: var(--bg); box-shadow: 0 -8px 12px -8px var(--bg);
  }
  .pick { display: flex; align-items: center; gap: .45rem; min-width: 0; }
  .pick select { flex: 1; min-width: 0; }
  .lbl { font-size: .65rem; letter-spacing: .09em; text-transform: uppercase; color: var(--dim); }
  .unlock { display: flex; gap: .4rem; min-width: 0; }
  .unlock input { flex: 1; min-width: 0; }
  .foot { margin-top: auto; }
</style>
