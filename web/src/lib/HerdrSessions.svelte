<script>
  import { untrack } from 'svelte';
  import { tilde } from './api.js';
  import { groupHerdr, needsAttention, stateLabel } from './herdr-groups.js';
  import HerdrActions from './HerdrActions.svelte';
  let { terminals, host, connecting = '', onconnect, management = null, onchanged, filter = 'all', notice = '' } = $props();
  const storageKey = untrack(() => `dp_herdr_view_v2:${host}`);
  function saved() { try { const v=JSON.parse(localStorage.getItem(storageKey));return v && typeof v==='object' && !Array.isArray(v) ? v : {}; } catch { return {}; } }
  const initial = saved();
  let expandedSpaces = $state(initial.expanded ?? {}), selectedTabs = $state(initial.tabs ?? {}), folded = $state(!!initial.folded);
  let searching=$state(false), query=$state(''), action=$state(null), defaultSpace=$state('');
  const base = $derived(groupHerdr(terminals));
  const allGroups = $derived.by(() => {
    const groups=(management?.spaces ?? []).map(space=>({ ...space, tabs:space.tabs.map(tab=>({...tab,terminals:terminals.filter(t=>t.space?.id===space.id&&t.tab?.id===tab.id)})) }));
    for (const group of base) if(!groups.some(s=>s.id===group.id))groups.push(group);
    return groups.map(g=>({...g,terminals:g.tabs.flatMap(t=>t.terminals),attention:g.tabs.flatMap(t=>t.terminals).filter(needsAttention).length}));
  });
  const groups = $derived.by(() => {
    const search=query.trim().toLowerCase();
    return allGroups.map(g=>({...g,tabs:g.tabs.map(t=>({...t,terminals:t.terminals.filter(item=>(filter==='all'||(filter==='blocked'?needsAttention(item):item.state==='working'))&&(!search||[item.title,item.path,item.agent,g.title,t.title].some(v=>String(v??'').toLowerCase().includes(search))))})).filter(t=>t.terminals.length||(!search&&filter==='all'))})).filter(g=>g.tabs.length||(!search&&filter==='all')).map(g=>({...g,terminals:g.tabs.flatMap(t=>t.terminals),attention:g.tabs.flatMap(t=>t.terminals).filter(needsAttention).length}));
  });
  $effect(() => { if(!defaultSpace&&management?.spaces?.length)defaultSpace=management.activeSpace || management.spaces[0].id; });
  function save() { try {localStorage.setItem(storageKey,JSON.stringify({expanded:expandedSpaces,tabs:selectedTabs,folded}));}catch{} }
  function expanded(g) { return filter!=='all'||!!query.trim()||(expandedSpaces[g.id]??g.id===(defaultSpace||allGroups[0]?.id)); }
  function toggle(g) {expandedSpaces={...expandedSpaces,[g.id]:!expanded(g)};save();}
  function active(g) {return g.tabs.find(t=>t.id===selectedTabs[g.id])??g.tabs.find(t=>t.id===management?.activeTab)??g.tabs[0];}
  function tab(g,id) {selectedTabs={...selectedTabs,[g.id]:id};save();}
  function manage(kind,spaceId,tabId,mode='menu') {action={kind,spaceId,tabId,mode};}
  function terminalRows(g,t) {return t?.terminals??[];}
</script>

