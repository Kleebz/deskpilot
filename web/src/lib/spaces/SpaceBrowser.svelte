<script>
  import { spacesFor, taskFor, findWork, draftKey, hiddenWork } from './model.js';
  import { statusLabel } from './model.js';
  export let state;
  export let open;
  export let create;
  export let manage;
  export let openTask;
  export let computer;
  export let coverage;
  export let drawer = false;
  export let onchange = null;
  export let actions = null;
  export let onvisibility = null;
  $: host = state.computers.find(h => h.id === state.computer);
  $: spaces = spacesFor(state);
  $: results = findWork(state, state.workQuery || '', !!state.workNeeds, !!state.workAcross);
  $: hiddenCount = state.items.filter(i=>!i.closed && hiddenWork(state,i) && (state.workAcross || i.computer===state.computer)).length;
  $: searching = !!state.workQuery?.trim() || state.workNeeds || state.workAcross;
  $: recent = state.recent.map(id => state.items.find(i => i.id === id && !i.closed && !hiddenWork(state,i) && i.computer === state.computer)).filter(Boolean).slice(0,3);
  $: needs = findWork(state,'',true,!!state.workAcross).length;
  function update(values) { if(onchange)onchange(values);else state = { ...state, ...values }; }
  function expand(id) { update({ workExpanded: { ...state.workExpanded, [id]: !expanded(id) } }); }
  function expanded(id) { return state.workExpanded?.[id] ?? (id.startsWith('available:') ? false : id.startsWith('hidden:') ? true : id === taskFor(state,state.items.find(i => i.id === state.selected && i.computer===state.computer))?.space.id || id.startsWith('unassigned:')); }
</script>

