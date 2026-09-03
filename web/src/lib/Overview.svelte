<script>
  import { api, post, waitFor, tilde } from "./api.js";
  import NewSession from "./NewSession.svelte";
  import Install from "./Install.svelte";
  import Notify from "./Notify.svelte";
  import Usage from "./Usage.svelte";

  import { hosts, switchTo, addHost, removeHost, needsYou } from "./hosts.svelte.js";

  let { sessions, workspaces, locked, onstatus, onchanged, onjump } = $props();

  // Adding a machine takes the pairing URL that machine's own pair.sh prints —
  // the same thing its QR encodes. That means one paste and no new mechanism to
  // learn, and it works for a headless box over SSH where there is no screen to
  // scan. Eventually this is a short code approved with a passkey; the shape of
  // the flow is the same either way.
  let adding = $state(false);
  let pasted = $state("");

  function addMachine(ev) {
    ev.preventDefault();
    let url;
    try { url = new URL(pasted.trim()); }
    catch { onstatus("that does not look like a pairing link", true); return; }
    const token = url.searchParams.get("token");
    if (!token) { onstatus("no token in that link", true); return; }
    addHost({ origin: url.origin, token, name: url.hostname });
    pasted = "";
    adding = false;
    onstatus(`added ${url.hostname}`);
    onchanged();
  }

  function forget(origin, name) {
    if (hosts.list.length < 2) { onstatus("that is the only machine paired", true); return; }
    removeHost(origin);
    onstatus(`removed ${name}`);
    onchanged();
  }

  // The workspace-swipe model can only show a session that is on a workspace.
  // Detached ones — the normal result of closing a terminal — would otherwise
  // be invisible everywhere, so this pane is the one place that lists all of
  // them regardless of where they are.
  // Blocked first: the index exists to answer "which one needs me", and a
  // session waiting on a permission prompt is the only kind that is stuck
  // until you act. Everything else keeps its natural order.
  const rank = (s) => (s.state === "blocked" ? 0 : s.state === "working" ? 1 : 2);
  const byNeed = (a, b) => rank(a) - rank(b);

  const placed = $derived(sessions.filter((s) => s.workspace !== null).toSorted(byNeed));
  const detached = $derived(sessions.filter((s) => s.workspace === null).toSorted(byNeed));

  // tmux's own last-activity stamp, so it survives a deskpilot restart and
  // measures real use — verified not to creep on its own: two untouched
  // sessions held the same value across 40 seconds while a TUI repainted.
  let nowTs = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => (nowTs = Date.now()), 60_000);
    return () => clearInterval(id);
  });

  function idleFor(s) {
    if (!s.activity) return "";
    const sec = Math.max(0, nowTs / 1000 - s.activity);
    if (sec < 90) return "just now";
    const m = Math.round(sec / 60);
    if (m < 60) return `idle ${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `idle ${h}h`;
    return `idle ${Math.floor(h / 24)}d ${h % 24}h`;
  }

  // A shell holds state nothing else has: cwd, environment, running jobs,
  // scrollback. An agent's conversation is written to disk as it goes, so a
  // detached one that has sat untouched is the safe thing to clear in bulk —
  // and a shell never is, whatever its age.
  const IS_SHELL = /^(bash|zsh|fish|sh|dash|nu)$/;
  const STALE_S = 60 * 60;

  const clearable = $derived(
    detached.filter((s) =>
      !IS_SHELL.test(s.command ?? "") &&
      s.activity && nowTs / 1000 - s.activity > STALE_S),
  );

  let clearing = $state(false);

  async function clearIdle() {
    const names = clearable.map((s) => s.session);
    if (!names.length) return;
    if (!confirm(`Kill ${names.length} idle agent session${names.length === 1 ? "" : "s"}?\n\n${names.join(", ")}\n\nTheir conversations stay on disk — resume with claude --resume.`)) return;
    clearing = true;
    let done = 0;
    for (const name of names) {
      try { await post("/sessions/kill", { session: name }); done++; }
      catch (e) { onstatus(`${name}: ${e.message}`, true); }
    }
    clearing = false;
    onstatus(`killed ${done} of ${names.length}`);
    onchanged();
  }

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
      onjump(ws, name);
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

  <div class="mblock">
  <h2>machines · {hosts.list.length}</h2>
  <div class="machines">
    {#each hosts.list as h (h.origin)}
      <div class="row">
        <button class="go" onclick={() => switchTo(h.origin)}>
          <span class="badge" class:live={h.origin === hosts.current}>
            {h.origin === hosts.current ? "here" : "go"}
          </span>
          <span class="nm">{h.name}</span>
          {#if needsYou[h.origin]}<span class="st blocked">needs you</span>{/if}
          <span class="path dim">{h.origin}</span>
        </button>
        {#if hosts.list.length > 1}
          <button class="sm danger" onclick={() => forget(h.origin, h.name)}>forget</button>
        {/if}
      </div>
    {/each}
  </div>

  {#if adding}
    <form class="unlock" onsubmit={addMachine}>
      <input
        bind:value={pasted} placeholder="paste the pairing link"
        autocapitalize="off" autocorrect="off" spellcheck="false" />
      <button disabled={!pasted.trim()}>add</button>
    </form>
    <div class="hint dim">
      Run <code>shell/pair.sh</code> on the other machine — over SSH is fine, it needs
      no screen — and paste the link it prints. The token is stored on this phone only.
    </div>
  {:else}
    <button class="addm" onclick={() => (adding = true)}>+ add a machine</button>
  {/if}
  </div>

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
        <button class="go" onclick={() => onjump(s.workspace, s.session)}>
          <span class="badge">ws{s.workspace}</span>
          <span class="nm">{s.session}</span>
          {#if s.state === "blocked"}
            <span class="st blocked">{s.tool ? `${s.tool}?` : "needs you"}</span>
          {:else if s.state === "working"}
            <span class="st working">working</span>
          {/if}
          <span class="path dim">{s.state === "blocked" && s.detail ? s.detail : tilde(s.path)}</span>
          <span class="age dim">{idleFor(s)}</span>
        </button>
        <button class="sm danger" onclick={() => kill(s.session)}>kill</button>
      </div>
    {/each}
  {:else if !detached.length}
    <div class="why">
      Nothing running yet. Start one below.
    </div>
  {/if}

  {#if detached.length}
    <h2>detached · {detached.length}</h2>
    <div class="why">Running with no window — closing a terminal detaches, it does not kill.</div>
    {#if clearable.length}
      <button class="sm danger clearall" disabled={clearing} onclick={clearIdle}>
        {clearing ? "killing…" : `kill ${clearable.length} idle agent${clearable.length === 1 ? "" : "s"}`}
      </button>
    {/if}
    {#each detached as s (s.session)}
      <div class="card">
        <div class="cardhead">
          <span class="nm">{s.session}</span>
          <span class="path dim">{tilde(s.path)}</span>
          <span class="age dim">{idleFor(s)}</span>
        </div>
        <div class="acts">
          <select bind:value={target[s.session]}>
            <option value="">screen…</option>
            {#each workspaces as n}<option value={n}>{n}</option>{/each}
          </select>
          <button class="sm" onclick={() => adopt(s.session)}>open</button>
          <button class="sm danger" onclick={() => kill(s.session)}>kill</button>
        </div>
      </div>
    {/each}
  {/if}

  <div class="foot"></div>
  <Usage {onstatus} />
  <Notify {onstatus} />
  <Install />
  <div class="hint dim">Swipe right for screens 1–10.</div>

  <!-- Pinned to the bottom: the top of an 844px screen is a stretch one-handed,
       and this is the action you reach for most. -->
  {#if !creating}
    <button class="new" onclick={() => (creating = true)}>+ new session</button>
  {/if}
</section>

<style>
  /* Pink is what failure and attention look like everywhere else on this
     desktop; cyan is what active looks like. Reusing them means the state
     reads before the word does. */
  .st { flex: none; font-size: 11px; padding: 0 .4rem; border-radius: 6px; border: 1px solid; }
  .st.blocked { color: var(--err); border-color: var(--err); }
  .st.working { color: var(--ok); border-color: var(--ok); }
  .machines { display: flex; flex-direction: column; gap: .35rem; }
  .badge.live { color: var(--ok); border-color: var(--ok); }

  /* Machines are an axis above sessions, not another item in the same list, so
     the block is set apart rather than left to run into the session rows
     underneath it. */
  .mblock {
    border: 1px solid var(--card-line); border-radius: var(--radius);
    background: var(--panel); padding: .1rem .6rem .6rem;
    margin-bottom: 1.1rem;
  }
  .mblock h2 { margin-top: .6rem; }

  /* Dashed and full width: this adds something, where every other button on
     this screen acts on a thing that already exists. Nothing else here is
     dashed, so it reads as a different kind of control at a glance rather than
     after reading the label. */
  .addm {
    width: 100%; margin-top: .5rem; min-height: 44px;
    background: transparent; color: var(--ok);
    border: 1px dashed var(--ok); border-radius: var(--radius);
    font-size: 13px;
  }
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
  .count {
    float: right; text-transform: none; letter-spacing: 0;
    font-variant-numeric: tabular-nums; opacity: .85;
  }
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
    box-shadow: 0 0 12px -2px color-mix(in srgb, var(--ok) 55%, transparent);
  }
  .acts { display: flex; gap: .4rem; min-width: 0; }
  /* extra separation before a destructive control */
  .acts .danger, .row .danger { margin-left: .5rem; }
  .acts select { flex: 1; min-width: 0; }
  /* Pushed to the right of its row and allowed to shrink away first: it is
     the least important thing on the line until you are deciding what to kill. */
  .age { flex: 0 0 auto; margin-left: auto; font-size: 11px; white-space: nowrap; }
  .clearall { align-self: flex-start; margin: .1rem 0 .35rem; }

  .why {
    font-size: 11.5px; color: var(--dim); line-height: 1.5; min-width: 0;
    border-left: 2px solid var(--line); padding-left: .5rem;
    overflow-wrap: anywhere;
  }
  .hint { font-size: 11px; padding-top: .25rem; line-height: 1.5; }
  .foot { margin-top: auto; }
  .new {
    border-color: color-mix(in srgb, var(--ok) 55%, transparent); color: var(--ok);
    background: color-mix(in srgb, var(--ok) 8%, transparent);
    box-shadow: 0 0 20px -8px color-mix(in srgb, var(--ok) 80%, transparent);
    letter-spacing: .04em;
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
