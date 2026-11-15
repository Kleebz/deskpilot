<script>
  import { spacesFor, taskFor, findWork, draftKey, hiddenWork, statusLabel } from './model.js';
  import { sourceRef, sameSource } from './live-model.js';
  let {state,onchange,open,create,manage,manageTab,emptyTask,computer,coverage,actions}=$props();
  const host=$derived(state.computers.find(h=>h.id===state.computer));
  const spaces=$derived(spacesFor(state));
  const selected=$derived(state.items.find(i=>i.computer===state.computer&&state.selectedRef&&sameSource(sourceRef(i),state.selectedRef)));
  const current=$derived(taskFor(state,selected));
  const searching=$derived(!!state.workQuery?.trim()||state.workNeeds||state.workAcross);
  const results=$derived(findWork(state,state.workQuery||'',!!state.workNeeds,!!state.workAcross));
  const needs=$derived(findWork(state,'',true,!!state.workAcross).length);
  const hiddenCount=$derived(state.items.filter(i=>!i.closed&&hiddenWork(state,i)&&(state.workAcross||i.computer===state.computer)).length);
  function expanded(space){return state.workExpanded?.[space.id]??(space.hidden||(!space.available&&(space.unassigned||space.id===current?.space.id)));}
  function tabKey(space,tab){return 'tab:'+space.id+':'+tab.id;}
  function tabExpanded(space,tab){return state.workExpanded?.[tabKey(space,tab)]??(space.id===current?.space.id&&tab.id===current?.tab.id);}
  function toggle(key,value){onchange({workExpanded:{...state.workExpanded,[key]:!value}});}
  function active(item){return !!selected&&draftKey(selected)===draftKey(item);}
</script>

