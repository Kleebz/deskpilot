<script>
  import { api, post, waitFor, tilde, enroll } from "./api.js";
  import NewSession from "./NewSession.svelte";
  import Install from "./Install.svelte";
  import Notify from "./Notify.svelte";
  import Usage from "./Usage.svelte";

  import {
    hosts, currentHost, switchTo, addHost, removeHost, needsYou, capsFor,
  } from "./hosts.svelte.js";

  let { sessions, workspaces, locked, onstatus, onchanged, onjump } = $props();

  // Adding a machine takes the pairing link that machine printed — the same
  // thing its QR encodes. One paste, no new mechanism to learn, and it works
  // for a headless box over SSH where there is no screen to scan.
  //
  // Both `shell/pair.sh` and `deskpilot pair` print a whole link, so either can
  // be pasted into one field. The binary could not always do that: it runs
  // under --allow-run=tmux,ps,hyprctl,desk.sh and cannot ask tailscale what
  // this machine is called, so it printed a bare code and left the address to
  // whoever was reading. desk.sh is on that allowlist and now answers `addr`,
  // which is the same answer at no new permission.
  //
  // So: an address, and a code beside it that a pasted link fills in for you.
  // This used to be one field demanding a raw ?token=, which pair.sh prints
  // only in its fallback — for a machine whose service is down, which is the
  // one machine you cannot pair — and which is the shared, unrevocable
  // credential devices.ts was written to retire. The only paste that worked
  // was the one that should not have.
  let adding = $state(false);
  let pasted = $state("");
  let pastedCode = $state("");
  // A code is single-use: a double tap would spend it and report the second
  // attempt as invalid.
  let addingNow = $state(false);

  // Which session is being renamed, and to what. A session is named after the
  // directory it started in, so "deskpilot" tells you where it is and nothing
  // about what it is doing — worth being able to say "review" or "hotfix".
  let renaming = $state("");
  let newName = $state("");

  // Paired devices. This is the half that makes a lost phone survivable: a
  // credential you can take away on its own, and a list honest enough to tell
  // you which one you are holding.
  let devices = $state([]);
  let legacy = $state(false);
  // Entering a code on a device that is already in. The gate in App.svelte only
  // renders when you are *not* authenticated, so a phone already paired had
  // nowhere to type one — while the notice above it said "pair it again below"
  // to trade the shared token for its own. It was telling you to do something
  // the app gave you no way to do.
  let ownCode = $state("");
  let claiming = $state(false);

  // A device on the shared credential already holds full access to this
  // machine, so minting a code and spending it on itself grants nothing it
  // could not already do — it only trades a credential that cannot be taken
  // away for one that can. Both calls are already available to it: /devices/code
  // is authenticated and this device is authenticated. So there is no reason to
  // make someone carry a code from one half of a screen to the other.
  let upgrading = $state(false);
  async function claimOwnCredential() {
    if (upgrading) return;
    upgrading = true;
    try {
      const { code } = await post("/devices/code", {});
      await enroll(code, currentHost());
      onstatus("this device now has its own credential");
      loadDevices(hosts.current);
    } catch (e) {
      onstatus(e.message, true);
    } finally {
      upgrading = false;
    }
  }

  async function claimOwn(ev) {
    ev.preventDefault();
    const code = ownCode.trim();
    if (!code || claiming) return;
    claiming = true;
    try {
      await enroll(code, currentHost());
      ownCode = "";
      onstatus("this device now has its own credential");
      loadDevices(hosts.current);
    } catch (e) {
      onstatus(e.message, true);
    } finally {
      claiming = false;
    }
  }

  async function loadDevices(here) {
    try {
      const d = await api("/devices");
      // The list belongs to one machine. Arriving after a switch, it belongs
      // to the wrong one.
      if (hosts.current !== here) return;
      devices = d.devices;
      legacy = d.legacy;
    } catch { /* not fatal — the rest of the screen still works */ }
  }

  // Read the machine *synchronously*, or this effect tracks nothing at all:
  // api() only resolves which host it is talking to after its first await, so
  // `$effect(() => { loadDevices(); })` had no dependency on the selection and
  // never re-ran. Measured: zero /devices requests across a switch, leaving
  // one machine's paired devices — and its pairing code — on screen under
  // another machine's name, with a revoke button that posted the first
  // machine's device ids to the second.
  $effect(() => {
    const here = hosts.current;
    devices = [];
    legacy = false;
    // A rename in progress names a session on the machine you were on; saving
    // it after a switch renames whatever happens to share that name here.
    renaming = "";
    loadDevices(here);
  });

  async function revokeDevice(d) {
    try {
      const r = await post("/devices/revoke", { id: d.id });
      onstatus(r.self ? "revoked this device — reload to re-pair" : `revoked ${d.name}`);
      loadDevices(hosts.current);
    } catch (e) { onstatus(e.message, true); }
  }

  // Shown only when it explains something you are looking at. A permanent
  // notice about a thing you chose not to install is a nag; the same sentence
  // next to an empty list is an answer.
  const caps = $derived(capsFor());
  const hookMissing = $derived(caps.shellHook === false);
  const hookHint = $derived(
    `source ${caps.repo ?? "~/Projects/deskpilot"}/shell/claude-tmux.sh`,
  );

  let copied = $state(false);
  async function copyHint() {
    try {
      await navigator.clipboard.writeText(`echo '${hookHint}' >> ~/.bashrc`);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch { onstatus("could not copy — select it by hand", true); }
  }

  const ago = (t) => {
    if (!t) return "";
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 2) return "now";
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
  };

  function startRename(name) {
    renaming = name;
    newName = name;
  }

  async function saveRename(ev) {
    ev.preventDefault();
    const to = newName.trim();
    if (!to || to === renaming) { renaming = ""; return; }
    try {
      await post("/sessions/rename", { session: renaming, name: to });
      onstatus(`renamed to ${to}`);
      renaming = "";
      onchanged();
    } catch (e) {
      onstatus(e.message, true);
    }
  }

  async function addMachine(ev) {
    ev.preventDefault();
    if (addingNow) return;
    let url;
    const raw = pasted.trim();
    try {
      // Nobody types the scheme, and the two documented ways to reach a machine
      // want different ones: Tailscale Serve answers https on 443 with no port,
      // and the LAN fallback is plain http on the app's own port. So an address
      // naming a port — or a bare IP, or localhost — is the second case, and
      // guessing https there fails in the one way that looks like the machine
      // is down rather than like a typo.
      const scheme = /:\d+/.test(raw) || /^(localhost|\d+\.\d+\.\d+\.\d+)/i.test(raw)
        ? "http"
        : "https";
      url = new URL(/^https?:\/\//i.test(raw) ? raw : `${scheme}://${raw}`);
    } catch {
      onstatus("that does not look like an address", true);
      return;
    }

    // A code in the address wins: pasting a whole link should not also require
    // retyping the code out of it.
    const code = url.searchParams.get("code") || pastedCode.trim();
    const token = url.searchParams.get("token");
    if (!code && !token) {
      onstatus("enter the code that `deskpilot pair` printed", true);
      return;
    }

    const host = { origin: url.origin, token: "", name: url.hostname };
    addingNow = true;
    try {
      if (code) {
        // The normal case. Exchanged on that machine for a credential
        // belonging to this phone alone, which is what makes a lost phone
        // survivable — enroll() records the machine once it has one.
        await enroll(code, host);
      } else {
        // pair.sh's fallback, printed when the machine's service was down.
        // Shared and unrevocable, but refusing it would mean refusing the only
        // link that machine can currently produce.
        addHost({ origin: url.origin, token, name: url.hostname });
      }
    } catch (e) {
      onstatus(e.unreachable ? `can't reach ${url.hostname}` : e.message, true);
      return;
    } finally {
      addingNow = false;
    }

    pasted = "";
    pastedCode = "";
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

  // The server has always reported its version in /api/capabilities and nothing
  // ever showed it, so neither end could tell it was out of date — and with
  // several machines the question is not "what am I running" but "which of
  // these is behind". Read off the caps map directly: capsFor() fills in
  // defaults for a machine that has not answered, and a version is exactly the
  // thing that must never be guessed.
  const versionOf = (origin) => hosts.caps[origin]?.version ?? "";
</script>

<section>
  {#if legacy}
    <div class="legacybar">
      <span>
        This device shares the machine's key, so it cannot be revoked on its own.
        Losing the phone would mean re-pairing everything else.
      </span>
      <button class="sm" onclick={claimOwnCredential} disabled={upgrading}>
        {upgrading ? "…" : "give it its own"}
      </button>
    </div>
  {/if}

  <h2 class="first">
    sessions
    {#if sessions.length}
      <span class="count">
        {placed.length} on screen{detached.length ? ` · ${detached.length} detached` : ""}
      </span>
    {/if}
  </h2>

  {#if caps.unsupported}
    <div class="why">
      This machine runs Hyprland {caps.compositorVersion}, and the window and
      screenshot controls need <b>0.56.2</b> or newer — every dispatcher moved to a
      different API in that release, and on an older one they fail without saying so.
      Sessions and terminals are unaffected.
    </div>
  {/if}

  {#if locked && caps.unlock === false}
    <div class="why">
      Screen is locked, so screenshots would return the password prompt. Sessions
      and window state are unaffected.
      <br /><br />
      Remote unlock is off on this machine. It types your password into the lock
      screen, so it has to be turned on deliberately —
      <code>DESKPILOT_UNLOCK=1</code> in the config, then restart the service.
    </div>
  {:else if locked}
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
        <button class="sm" title="rename" aria-label="rename {s.session}"
                onclick={() => startRename(s.session)}>✎</button>
        <button class="sm danger" onclick={() => kill(s.session)}>kill</button>
      </div>
      {#if renaming === s.session}
        <form class="unlock rn" onsubmit={saveRename}>
          <input bind:value={newName} placeholder="new name"
                 autocapitalize="off" autocorrect="off" spellcheck="false" />
          <button disabled={!newName.trim()}>save</button>
          <button type="button" class="sm" onclick={() => (renaming = "")}>cancel</button>
        </form>
      {/if}
    {/each}
  {:else if !detached.length}
    <div class="why">
      Nothing running yet. Start one below.
      {#if hookMissing}
        <br /><br />
        <b>Agents you start at your desk will not appear here.</b>
        Starting one in a terminal runs it outside tmux, where nothing can reach it.
        Add the shell hook once and they show up on their own — it wraps whichever
        agents you list in <code>DESKPILOT_WRAP</code>, not just one:
        <div class="cmd">{hookHint}</div>
        <button class="sm" onclick={copyHint}>{copied ? "copied" : "copy"}</button>
      {/if}
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
          {#if versionOf(h.origin)}
            <!-- Split so the narrow case keeps the part that answers the
                 question. "0.1.2 vs 0.1.3" is what you compare on a phone; the
                 commit only matters to someone running from a checkout, and it
                 is the first thing to go when the row runs out of room. -->
            <span class="ver dim">
              {versionOf(h.origin).split("+")[0]}<!--
              -->{#if versionOf(h.origin).includes("+")}<span class="vsha"
                >+{versionOf(h.origin).split("+")[1]}</span>{/if}
            </span>
          {/if}
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
        bind:value={pasted} placeholder="complete pairing link or address"
        autocapitalize="off" autocorrect="off" spellcheck="false" />
    </form>
    <form class="unlock" onsubmit={addMachine}>
      <input
        class="code-in" bind:value={pastedCode} placeholder="code (bare address only)"
        autocapitalize="characters" autocorrect="off" spellcheck="false" />
      <button disabled={!pasted.trim() || addingNow}>{addingNow ? "pairing…" : "add"}</button>
    </form>
    <div class="hint dim">
      Run <code>deskpilot pair</code> on the other machine — over SSH is fine, it needs
      no screen — and paste the complete link into the first field. Leave the code field
      empty; it is only for pairing from a bare address.
      Either way the code is exchanged for a credential belonging to this phone alone,
      revocable from that machine without disturbing anything else.
    </div>
  {:else}
    <button class="addm" onclick={() => (adding = true)}>+ add a machine</button>
  {/if}
  </div>

  <div class="mblock">
  <h2>devices · {devices.length}</h2>

  {#each devices as d (d.id)}
    <div class="row">
      <button class="go" onclick={() => {}} disabled>
        <span class="badge" class:live={d.current}>{d.current ? "this" : "•"}</span>
        <span class="nm">{d.name}</span>
        <span class="path dim">last used {ago(d.lastSeen)}</span>
      </button>
      <button class="sm danger" onclick={() => revokeDevice(d)}>revoke</button>
    </div>
  {/each}

  <div class="hint dim">
    Run <code>deskpilot pair</code> on this machine to add another — it prints a QR
    carrying the address and a one-time code together. Revoking here takes one
    device's credential away and leaves the rest paired.
  </div>

  {#if legacy}
    <!-- Somewhere to type a code on a device that is already in: the gate that
         accepts one renders only while you are *not* authenticated, so a paired
         phone had nowhere at all. Beside the one-tap button above, for a code
         carried from `deskpilot pair` on the machine itself. -->
    <form class="unlock claim" onsubmit={claimOwn}>
      <input
        bind:value={ownCode} placeholder="code, to re-pair this device"
        autocapitalize="characters" autocorrect="off" spellcheck="false" />
      <button disabled={!ownCode.trim() || claiming}>{claiming ? "…" : "use"}</button>
    </form>
  {/if}
  </div>

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
  /* Shrinkable, unlike the badge: at 320px a row carrying a workspace badge, a
     name, a state and a path has more than fits, and something has to give.
     The state is the least useful half-word of the four. */
  .st {
    flex: 0 1 auto; min-width: 0; font-size: 11px; padding: 0 .4rem;
    border-radius: 6px; border: 1px solid;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .st.blocked { color: var(--err); border-color: var(--err); }
  .st.working { color: var(--ok); border-color: var(--ok); }
  .machines { display: flex; flex-direction: column; gap: .35rem; }
  /* Sits under the row it belongs to rather than replacing it, so the name you
     are changing stays visible while you type the new one. */
  .rn { margin: .1rem 0 .5rem; }
  .cmd {
    font-family: ui-monospace, monospace; font-size: 12px; color: var(--ok);
    background: var(--card); border: 1px solid var(--card-line);
    border-radius: 8px; padding: .5rem; margin: .5rem 0;
    overflow-x: auto; white-space: pre;
  }
  .badge.live { color: var(--ok); border-color: var(--ok); }

  /* Machines and devices are an axis, not another item in the session list, so
     each block is set apart rather than left to run into the rows above it.
     Both sit below the sessions: this screen is opened to see what is running,
     and pairing is a thing you do once. */
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
  /* justify-content is not decoration here. A <button> used as a flex container
     inherits centring from the UA stylesheet, so when its children do not fit,
     the overflow escapes BOTH sides — the workspace badge ended up 16px to the
     left of the button that contains it, outside the pane entirely. Starting at
     flex-start means overflow can only ever go one way, and truncation can
     then deal with it. */
  .go {
    flex: 1; min-width: 0; display: flex; align-items: center; gap: .45rem;
    justify-content: flex-start;
    border: 0; padding: .2rem 0; text-align: left; background: transparent;
  }
  /* The name identifies the row, so it yields last rather than first. It was
     collapsing to "deskpil…" while a fixed-width "kill" button kept every
     pixel it asked for — visible the moment the interface was screenshotted at
     390px rather than looked at on a desktop. */
  .nm { font-weight: 600; color: var(--ok); flex: 1 1 auto; min-width: 4.5rem;
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
  /* "blocked on Bash" beats "idle 5h": when there is state to report, the clock
     is the thing worth dropping on a narrow screen. */
  @media (max-width: 430px) {
    .row:has(.st) .age { display: none; }
  }
  /* Same shape as .age: pushed right, never the thing that shrinks. */
  .ver {
    flex: 0 0 auto; margin-left: auto; font-size: 11px; white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  @media (max-width: 430px) { .vsha { display: none; } }

  .clearall { align-self: flex-start; margin: .1rem 0 .35rem; }

  /* At the top of the index rather than down in the devices list, because it
     is a fact about the phone in your hand and nobody scrolls to find one.
     Warning-coloured but not red: nothing is broken, something is weaker than
     it should be. */
  .legacybar {
    display: flex; align-items: center; gap: .5rem; min-width: 0;
    margin: 0 0 .6rem; padding: .5rem .6rem; border-radius: var(--radius);
    font-size: 11.5px; line-height: 1.45; color: var(--fg);
    border: 1px solid color-mix(in srgb, var(--warn) 45%, transparent);
    background: color-mix(in srgb, var(--warn) 9%, transparent);
  }
  .legacybar span { min-width: 0; }
  .legacybar button { flex: none; }
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
  .claim { margin-top: .5rem; }
  .claim input { text-transform: uppercase; }
  .unlock { display: flex; gap: .4rem; min-width: 0; }
  .unlock input { flex: 1; min-width: 0; }
  /* The alphabet is uppercase, so show it that way whatever the phone's
     keyboard did. No flex rule here on purpose: `.unlock input` outranks a
     bare class, so one was already being ignored, and the code shares its row
     with the add button rather than with the address — there is nothing to
     ration. */
  .unlock input.code-in { text-transform: uppercase; }
  .foot { margin-top: auto; }
</style>
