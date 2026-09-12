<script>
  import { onMount, tick, untrack } from 'svelte';
  import { api, post, ready, tilde } from './lib/api.js';
  import { hosts, currentHost, displayName, switchTo, setCaps, needsYou, attention, setAttention } from './lib/hosts.svelte.js';
  import { vis } from './lib/visible.svelte.js';
  import Pane from './lib/Pane.svelte';
  import WindowRow from './lib/WindowRow.svelte';
  import NewSession from './lib/NewSession.svelte';
  import AddMachine from './lib/AddMachine.svelte';
  import Management from './lib/Management.svelte';

  const workspaces = [1,2,3,4,5,6,7,8,9,10];
  let sessions = $state([]), windows = $state([]), connection = $state('loading');
  let status = $state(''), bad = $state(false), locked = $state(false);
  let route = $state({ view: 'sessions', host: hosts.current });
  let main = $state(null);
  let screenRail = $state(null);
  let shownHost = '', epoch = 0, request = 0;
  let drafts = $state({}), creationDrafts = $state({}), pairingDraft = $state({ address: '', code: '' });
  let menu = $state(false), rename = $state(''), target = $state(1), actionBusy = $state(false);
  let screen = $state(1), password = $state(''), unlocking = $state(false);
  const screensByHost = new Map();
  const positions = new Map();
  const caps = $derived(hosts.caps[hosts.current] ?? {});
  const selected = $derived(sessions.find(s => s.session === route.session));
  const rank = s => s.state === 'blocked' ? 0 : s.state === 'working' ? 1 : 2;
  const ordered = $derived([...sessions].sort((a,b) => rank(a)-rank(b)));
  const attentionItems = $derived(hosts.list.filter(h => h.origin !== hosts.current).flatMap(h => (attention[h.origin] ?? []).map(s => ({ ...s, host: h }))));
  const keyFor = r => JSON.stringify([r.host, r.view, r.session ?? '']);
  const draftKey = $derived(JSON.stringify([hosts.current, route.session]));
  let restoreFocus = '';

  function onstatus(text, error = false) { status = text; bad = error; }
  function remember() { if (main) positions.set(keyFor(route), main.scrollTop); }
  function alignScreen(behavior = 'auto') {
    if (!screenRail) return;
    screenRail.scrollTo({ left: (screen - 1) * screenRail.clientWidth, behavior });
  }
  function showScreen(value, smooth = true) {
    const next = Math.max(1, Math.min(10, Number(value) || 1));
    screen = next;
    screensByHost.set(hosts.current, next);
    alignScreen(smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto');
  }
  function onScreenScroll() {
    if (!screenRail?.clientWidth) return;
    const next = Math.max(1, Math.min(10, Math.round(screenRail.scrollLeft / screenRail.clientWidth) + 1));
    if (next !== screen) {
      screen = next;
      screensByHost.set(hosts.current, next);
    }
  }
  async function renderRoute(next, focus = '') {
    route = next; menu = false; status = ''; password = '';
    if (next.view === 'new') creationDrafts[next.host] ??= { name: '', dir: '', command: 'claude', workspace: null };
    if (next.view === 'terminal') {
      const key = JSON.stringify([next.host, next.session]);
      drafts[key] ??= { input: '', clip: '' };
    }
    await tick();
    if (keyFor(route) !== keyFor(next)) return;
    if (next.view === 'screens') alignScreen();
    if (main) main.scrollTop = positions.get(keyFor(next)) ?? 0;
    const control = focus && document.getElementById(focus);
    (control || document.querySelector('h1'))?.focus({ preventScroll: true });
  }
  function navigate(view, extra = {}, invoker = '') {
    remember(); restoreFocus = invoker;
    const next = { view, host: hosts.current, ...extra };
    history.pushState({ deskpilot: next }, '', location.href);
    renderRoute(next);
  }
  function home(top = false) {
    if (top) positions.set(keyFor({ host: hosts.current, view: 'sessions' }), 0);
    navigate('sessions');
  }
  function cancel() {
    // Our form entries always have an in-app predecessor.
    history.back();
  }
  function choose(origin) {
    if (origin === hosts.current) return;
    remember(); switchTo(origin);
    positions.set(keyFor({ host: origin, view: 'sessions' }), 0);
    navigate('sessions');
  }
  function open(s) { navigate('terminal', { session: s.session }, `session-${s.session}`); }
  function openAttention(item) {
    remember();
    switchTo(item.host.origin);
    navigate('terminal', { session: item.session });
  }
  function create(workspace = null, invoker = 'new-session') {
    creationDrafts[hosts.current] ??= { name: '', dir: '', command: 'claude', workspace: route.view === 'screens' ? (workspace ?? screen) : null };
    navigate('new', {}, invoker);
  }
  async function created(result) {
    const here = hosts.current, generation = epoch;

    await refresh();
    if (here !== hosts.current || generation !== epoch || route.view !== 'new') return;
    if (!sessions.some(s => s.session === result.session)) sessions = [...sessions, result];
    navigate('terminal', { session: result.session });
    delete creationDrafts[here];
    onstatus(result.workspace == null ? 'Session created' : `Session created; desktop placement requested on Screen ${result.workspace}`);
  }
  function paired() { home(true); refresh(); onstatus('Machine paired'); }

  async function refresh() {
    const host = currentHost(), generation = epoch, seq = ++request;
    try {
      const [list, c, w, l] = await Promise.all([
        api('/sessions', { host }), api('/capabilities', { host }),
        api('/desk/state', { host }).catch(() => []),
        api('/desk/locked', { host }).catch(() => ({ locked: false })),
      ]);
      if (host.origin !== hosts.current || generation !== epoch || seq !== request) return;
      sessions = list; windows = w; locked = l.locked; setCaps(host.origin, c);
      setAttention(host.origin, list);
      connection = 'ready';
    } catch (e) {
      if (host.origin !== hosts.current || generation !== epoch || seq !== request) return;
      connection = e.status === 401 ? 'auth' : e.unreachable ? 'offline' : 'error';
      if (connection === 'error') onstatus(e.message, true);
    }
  }
  $effect(() => {
    const here = hosts.current;
    void vis.wokeAt;
    untrack(() => {
    if (shownHost !== here) {
      screensByHost.set(shownHost, screen); screen = screensByHost.get(here) ?? 1;
      shownHost = here; epoch++; sessions = []; windows = []; connection = 'loading';
      if (route.host !== here) {
        positions.set(keyFor({ host: here, view: 'sessions' }), 0);
        renderRoute({ host: here, view: 'sessions' });
      }
    }
    ready.then(refresh);
    });
    if (!vis.visible) return;
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  });
  $effect(() => {
    const list = hosts.list.map(h => ({ ...h }));
    if (!vis.visible) return;
    const poll = () => Promise.all(list.map(async host => {
      try { const s = await api('/sessions', { host, timeoutMs: 6000 }); setAttention(host.origin, s); }
      catch { setAttention(host.origin, []); }
    }));
    poll(); const timer = setInterval(poll, 15000);
    return () => clearInterval(timer);
  });
  onMount(() => {
    history.replaceState({ deskpilot: $state.snapshot(route) }, '', location.href);
    const back = e => {
      if (!e.state?.deskpilot) return;
      remember(); const next = e.state.deskpilot;
      if (!hosts.list.some(h => h.origin === next.host)) { home(true); return; }
      switchTo(next.host); renderRoute(next, restoreFocus); restoreFocus = '';
    };
    const resize = () => {
      document.documentElement.style.setProperty('--app-h', `${window.visualViewport?.height ?? innerHeight}px`);
      requestAnimationFrame(() => { if (route.view === 'screens') alignScreen(); });
    };
    window.addEventListener('popstate', back);
    window.visualViewport?.addEventListener('resize', resize); resize();
    return () => { window.removeEventListener('popstate', back); window.visualViewport?.removeEventListener('resize', resize); };
  });
  async function unlock(e) {
    e.preventDefault();
    const host = currentHost(), generation = epoch, secret = password;
    password = ''; unlocking = true;
    try {
      await post('/unlock', { password: secret }, { host, timeoutMs: 20000 });
      if (generation === epoch && hosts.current === host.origin) { onstatus('Desktop unlocked'); refresh(); }
    } catch (e) { if (generation === epoch && hosts.current === host.origin) onstatus(e.message, true); }
    finally { unlocking = false; }
  }
  async function action(kind) {
    if (actionBusy || !selected) return;
    if (kind === 'kill' && !confirm(`Kill session "${selected.session}"? Anything running in it is lost.`)) return;
    const host = currentHost(), generation = epoch, name = selected.session;
    const view = route;
    actionBusy = true;
    try {
      await post(`/sessions/${kind}`, { session: name, ...(kind === 'rename' ? { name: rename.trim() } : {}), ...(kind === 'attach' ? { workspace: target } : {}) }, { host });
      if (generation !== epoch || host.origin !== hosts.current || route !== view) return;
      if (kind === 'rename') {
        drafts[JSON.stringify([host.origin, rename.trim()])] = drafts[draftKey];
        route = { ...route, session: rename.trim() };
        history.replaceState({ deskpilot: $state.snapshot(route) }, '', location.href);
      }
      if (kind === 'kill') home();
      menu = false; await refresh();
      if (host.origin === hosts.current) onstatus(kind === 'attach' ? `Opening ${name} on Screen ${target}` : kind === 'kill' ? 'Session killed' : 'Session renamed');
    } catch (e) { if (generation === epoch && host.origin === hosts.current) onstatus(e.message, true); }
    finally { actionBusy = false; }
  }
</script>

<header>
  <label class="picker">Machine<select aria-label="Machine" value={hosts.current} onchange={e => choose(e.currentTarget.value)}>{#each hosts.list as h (h.origin)}<option value={h.origin}>{displayName(h)}{needsYou[h.origin] ? ` · ${needsYou[h.origin]} need you` : ''}</option>{/each}</select></label>
  <button id="add-machine" class="addm" onclick={() => navigate('add', {}, 'add-machine')}>Add machine</button>
</header>
{#if route.view !== 'terminal'}
<nav aria-label="Views"><button class:active={route.view === 'sessions'} onclick={() => home()}>Sessions</button>{#if caps.windows}<button class:active={route.view === 'screens'} onclick={() => navigate('screens')}>Screens</button>{/if}<button class:active={route.view === 'management'} onclick={() => navigate('management')}>Manage</button></nav>
{:else}
<div class="terminal-nav"><button onclick={() => { const id = `session-${route.session}`; home(); tick().then(() => document.getElementById(id)?.focus({ preventScroll: true })); }}>Back to sessions</button><button aria-expanded={menu} onclick={() => { menu = !menu; rename = route.session; }}>Session actions</button></div>
{/if}
{#if status}<div class:err={bad} class="feedback" role={bad ? 'alert' : 'status'}>{status}</div>{/if}

{#if route.view === 'terminal' && connection === 'ready' && selected}
  {#if menu}<div class="session-menu">
    <label>Session name<input bind:value={rename} aria-label="Session name" /></label><button disabled={actionBusy || !rename.trim()} onclick={() => action('rename')}>Rename</button>
    {#if caps.windows}<label>Desktop screen<select bind:value={target}>{#each workspaces as n}<option value={n}>Screen {n}</option>{/each}</select></label><button disabled={actionBusy} onclick={() => action('attach')}>Attach to screen</button>{/if}
    <button class="danger" disabled={actionBusy} onclick={() => action('kill')}>Kill session</button>
  </div>{/if}
  {#key draftKey}<Pane ws={selected.workspace} session={selected} windows={[]} orphans={[]} allNames={sessions.map(s => s.session)} {workspaces} active={true} {onstatus} onchanged={refresh} bind:draft={drafts[draftKey]} />{/key}
{:else}
<main bind:this={main} class:screens-view={route.view === 'screens' && caps.windows && connection === 'ready'}>
  {#if route.view === 'add'}
    <AddMachine bind:draft={pairingDraft} onpaired={paired} oncancel={cancel} />
  {:else if route.view === 'new'}
    <h1 tabindex="-1">New session</h1>
    {#key hosts.current}<NewSession taken={sessions.map(s => s.session)} bind:draft={creationDrafts[hosts.current]} onchanged={created} oncancel={cancel} />{/key}
  {:else if route.view === 'management'}
    {#key hosts.current}<Management {onstatus} connected={connection === 'ready'} />{/key}
  {:else if connection !== 'ready'}
    {#if connection === 'loading'}<h1 tabindex="-1">Loading sessions…</h1><p role="status">Connecting to {displayName()}.</p>
    {:else if connection === 'auth'}<h1 tabindex="-1">Authentication required</h1><p>Pair this device with {displayName()} to continue.</p><button class="primary" onclick={() => { pairingDraft.address = currentHost().origin; navigate('add'); }}>Pair this machine</button>
    {:else if connection === 'offline'}<h1 tabindex="-1">Machine offline</h1><p>Cannot reach {displayName()}. Check the machine and your Tailscale connection.</p><button onclick={refresh}>Retry connection</button>
    {:else}<h1 tabindex="-1">Could not load sessions</h1><button onclick={refresh}>Try again</button>{/if}
  {:else if route.view === 'screens' && caps.windows}
    <h1 tabindex="-1">Screens</h1>
    <label>Desktop workspace<select aria-label="Desktop workspace" value={screen} onchange={e => showScreen(e.currentTarget.value)}>{#each workspaces as n}<option value={n}>Screen {n}</option>{/each}</select></label>
    {#if locked}<p class="dim">Desktop locked. Screenshots are unavailable.</p>
      {#if caps.unlock}<form onsubmit={unlock}><label>Desktop password<input type="password" bind:value={password} autocomplete="current-password" /></label><button disabled={unlocking || !password}>{unlocking ? 'Unlocking…' : 'Unlock desktop'}</button></form>{/if}
    {/if}
    <div class="screen-rail" bind:this={screenRail} onscroll={onScreenScroll} aria-label="Desktop screens">
      {#each workspaces as n}
        <section class="screen-page" aria-label={`Screen ${n}`} aria-hidden={n !== screen} inert={n !== screen}>
          {#each sessions.filter(s => s.workspace === n) as s (s.session)}<button class="session-row" onclick={() => open(s)}>{s.session} · Open terminal</button>{/each}
          {#each windows.filter(w => w.workspace === n) as win (win.address)}<WindowRow {win} {workspaces} {onstatus} onchanged={refresh} />{:else}<p class="dim">No windows on Screen {n}.</p>{/each}
          <button id={`new-session-${n}`} class="primary screen-new" onclick={() => create(n, `new-session-${n}`)}>New session</button>
        </section>
      {/each}
    </div>
  {:else if route.view === 'terminal'}
    <h1 tabindex="-1">Session closed</h1><p>This session is no longer running.</p><button onclick={() => home()}>Back to sessions</button>
  {:else}
    <div class="heading"><h1 tabindex="-1">Sessions</h1><button aria-label="Refresh sessions" onclick={refresh}>Refresh</button></div>
    {#if attentionItems.length}
      <section class="attention" aria-labelledby="attention-title">
        <h2 id="attention-title">Needs attention on another machine</h2>
        {#each attentionItems as item (`${item.host.origin}:${item.session}`)}
          <button class="attention-row" onclick={() => openAttention(item)}>
            <span class="row-title"><strong>{item.session}</strong><span class="err">Needs you</span></span>
            <span class="dim">{displayName(item.host)}{item.tool ? ` · ${item.tool}` : ''}</span>
            {#if item.detail}<span>{item.detail}</span>{/if}
          </button>
        {/each}
      </section>
    {/if}
    {#each ordered as s (s.session)}
      <button id={`session-${s.session}`} class="session-row" onclick={() => open(s)}>
        <span class="row-title"><strong>{s.session}</strong><span class:err={s.state === 'blocked'} class="dim">{s.state === 'blocked' ? 'Needs you' : s.state === 'working' ? 'Working' : s.state === 'done' ? 'Ready' : 'Terminal'}</span></span>
        <span class="dim">{s.workspace == null ? 'No desktop window' : `Screen ${s.workspace}`} · {tilde(s.path) || s.command || 'Terminal'}</span>
        {#if s.state === 'blocked' && (s.tool || s.detail)}<span>{s.tool ? `${s.tool}: ` : ''}{s.detail ?? ''}</span>{/if}
      </button>
    {:else}<p>No sessions yet. Start a session to open a terminal on this machine.</p>{#if caps.shellHook === false}<p class="dim">Sessions started outside tmux are not visible here.</p>{/if}{/each}
    <button id="new-session" class="primary sticky" onclick={create}>New session</button>
  {/if}
</main>
{/if}

<style>
header { display:flex; gap:.6rem; align-items:end; padding:.5rem .7rem; border-bottom:1px solid var(--line); flex:none; }
.picker { flex:1; min-width:0; font-size:12px; gap:.2rem; }
.picker select { width:100%; }
header button { flex:none; font-size:12px; }
nav,.terminal-nav { display:flex; gap:.4rem; padding:.4rem .7rem; flex:none; }
.terminal-nav button { font-size:12px; }
nav button { flex:1; min-width:0; }
.active { color:var(--ok); border-color:var(--ok); }
main { flex:1; min-height:0; overflow:auto; padding:.7rem; display:flex; flex-direction:column; gap:.7rem; overflow-wrap:anywhere; }
main > :global(*) { flex-shrink:0; }
.screens-view { overflow:hidden; }
.screens-view > .screen-rail {
  display:flex; flex:1 1 auto; min-width:0; min-height:0; overflow-x:auto;
  scroll-snap-type:x mandatory; overscroll-behavior-x:contain;
  scrollbar-width:none;
}
.screen-rail::-webkit-scrollbar { display:none; }
.screen-rail:has(:global(.lightbox)) { overflow-x:hidden; scroll-snap-type:none; }
.screen-page {
  flex:0 0 100%; width:100%; min-width:0; min-height:0; overflow-y:auto;
  display:flex; flex-direction:column; gap:.7rem;
  scroll-snap-align:start; scroll-snap-stop:always; overscroll-behavior-y:contain;
}
.screen-page > :global(*) { flex-shrink:0; }
.screen-new { margin-top:auto; }
.heading,.row-title { display:flex; justify-content:space-between; align-items:center; gap:.5rem; }
.session-row,.attention-row { display:flex; flex-direction:column; align-items:stretch; gap:.35rem; text-align:left; width:100%; background:var(--card); padding:.85rem; overflow-wrap:anywhere; }
.row-title strong { min-width:0; color:var(--ok); }
.row-title > span { flex:none; font-size:12px; }
.session-row > .dim,.attention-row > .dim { font-size:12px; }
.attention { display:flex; flex-direction:column; gap:.5rem; padding:.65rem; border:1px solid var(--err); border-radius:var(--radius); }
.attention h2 { margin:0; font-size:14px; color:var(--err); }
.attention-row { background:color-mix(in srgb, var(--err) 7%, var(--card)); }
.sticky { position:sticky; bottom:0; margin-top:auto; background:var(--panel); }
.feedback { padding:.4rem .7rem; overflow-wrap:anywhere; flex:none; font-size:12px; }
.session-menu { padding:.7rem; display:flex; flex-wrap:wrap; gap:.5rem; max-height:45%; overflow:auto; }
.session-menu label { flex:1; min-width:140px; }
@media(max-height:480px) { header { padding:.2rem .5rem; } .picker { flex-direction:row; align-items:center; } nav,.terminal-nav { padding:.2rem .5rem; } }
</style>