<section class="herdr-terminals" tabindex="-1" aria-label="Herdr">
  <div class="section-heading">
    <button class="herdr-toggle" aria-expanded={!folded || filter!=='all' || !!query} onclick={() => {folded=!folded;save();}}><strong>{folded && filter==='all' && !query ? '›' : '⌄'} Herdr</strong><span class="dim">{groups.length} spaces · {groups.reduce((n,g)=>n+g.tabs.reduce((n,t)=>n+t.terminals.length,0),0)} {filter==='all'&&!query?'terminals':'matching terminals'}</span></button>
    {#if filter==='all'}<button class="sm primary" disabled={!management?.writable} onclick={() => manage('space',null,null,'new-space')}>+ Space</button>
    <button class="sm" aria-label="Manage Herdr spaces and tabs" onclick={() => manage('library')}>Manage</button>{/if}
  </div>
  {#if !management?.writable && management?.reason}<p class="availability dim">{management.reason}</p>{/if}
  {#if notice}<p class="availability warning" role="status">{notice}</p>{/if}
  {#if !folded || filter!=='all' || !!query}
    <div class="search"><button class="sm" aria-label="Find Herdr terminal" aria-expanded={searching} onclick={() => {searching=!searching;if(!searching)query='';}}>Find</button>{#if searching}<input type="search" aria-label="Search Herdr terminals" placeholder="Space, tab, agent or project…" bind:value={query} />{/if}</div>
    {#each groups as group (group.id)}
      {@const current=active(group)}
      <article class="herdr-space" data-space={group.id}>
        <div class="space-heading"><button class="space-toggle" aria-expanded={expanded(group)} onclick={() => toggle(group)}><span class="chevron" aria-hidden="true">{expanded(group)?'⌄':'›'}</span><span class="space-info"><span class="dim kind">{group.id==='unplaced'?'Unplaced terminals':'Space'}</span><strong>{group.title}</strong><span class="dim kind">{group.tabs.length} tabs · {group.terminals.length} terminals</span></span>{#if group.attention}<span class="needs kind">{group.attention} needs you</span>{/if}</button>{#if group.id!=='unplaced'}<button class="overflow sm" aria-label={`Space actions: ${group.title}`} onclick={() => manage('space',group.id)}>•••</button>{/if}</div>
        {#if expanded(group)}
          <div class="space-body">
            <div class="tabs" aria-label={`Herdr tabs in ${group.title}`}>
              {#each group.tabs as t (t.id)}<button class:chosen={current?.id===t.id} class="sm tab" aria-pressed={current?.id===t.id} onclick={() => tab(group,t.id)}>{t.title||'Terminals'}</button>{/each}
              {#if group.id!=='unplaced'}<button class="sm" aria-label={`Add tab to ${group.title}`} disabled={!management?.writable} onclick={() => manage('space',group.id,null,'new-tab')}>+</button>{#if current}<button class="sm" aria-label={`Tab actions: ${current.title}`} onclick={() => manage('tab',group.id,current.id)}>•••</button>{/if}{/if}
            </div>
            <div class="herdr-tab" data-tab={current?.id}>
              {#each terminalRows(group,current) as terminal,index (terminal.id)}
                <button class="herdr-terminal" class:blocked={needsAttention(terminal)} disabled={!!connecting} aria-label={`Open ${terminal.title}`} onclick={() => onconnect(terminal)} data-terminal={terminal.id}>
                  <span class="pane-index dim" aria-hidden="true">{index+1}</span><span class="terminal-main"><strong>{terminal.title}</strong><span class="terminal-meta"><span>{terminal.agent}</span><span class:needs={needsAttention(terminal)} class:working={terminal.state==='working'}>{connecting===terminal.id?'Opening…':stateLabel(terminal.state)}</span></span>{#if terminal.path && terminal.path!==group.path}<span class="dim path">{tilde(terminal.path)}</span>{/if}</span><span class="open dim" aria-hidden="true">{terminal.session?'Open':'Connect'} ›</span>
                </button>
              {:else}<p class="availability dim">{current?.panes?'This tab contains other panes.':'No live terminals in this tab.'}</p>{/each}
            </div>
            {#if current?.pane}<button class="add-pane" disabled={!management?.writable} onclick={() => manage('tab',group.id,current.id,'split')}>+ Terminal in this tab</button>{/if}
          </div>
        {/if}
      </article>
    {:else}<p class="availability dim">{query.trim()?'No matching Herdr terminals.':'No Herdr terminals match this filter.'}</p>{/each}
  {/if}
</section>
{#if action}<HerdrActions {management} {terminals} {host} target={action} onclose={() => action=null} {onchanged} />{/if}

<style>
  .herdr-terminals { min-width:0; overflow:hidden; border:1px solid var(--card-line); border-top:2px solid var(--ok); border-radius:12px; background:var(--panel); }
  .section-heading,.space-heading { display:flex; align-items:center; min-width:0; gap:5px; padding:7px; }
  .section-heading { border-bottom:1px solid var(--line); }
  .herdr-toggle { flex:1; min-width:0; border:0; background:transparent; padding:4px 2px; display:flex; flex-direction:column; align-items:flex-start; justify-content:center; text-align:left; gap:4px; }
  .herdr-toggle strong { color:var(--ok); font-size:16px; } .herdr-toggle span {font-size:10px;}
  .section-heading > .sm { flex:none; padding-inline:7px; font-size:11px; }
  .herdr-space + .herdr-space { border-top:1px solid var(--line); }
  .space-toggle { flex:1; justify-content:flex-start; border:0; text-align:left; padding:7px 4px; gap:8px; }
  .space-info { display:flex; flex-direction:column; gap:3px; flex:1; min-width:0; }
  .space-info strong { overflow-wrap:anywhere; font-size:13px; }
  .kind { font-size:10px; } .chevron { flex:none; width:12px; }
  .overflow {border:0;flex:none;} .tabs {display:flex;flex-wrap:wrap;gap:4px;padding:5px 7px;border-block:1px solid var(--line);}
  .tabs button {font-size:11px;min-width:44px;padding-inline:8px;border-color:transparent;background:transparent;}
  .tabs .chosen {color:var(--ok);border-color:var(--ok);background:color-mix(in srgb,var(--ok) 8%,transparent);}
  .herdr-terminal {width:100%;border:0;border-radius:0;border-bottom:1px solid var(--line);text-align:left;justify-content:flex-start;gap:10px;padding:12px;min-width:0;background:transparent;}
  .pane-index {font-size:11px;width:16px;flex:none;} .terminal-main {flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;}
  .terminal-main strong {font-size:12px;font-weight:500;overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;}
  .terminal-meta {display:flex;flex-wrap:wrap;gap:5px 10px;font-size:11px;color:var(--dim);}
  .path {font-size:10px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;} .open {flex:none;font-size:10px;}
  .needs,.warning {color:var(--warn);} .working {color:var(--ok);} .blocked {border-left:2px solid var(--warn);}
  .add-pane {width:100%;text-align:left;justify-content:flex-start;border:0;border-radius:0;color:var(--ok);font-size:11px;background:transparent;}
  .availability {font-size:12px;padding:9px 12px;margin:0;overflow-wrap:anywhere;}
  .search {display:flex;gap:5px;align-items:center;padding:4px 7px;}.search button {font-size:11px;border:0;}.search input{flex:1;width:100%;}
</style>