{#snippet terminal(item,search=false)}
  {@const context=taskFor(state,item)}
  <div class="terminal-row" class:search-result={search}>
    <button id={item.session?'session-'+item.session:undefined} class="open-terminal" class:current={active(item)} class:space-result={search} aria-current={active(item)?'true':undefined} data-item={item.id} data-session={item.session} aria-label={'Open terminal: '+item.name} onclick={()=>open(item)}>
      <span class="terminal-dot" class:needs={item.status==='needs'} aria-hidden="true">●</span>
      <span class="work-label"><strong>{item.name}</strong>
        {#if search}<small>{state.computers.find(h=>h.id===item.computer)?.name} · {context?.space.name||item.source}{context&&!context.space.available&&!context.space.hidden?' / '+context.tab.name:''}</small>{/if}
        <small>{item.raw?.agent||item.source} · {item.viewOnly?'Desktop only':item.connected?'Open':'Connect'} · {statusLabel[item.status]}{hiddenWork(state,item)?' · Hidden':''}</small>
        {#if search}<small>{item.cwd}</small>{/if}
      </span>
    </button>
    {#if item.source==='Codex'}<button class="visibility" aria-label={(hiddenWork(state,item)?'Restore':'Hide')+' conversation: '+item.name} onclick={()=>actions('visibility',item)}>{hiddenWork(state,item)?'Restore':'Hide'}</button>{/if}
  </div>
{/snippet}

<div class="work-navigation" aria-label="Spaces navigation">
  <div class="navigation-brand" aria-hidden="true">DESKPILOT</div>
  <button id="navigation-computer" class="computer-control" aria-label="Computer" onclick={computer}><span class="health-dot" class:online={host?.health==='online'} aria-hidden="true">●</span><span class="work-label"><strong>{host?.name}</strong><small>{host?.health==='online'?'Connected':host?.health==='auth'?'Pairing required':host?.health==='offline'?'Cannot reach':host?.health==='loading'?'Connecting…':host?.health}</small></span><span aria-hidden="true">⌄</span></button>
  {#if host?.observedAt&&host.health!=='online'}<p class="navigation-note">Last observed {new Date(host.observedAt).toLocaleString()}. Displayed work may be stale.</p>{/if}
  <input class="work-search" aria-label="Search spaces and work" placeholder="Search spaces, tabs and work" value={state.workQuery||''} oninput={e=>onchange({workQuery:e.currentTarget.value})}/>
  <div class="work-filters"><button aria-pressed={!state.workNeeds} onclick={()=>onchange({workNeeds:false})}>All work</button><button aria-label="Needs attention" aria-pressed={!!state.workNeeds} onclick={()=>onchange({workNeeds:!state.workNeeds})}>Needs you <span class="count">{needs}</span></button></div>
  <label class="search-scope"><span>Search in</span><select aria-label="Search scope" value={state.workAcross?'all':'computer'} onchange={e=>onchange({workAcross:e.currentTarget.value==='all'})}><option value="computer">This computer</option><option value="all">All computers</option></select></label>
  {#if searching}
    <p class="results-count">{results.length} {results.length===1?'result':'results'} · {state.workAcross?'All computers':host?.name}</p>
    {#each results as item (draftKey(item))}{@render terminal(item,true)}{:else}<p class="navigation-note">No matching work. Unknown or unavailable status does not mean all-clear.</p>{/each}
  {:else}
    <div class="tree-heading"><span>SPACES</span><button aria-label="New space" onclick={create}>＋ New space</button></div>
    {#each spaces as space (space.id)}
      {@const count=space.tabs.reduce((n,t)=>n+t.items.length,0)}
      <section class="space-group" data-space={space.id}>
        <div class="space-row"><button class="expand" aria-label={'Toggle '+space.name} aria-expanded={expanded(space)} onclick={()=>toggle(space.id,expanded(space))}><span aria-hidden="true">{expanded(space)?'⌄':'›'}</span><span class="work-label"><strong>{space.name}</strong><small>{space.native?'Herdr':space.available||space.hidden?'Codex':'Deskpilot'} · {count} {space.available||space.hidden?(count===1?'conversation':'conversations'):(count===1?'terminal':'terminals')}</small></span></button>
          {#if !space.unassigned&&!space.available&&!space.hidden}<button class="node-menu" aria-label={'Manage space: '+space.name} onclick={()=>manage(space)}>⋯</button>{/if}
        </div>
        {#if expanded(space)}
          {#if space.unassigned||space.available||space.hidden}
            {#each space.tabs as tab (tab.id)}{#each tab.items as item (draftKey(item))}{@render terminal(item)}{/each}{/each}
            {#if space.available}<p class="navigation-note">Codex can retain conversations after their desktop windows close. Hide keeps their work and drafts.</p>{/if}
          {:else}
            {#each space.tabs as tab (tab.id)}
              <div class="tab-row"><button class="expand" aria-label={'Toggle tab: '+tab.name} aria-expanded={tabExpanded(space,tab)} onclick={()=>toggle(tabKey(space,tab),tabExpanded(space,tab))}><span aria-hidden="true">{tabExpanded(space,tab)?'⌄':'›'}</span><span class="work-label"><strong>{tab.name}</strong><small>{tab.items.length} {tab.items.length===1?'terminal':'terminals'}</small></span></button><button class="node-menu" aria-label={'Manage tab: '+tab.name} onclick={()=>manageTab(space,tab)}>⋯</button></div>
              {#if tabExpanded(space,tab)}
                <div class="tab-terminals">{#each tab.items as item (draftKey(item))}{@render terminal(item)}{:else}<div class="empty-tab"><p>No terminals yet.</p><button onclick={()=>emptyTask(space,tab,'start')}>Start terminal</button><button onclick={()=>emptyTask(space,tab,'existing')}>Add existing work</button></div>{/each}</div>
              {/if}
            {:else}<p class="navigation-note">No tabs yet. Add a tab from this space’s menu.</p>{/each}
          {/if}
        {/if}
      </section>
    {/each}
  {/if}
  <div class="navigation-footer">
    {#if hiddenCount||state.workShowHidden}<label class="show-hidden"><input type="checkbox" aria-label="Show hidden conversations" checked={!!state.workShowHidden} onchange={e=>onchange({workShowHidden:e.currentTarget.checked})}/><span>Show hidden ({hiddenCount})</span></label>{/if}
    <button onclick={()=>actions('new')}>＋ New terminal</button>
    <button onclick={coverage}>Attention coverage →</button>
    <button aria-label="Work actions" onclick={()=>actions('menu')}>More work actions…</button>
  </div>
</div>

<style>
.work-navigation{font-size:12px;--muted:var(--dim);min-width:0}.work-navigation button{border:0;border-radius:6px;text-align:left;justify-content:flex-start;min-height:44px;min-width:44px}.navigation-brand{font-size:10px;letter-spacing:2px;color:var(--ok);padding:12px 8px 18px}.computer-control{width:100%;gap:9px;border-bottom:1px solid var(--line)!important;padding:6px 5px 12px;border-radius:0!important;margin-bottom:12px}.computer-control>span:last-child{color:var(--dim)}.health-dot{font-size:10px;color:var(--warn)}.health-dot.online{color:var(--ok)}.work-label{flex:1;min-width:0}.work-label strong{display:block;font-size:12px;font-weight:550;overflow-wrap:anywhere}.work-label small{display:block;font-size:10px;color:var(--dim);margin-top:3px;overflow-wrap:anywhere}.work-search{width:100%;font-size:14px;margin:0 0 10px}.work-filters{display:flex;gap:4px;border-bottom:1px solid var(--line);padding-bottom:8px}.work-filters>button{flex:1;justify-content:center;gap:6px;font-size:12px;padding:6px}.work-filters [aria-pressed=true]{background:#2b3b20;color:var(--ok)}.count{color:var(--warn);font-size:10px}.search-scope{display:flex;flex-direction:row;align-items:center;color:var(--dim);font-size:11px;gap:6px;margin:4px 0}.search-scope select{flex:1;border:0;background:transparent;font-size:11px}.tree-heading{display:flex;align-items:center;justify-content:space-between;gap:4px;padding:6px 0 2px}.tree-heading>span{color:var(--dim);font-size:9px;letter-spacing:1.5px}.tree-heading button{font-size:11px;color:var(--ok)}.space-group{border-bottom:1px solid var(--line)}.space-row,.tab-row{display:flex;align-items:center;min-width:0}.expand{flex:1;gap:9px;padding:9px 5px}.expand>span:first-child{color:var(--dim);width:12px;flex:none}.node-menu{width:44px;flex:none;justify-content:center!important;font-size:18px;padding:0}.tab-row{padding-left:14px}.tab-row .work-label strong{font-size:12px}.tab-terminals{margin-left:24px;border-left:1px solid var(--line);padding-left:3px;padding-bottom:8px}.terminal-row{display:flex;align-items:center;gap:3px;min-width:0;margin:0 0 3px 12px}.terminal-row .open-terminal{flex:1;gap:9px;min-width:0;min-height:52px;padding:8px}.terminal-dot{font-size:9px;color:var(--dim)}.terminal-dot.needs{color:var(--warn)}.current{background:#2b3b20;color:var(--ok)}.visibility{font-size:10px;color:var(--dim);padding:5px;flex:none}.search-result{margin:0;border-bottom:1px solid var(--line)}.results-count,.navigation-note{font-size:11px;color:var(--dim);line-height:1.65;padding:8px 4px;margin:0}.navigation-footer{display:flex;flex-direction:column;gap:1px;padding-top:12px}.navigation-footer button{font-size:11px;color:var(--dim)}.show-hidden{display:flex;align-items:center;flex-direction:row;gap:8px;min-height:44px;font-size:11px;color:var(--dim)}.show-hidden input{appearance:none;width:44px;height:44px;min-height:44px;flex:none;margin:0;padding:11px;border:0;background:transparent}.show-hidden input::before{content:"";display:block;width:20px;height:20px;border:1px solid var(--dim);border-radius:4px}.show-hidden input:checked::before{background:var(--ok);box-shadow:inset 0 0 0 4px var(--panel)}.empty-tab{font-size:11px;color:var(--dim);padding:8px}.empty-tab button{font-size:12px;color:var(--ok);width:100%}@media(max-width:959px){.navigation-brand{display:none}}
</style>