<div class="space-browser" class:drawer>
  <div class="space-browser-heading"><div><span class="eyebrow">YOUR WORK</span><h1>Spaces</h1></div><div class="space-heading-actions"><button class="space-computer" aria-label="Computer tools" onclick={computer}><i class:online={host.health==='online'}></i>{host.name} ⌄</button>{#if actions}<button class="work-actions-button" aria-label="Work actions" onclick={actions}>⋯</button>{/if}</div></div>
  <label class="search"><span>⌕</span><input aria-label="Search spaces and work" placeholder="Find a space, task, or terminal" value={state.workQuery || ''} oninput={e => update({workQuery:e.currentTarget.value})} /></label>
  <div class="space-filters"><button aria-pressed={!state.workNeeds} class:chosen={!state.workNeeds} onclick={()=>update({workNeeds:false})}>All work</button><button aria-pressed={!!state.workNeeds} class:chosen={state.workNeeds} onclick={()=>update({workNeeds:!state.workNeeds})}>Needs you <span>{needs}</span></button></div>
  <label class="space-across"><input type="checkbox" checked={!!state.workAcross} onchange={e=>update({workAcross:e.currentTarget.checked})}/>Across computers</label>
  {#if hiddenCount}<label class="space-across"><input aria-label="Show hidden conversations" type="checkbox" checked={!!state.workShowHidden} onchange={e=>update({workShowHidden:e.currentTarget.checked})}/>Show hidden ({hiddenCount})</label>{/if}
  {#if searching}
    <p class="space-result-count">{results.length} {results.length===1?'result':'results'} · {state.workAcross?'all computers':host.name}</p>
    {#each results as item (draftKey(item))}
      {@const context=taskFor(state,item)}
      <div class="space-result-row"><button class="space-result" data-item={item.id} onclick={()=>open(item)}><span><strong>{item.name}</strong><small>{state.computers.find(h=>h.id===item.computer)?.name} · {context?.space.name} / {context?.tab.name}</small><small>{item.source} · {item.cwd}</small></span><span class:needs={item.status==='needs'}>{state.computers.find(h=>h.id===item.computer)?.health!=='online'?'Offline':statusLabel[item.status]}<small>{item.viewOnly?'Desktop only':item.connected?'Open':'Connect'} ↗</small>{#if hiddenWork(state,item)}<small>Hidden</small>{/if}</span></button>{#if onvisibility && item.source==='Codex'}<button class="visibility-button" aria-label={`${hiddenWork(state,item)?'Restore':'Hide'} conversation: ${item.name}`} onclick={()=>onvisibility(item,!hiddenWork(state,item))}>{hiddenWork(state,item)?'Restore':'Hide'}</button>{/if}</div>
    {:else}<p class="muted space-empty">No matching work. Unknown or offline status does not mean all-clear.</p>{/each}
    <button class="text-link" onclick={coverage}>Status and coverage details →</button>
  {:else}
    {#if !drawer && recent.length}<div class="space-section-label">RECENT</div>{#each recent as item (item.id)}<button class="space-recent" data-item={item.id} onclick={()=>open(item)}><span><strong>{item.name}</strong><small>{taskFor(state,item)?.space.name} · {item.source}</small></span><span>↗</span></button>{/each}{/if}
    <div class="space-section-heading"><span class="space-section-label">{host.name.toUpperCase()}</span><button aria-label="New space" onclick={create}>＋ New space</button></div>
    {#each spaces as space (space.id)}
      {@const count=space.tabs.reduce((n,t)=>n+t.items.length,0)}
      {@const alerts=space.tabs.flatMap(t=>t.items).filter(i=>i.status==='needs').length}
      <section class="space-group" data-space={space.id}>
        <div class="space-group-header"><button class="space-expand" aria-label={`Toggle ${space.name}`} aria-expanded={expanded(space.id)} onclick={()=>expand(space.id)}><span class="space-chevron">{expanded(space.id)?'⌄':'›'}</span><span><strong>{space.name}</strong><small>{space.native?'Herdr':space.available?'Codex · Available to open':space.hidden?'Codex · Hidden from lists':space.unassigned?'Ready to organize':'Deskpilot'} · {count} {space.available||space.hidden?(count===1?'conversation':'conversations'):(count===1?'terminal':'terminals')}</small></span>{#if alerts}<span class="space-count">{alerts}</span>{/if}</button>{#if !space.unassigned&&!space.available&&!space.hidden}<button class="icon-button" aria-label={`Manage space: ${space.name}`} onclick={()=>manage(space)}>⋯</button>{/if}</div>
        {#if expanded(space.id)}<div class="space-task-list">{#each space.tabs as tab (tab.id)}
          <div class="space-task"><div class="space-task-row"><button id={tab.items[0]?.session?`session-${tab.items[0].session}`:undefined} data-session={tab.items[0]?.session} data-item={tab.items[0]?.id} class:current={tab.items.some(i=>i.id===state.selected)} aria-label={`${space.available||space.hidden?'Open conversation':'Open task'}: ${tab.name}`} onclick={()=>openTask(space,tab)}><span>▱</span><span><strong>{tab.name}</strong><small>{space.available||space.hidden?`${tab.items[0]?.connected?'Mobile view attached':'Available to connect'} · ${tab.items[0]?.cwd||'Codex'}`:tab.items.length?`${tab.items.length} ${tab.items.length===1?'terminal':'terminals'}`:'Add work'}{tab.items.some(i=>i.status==='needs')?' · Needs you':''}</small></span><span>↗</span></button>{#if onvisibility&&(space.available||space.hidden)}<button class="visibility-button" aria-label={`${space.hidden?'Restore':'Hide'} conversation: ${tab.items[0].name}`} onclick={()=>onvisibility(tab.items[0],!space.hidden)}>{space.hidden?'Restore':'Hide'}</button>{/if}</div>
          {#if tab.items.length>1}<div class="space-pane-list">{#each tab.items as item (draftKey(item))}<button data-item={item.id} onclick={()=>open(item)}><span class:needs={item.status==='needs'}>●</span><span>{item.name}<small>{item.source} · {item.connected?'Open':'Connect'}</small></span><span>↗</span></button>{/each}</div>{/if}</div>
        {:else}<p class="space-empty muted">No tasks yet. Add a task from this space’s menu.</p>{/each}
        {#if space.available}<p class="space-empty muted">Codex can keep conversations available after their desktop windows close. Hiding one keeps its work and drafts.</p>{/if}
        {#if space.unassigned}<p class="space-empty muted">Move work into a space from its terminal menu. Names and folders never group it automatically.</p>{/if}</div>{/if}
      </section>
    {/each}
    <button class="text-link" onclick={coverage}>Attention coverage →</button>
  {/if}
</div>

<style>
.space-result-row,.space-task-row{display:flex;align-items:center;gap:8px;min-width:0}.space-result-row>.space-result,.space-task-row>button:first-child{flex:1;min-width:0}.space-browser .visibility-button{flex:none;min-height:44px;min-width:44px;padding:0 6px;font-size:11px;color:var(--muted)}
.space-browser button{border:0;text-align:left;justify-content:flex-start}.space-browser .search,.space-browser .space-across{flex-direction:row}.space-browser .space-expand,.space-browser .space-task-row>button:first-child,.space-browser .space-pane-list button{justify-content:flex-start}.space-browser .space-computer{border:1px solid var(--line);border-radius:10px}.space-browser .icon-button{min-width:44px;justify-content:center}.space-browser .work-actions-button{justify-content:center}
.space-browser{--muted:var(--dim,#a1ad99);--lime:var(--ok,#c7ef92);--orange:var(--warn,#efb38c)}.search{display:flex;align-items:center;gap:10px}.search input{flex:1;min-width:0;width:100%;min-height:46px;padding:12px;border:1px solid var(--line);border-radius:9px}.search>span{color:var(--muted);font-size:20px}
.space-heading-actions{display:flex;align-items:center;gap:4px;max-width:65%}.space-heading-actions .space-computer{max-width:none}.work-actions-button{width:44px;min-width:44px;justify-content:center;font-size:22px;border:0}
.space-browser-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:4px 0 20px}.space-browser-heading h1{font-size:30px;margin:5px 0 0;letter-spacing:-1px}.space-computer{font-size:12px;max-width:55%;overflow-wrap:anywhere;justify-content:flex-end}.space-filters{display:flex;gap:6px;border-bottom:1px solid var(--line);padding:8px 0}.space-filters button{padding:0 12px;font-size:12px;border-radius:7px;color:var(--muted)}.space-filters .chosen{background:#303d25;color:var(--lime)}.space-filters span,.space-count{color:var(--orange);font-size:10px}.space-across{display:flex;align-items:center;gap:9px;min-height:44px;font-size:11px;color:var(--muted)}.space-across input{width:44px;height:44px;min-height:44px;margin:0;appearance:none;padding:0;border:0;background:transparent;display:grid;place-content:center}.space-across input::before{content:"";width:18px;height:18px;border:1px solid #68775a;border-radius:4px;background:#171c16}.space-across input:checked::before{background:var(--lime);box-shadow:inset 0 0 0 4px #171c16}.space-section-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:10px}.space-section-label{font-size:9px;letter-spacing:1.5px;color:var(--muted);padding:12px 0}.space-section-heading>button{font-size:11px;color:var(--lime)}.space-group{border-bottom:1px solid var(--line)}.space-group-header{display:flex;align-items:center;gap:6px}.space-expand{flex:1;padding:13px 0;gap:10px}.space-expand>span:nth-child(2){flex:1}.space-expand strong,.space-task strong,.space-recent strong,.space-result strong{display:block;font-size:13px;font-weight:550;overflow-wrap:anywhere}.space-expand small,.space-task small,.space-recent small,.space-result small{display:block;color:var(--muted);font-size:10px;margin-top:4px;overflow-wrap:anywhere}.space-chevron{width:14px;color:var(--muted)}.space-task-list{padding:0 0 8px 15px}.space-task-row>button:first-child{width:100%;padding:10px 8px;gap:10px;border-radius:7px}.space-task-row>button:first-child>span:nth-child(2){flex:1}.space-task-row>button:first-child>span:last-child{font-size:12px;color:var(--muted)}.space-task .current{background:#293421;color:var(--lime)}.space-pane-list{border-left:1px solid #46563a;margin:0 0 10px 15px;padding-left:10px}.space-pane-list button{width:100%;gap:8px;font-size:12px;padding:8px 4px}.space-pane-list button>span:nth-child(2){flex:1;overflow-wrap:anywhere}.space-pane-list small{display:block;font-size:10px;color:var(--muted);margin-top:3px}.needs{color:var(--orange)}.space-empty{font-size:11px;line-height:1.6;padding:10px 4px;margin:0}.space-recent,.space-result{width:100%;padding:13px 0;justify-content:space-between;gap:12px;border-bottom:1px solid var(--line)}.space-result>span:first-child{flex:1}.space-result>span:last-child{max-width:30%;text-align:right;font-size:10px}.space-result-count{font-size:11px;color:var(--muted);margin-top:14px}.space-recent>span:last-child{color:var(--lime)}.text-link{font-size:11px;margin-top:10px}
</style>
