<script>
  import { onMount, onDestroy, untrack } from 'svelte';
  import { post } from './api.js';
  import { currentHost } from './hosts.svelte.js';
  import { stateLabel } from './herdr-groups.js';
  let { management, terminals, host, target, onclose, onchanged } = $props();
  let chosen = $state(untrack(() => target)), mode = $state(untrack(() => target.mode ?? 'menu'));
  let dialog = $state(null), busy = $state(false), error = $state('');
  let name = $state(''), folder = $state(''), command = $state('bash'), direction = $state('right'), review = $state(null);
  let trail = $state([]);
  let alive = true;
  const actionHost = untrack(() => currentHost());
  const space = $derived(management?.spaces?.find(s => s.id === chosen.spaceId));
  const tab = $derived(space?.tabs.find(t => t.id === chosen.tabId));
  const terminal = $derived(terminals.find(t => t.id === chosen.terminalId));
  const title = $derived(chosen.kind === 'library' ? 'Herdr spaces & tabs' : chosen.kind === 'terminal' ? terminal?.title ?? 'Herdr terminal' : chosen.kind === 'tab' ? tab?.title ?? 'Herdr tab' : space?.title ?? 'New Herdr space');
  const canWrite = $derived(!!management?.writable);
  function pick(next) { trail=[...trail,{...chosen}]; chosen = next; mode = 'menu'; error = ''; review = null; }
  function back() {
    error=''; review=null;
    if(mode!=='menu' && chosen.spaceId) {mode='menu';return;}
    if(trail.length) {chosen=trail.at(-1);trail=trail.slice(0,-1);}
    else if(chosen.kind==='terminal' && terminal?.tab) chosen={kind:'tab',spaceId:terminal.space.id,tabId:terminal.tab.id};
    else if(chosen.kind==='tab') chosen={kind:'space',spaceId:chosen.spaceId};
    else chosen={kind:'library'};
    mode='menu';
  }
  function select(next) {
    error = ''; mode = next;
    name = next === 'rename' ? (chosen.kind === 'space' ? space?.title : tab?.title) ?? '' : '';
    folder = space?.path || management?.spaces?.find(s=>s.id===management.activeSpace)?.path || terminals[0]?.path || '';
    command = 'bash';
    if (next === 'close' || next === 'stop') {
      const ids = chosen.kind === 'space' ? space?.tabs.flatMap(t => t.terminals) ?? [] : chosen.kind === 'tab' ? tab?.terminals ?? [] : [chosen.terminalId];
      review = { core: management.core, expected: chosen.kind === 'terminal' ? terminal?.id : (chosen.kind === 'space' ? space?.revision : tab?.revision), items: terminals.filter(t => ids.includes(t.id)).map(t => ({id:t.id,title:t.title,state:t.state})), panes: chosen.kind === 'space' ? space?.tabs.reduce((n,t)=>n+t.panes,0) : tab?.panes, lastTab: chosen.kind === 'tab' && space?.tabs.length === 1 };
    }
  }
  onMount(() => { dialog.showModal(); if (mode !== 'menu') select(mode); });
  onDestroy(() => { alive = false; });
  async function act(action, extra = {}) {
    if (busy || !canWrite) return;
    busy = true; error = '';
    try {
      await post('/herdr/action', { core: management.core, spaceId: chosen.spaceId, tabId: chosen.tabId, terminalId: chosen.terminalId, action, ...extra }, {host:actionHost,timeoutMs:20000});
      if (!alive) return;
      await onchanged(action);
      if (alive) onclose();
    } catch(e) { if (alive) error = e.message; }
    finally { if (alive) busy = false; }
  }
  function submit(e) {
    e.preventDefault();
    if (mode === 'rename') return act(`${chosen.kind}.rename`,{name});
    if (mode === 'new-space') return act('space.new',{name,folder,command});
    if (mode === 'new-tab') return act('tab.new',{name,folder,command});
    if (mode === 'split') return act('pane.split',{folder,command,direction});
  }
</script>

<dialog bind:this={dialog} oncancel={e => { e.preventDefault(); if (!busy) onclose(); }} aria-labelledby="herdr-action-title">
  <div class="dialog-heading"><h2 id="herdr-action-title">{title}</h2><button class="sm" disabled={busy} onclick={onclose}>Close</button></div>
  <div class="context" aria-label="Herdr action location"><span>Herdr{space?` › Space: ${space.title}`:''}{tab?` › Tab: ${tab.title}`:''}{chosen.kind==='terminal'?' › Terminal':''}</span>{#if chosen.kind!=='library'||mode!=='menu'}<button class="sm" disabled={busy} onclick={back}>Back</button>{/if}</div>
  {#if !canWrite}<p class="dim">{management?.reason || 'Herdr management is unavailable. Running terminals remain accessible.'}</p>{/if}
  {#if mode === 'menu'}
    <div class="actions">
      {#if chosen.kind === 'library'}
        <button class="primary" disabled={!canWrite} onclick={() => { pick({kind:'space'}); select('new-space'); }}>+ Space</button>
        {#each management?.spaces ?? [] as s (s.id)}
          <button onclick={() => pick({kind:'space',spaceId:s.id})}>{s.title}<span class="dim">{s.tabs.length} tabs</span></button>
          {#each s.tabs as t (t.id)}<button class="tab-entry" onclick={() => pick({kind:'tab',spaceId:s.id,tabId:t.id})}>{t.title}<span class="dim">{t.terminals.length} terminals</span></button>{/each}
        {/each}
      {:else if chosen.kind === 'space'}
        <button disabled={!canWrite} onclick={() => select('new-tab')}>+ Tab</button>
        <button disabled={!canWrite} onclick={() => select('rename')}>Rename space</button>
        <button disabled={!canWrite || space?.order === 0} onclick={() => act('space.move',{index:space.order})}>Move space earlier</button>
        <button disabled={!canWrite || space?.order >= (management?.spaces.length ?? 0)-1} onclick={() => act('space.move',{index:space.order+2})}>Move space later</button>
        <button class="danger" disabled={!canWrite} onclick={() => select('close')}>Close space…</button>
      {:else if chosen.kind === 'tab'}
        <button disabled={!canWrite || !tab?.pane} onclick={() => select('split')}>+ Terminal in this tab</button>
        <button disabled={!canWrite} onclick={() => select('rename')}>Rename tab</button>
        <button disabled={!canWrite || tab?.order === 0} onclick={() => act('tab.move',{index:tab.order})}>Move tab earlier</button>
        <button disabled={!canWrite || tab?.order >= (space?.tabs.length ?? 0)-1} onclick={() => act('tab.move',{index:tab.order+2})}>Move tab later</button>
        <p class="dim hint">This Herdr version supports reordering within a space. Moving a tab to another space is unavailable.</p>
        <button class="danger" disabled={!canWrite} onclick={() => select('close')}>Close tab…</button>
      {:else}
        {#if terminal?.tab}<button onclick={() => pick({kind:'tab',spaceId:terminal.space.id,tabId:terminal.tab.id})}>Tab actions · {terminal.tab.title}</button>{/if}
        {#if !space}<p class="dim hint">This core terminal has no managed Herdr space. Its mobile view can still be disconnected.</p>{/if}
        <button class="danger" disabled={!canWrite || !space} onclick={() => select('stop')}>Stop Herdr terminal…</button>
      {/if}
    </div>
  {:else if mode === 'close' || mode === 'stop'}
    <h3>{mode === 'stop' ? 'Stop this running terminal?' : `Close this ${chosen.kind}?`}</h3>
    <p>This stops the original programs in Herdr, including any running agent work.</p>
    <ul>{#each review?.items ?? [] as item (item.id)}<li><strong>{item.title}</strong><span class="dim">{stateLabel(item.state)}</span></li>{/each}</ul>
    {#if (review?.panes ?? 0) > (review?.items.length ?? 0)}<p class="dim">This also closes the tab's other panes.</p>{/if}
    {#if review?.lastTab}<p class="warning">This is the last tab. Closing it also closes the space.</p>{/if}
    <div class="confirmation"><button disabled={busy} onclick={back}>Keep running</button><button class="danger" disabled={busy || !canWrite} onclick={() => act(mode === 'stop' ? 'terminal.stop' : `${chosen.kind}.close`, {core:review.core,expected:review.expected})}>{busy ? 'Closing…' : 'Stop & close'}</button></div>
  {:else}
    <form onsubmit={submit}>
      <h3>{({rename:'Rename', 'new-space':'New space', 'new-tab':'New tab', split:'New terminal in this tab'})[mode]}</h3>
      {#if mode !== 'split'}<label>Name<input aria-label="Herdr name" maxlength="160" bind:value={name} placeholder="Leave empty for Herdr's automatic name" /></label>{/if}
      {#if mode !== 'rename'}
        <label>Folder<input aria-label="Herdr folder" bind:value={folder} required placeholder="/home/you/project" /></label>
        <label>Program<select aria-label="Herdr program" value={['bash','codex --no-alt-screen','claude','opencode'].includes(command)?command:'custom'} onchange={e=>command=e.currentTarget.value==='custom'?'':e.currentTarget.value}><option value="bash">Terminal</option><option value="codex --no-alt-screen">Codex</option><option value="claude">Claude</option><option value="opencode">OpenCode</option><option value="custom">Custom command</option></select></label>
        <label>Command to run<input aria-label="Herdr command" bind:value={command} maxlength="4096" required /></label>
        {#if mode === 'split'}<label>Split direction<select bind:value={direction}><option value="right">Right</option><option value="down">Down</option></select></label>{/if}
      {/if}
      <div class="form-actions"><button type="button" disabled={busy} onclick={back}>Cancel</button><button class="primary" disabled={!canWrite || busy || (mode !== 'rename' && !folder.startsWith('/'))}>{busy ? 'Saving…' : mode === 'rename' ? 'Save name' : 'Create'}</button></div>
    </form>
  {/if}
  {#if error}<p class="error" role="alert">{error}</p><button disabled={busy} onclick={async () => { await onchanged(); if (alive) {mode='menu';error='';} }}>Refresh Herdr</button>{/if}
</dialog>

<style>
  dialog { color:var(--fg); background:var(--bg); border:1px solid var(--card-line); border-radius:12px; width:min(440px,calc(100vw - 20px)); max-height:calc(100dvh - 24px); overflow:auto; padding:14px; }
  dialog::backdrop { background:rgb(0 0 0 / .7); }
  .dialog-heading { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:12px; }
  h2,h3 { margin:0; overflow-wrap:anywhere; } h2 { font-size:16px; } h3 { font-size:14px; }
  .context {display:flex;align-items:center;gap:8px;justify-content:space-between;margin-bottom:12px;font-size:12px;color:var(--dim);overflow-wrap:anywhere;} .context span {min-width:0;} .context button {flex:none;}
  .actions,form,.confirmation { display:flex; flex-direction:column; gap:10px; }
  .actions button { justify-content:space-between; text-align:left; gap:8px; overflow-wrap:anywhere; }
  .actions button span { font-size:11px; } .tab-entry { margin-left:12px; width:calc(100% - 12px); }
  form input,form select { width:100%; } .hint { font-size:12px; }
  ul { padding-left:20px; } li { margin:10px 0; overflow-wrap:anywhere; } li span { display:block; font-size:12px; }
  .error { color:var(--err); overflow-wrap:anywhere; } .warning { color:var(--warn); } .confirmation { margin-top:14px; }
</style>
