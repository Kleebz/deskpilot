<script>
  import Sheet from '../Sheet.svelte';
  let {controller,model,nativeAvailable=false,onNative}=$props();
  const action=$derived(controller.action);
  const local=$derived(action?.base?.spaces.find(s=>s.id===action.spaceId));
  const existing=$derived(model.items.filter(i=>i.computer===action?.host.origin&&i.organizable&&!i.viewOnly));
</script>
{#if action}
<Sheet label={({'new-space':'New space','new-task':'New tab',empty:action.name,existing:'Add existing work',move:'Move to tab',manage:'Manage space','manage-tab':'Manage tab',visibility:action.hide?'Hide conversation':'Restore conversation'})[action.type]||'Spaces'} onclose={()=>controller.close()}>
<p class="dim">{action.host.alias||action.host.name||action.host.origin}</p>
{#if action.type==='new-space'}
<form onsubmit={e=>{e.preventDefault();controller.createSpace();}}><label>Space name<input aria-label="Space name" maxlength="100" required bind:value={action.name}/></label><label>First tab name<input aria-label="First tab name" maxlength="100" required bind:value={action.taskName}/></label><button class="primary" disabled={controller.busy||!action.name.trim()||!action.taskName.trim()}>Create space</button></form>
<p class="dim">This organizes work on this computer. No program starts until you choose Start terminal.</p>
{#if nativeAvailable}<button onclick={()=>{controller.close();onNative({kind:'library',mode:'new-space'});}}>Create a native Herdr space…</button>{/if}
{:else if action.type==='new-task'}
<form onsubmit={e=>{e.preventDefault();controller.createTask();}}><label>Tab name<input aria-label="Tab name" maxlength="100" required bind:value={action.name}/></label><button class="primary" disabled={controller.busy||!action.name.trim()}>Create tab</button></form>
{:else if action.type==='empty'}
<p>No terminals in this tab yet.</p><div class="actions"><button class="primary" onclick={()=>controller.startTerminal()}>Start terminal</button><button onclick={()=>controller.addExisting()}>Add existing work</button></div>
{:else if action.type==='existing'}
<p>Choose work to move into {action.name}. Drafts stay with their original terminals.</p>
{#each existing as item (`${item.source}:${item.id}:${item.generation}`)}<button class="work-choice" data-item={item.id} disabled={controller.busy} onclick={()=>{action.item=item;controller.assign(item);}}><strong>{item.name}</strong><span class="dim">{item.source} · {item.cwd}</span></button>{:else}<p>No work available on this computer. Start a terminal first.</p>{/each}
{:else if action.type==='move'}
<p>{action.item.name}</p><form onsubmit={e=>{e.preventDefault();controller.assign();}}><label>Space / tab<select aria-label="Destination tab" bind:value={action.taskId}><option value="">Unassigned</option>{#each action.base.spaces as space}<optgroup label={space.name}>{#each space.tabs as tab}<option value={tab.id}>{space.name} / {tab.name}</option>{/each}</optgroup>{/each}</select></label><button class="primary" disabled={controller.busy}>Move work</button></form>
{:else if action.type==='manage-tab' && local}
{@const index=local.tabs.findIndex(t=>t.id===action.taskId)}
<form onsubmit={e=>{e.preventDefault();controller.changeTab('rename');}}><label>Tab name<input aria-label="Tab name" required maxlength="100" bind:value={action.name}/></label><button disabled={controller.busy||!action.name.trim()}>Save tab name</button></form>
<div class="actions"><button disabled={controller.busy||index<=0} onclick={()=>controller.changeTab('earlier')}>Move tab earlier</button><button disabled={controller.busy||index===local.tabs.length-1} onclick={()=>controller.changeTab('later')}>Move tab later</button></div><p class="dim">Removing tab organization leaves its programs running and its drafts intact.</p><button disabled={controller.busy} onclick={()=>controller.changeTab('remove')}>Remove tab organization</button>
{:else if action.type==='visibility'}
<p><strong>{action.item.name}</strong></p><p>{action.hide?'Hide this conversation from Deskpilot lists and search. Show hidden lets you restore it.':'Restore this conversation to Deskpilot lists and search.'}</p><p class="dim">Its original work, mobile view and saved drafts stay intact. This choice is saved on this computer.</p><button class="primary" disabled={controller.busy} onclick={()=>controller.saveVisibility()}>{action.hide?'Hide from Deskpilot':'Restore conversation'}</button>
{:else if action.type==='manage' && local}
<form onsubmit={e=>{e.preventDefault();controller.changeSpace((d,s)=>{if(s)s.name=action.name.trim();});}}><label>Space name<input aria-label="Space name" maxlength="100" required bind:value={action.name}/></label><button disabled={controller.busy||!action.name.trim()}>Save space name</button></form>
<h2>Tabs</h2>{#each local.tabs as tab,index (tab.id)}<div class="task-edit"><label>Tab name<input aria-label={`Tab name: ${tab.name}`} value={tab.name} maxlength="100" onchange={e=>{const name=e.currentTarget.value.trim();if(name)controller.changeSpace((d,s)=>{if(s)s.tabs.find(t=>t.id===tab.id).name=name;});}}/></label><button disabled={controller.busy||index===0} aria-label={`Move tab earlier: ${tab.name}`} onclick={()=>controller.changeSpace((d,s)=>{if(s)[s.tabs[index-1],s.tabs[index]]=[s.tabs[index],s.tabs[index-1]];})}>↑</button></div>{/each}
<button onclick={()=>{controller.action={...action,type:'new-task',name:''};}}>Add tab</button><p class="dim">Removing this space returns ordinary terminals to Unassigned and conversations to Available conversations. No terminal stops.</p><button disabled={controller.busy} onclick={()=>controller.removeSpace()}>Remove organization</button>
{/if}
{#if action.error}<div role="alert"><p>{action.error}</p><button disabled={controller.busy} onclick={()=>controller.refreshAction()}>Refresh organization</button></div>{/if}
</Sheet>
{/if}
<style>
form,.actions{display:flex;flex-direction:column;gap:12px;margin:12px 0}label{display:flex;flex-direction:column;gap:8px;font-size:12px}button{min-height:44px}p{font-size:13px;line-height:1.6}.work-choice{width:100%;border:0;border-bottom:1px solid var(--line);border-radius:0;flex-direction:column;align-items:flex-start;padding:12px 0;gap:5px}.work-choice span{font-size:11px}.task-edit{display:flex;align-items:center;gap:10px;margin-bottom:10px}.task-edit label{flex:1}.task-edit button{width:44px}h2{font-size:14px;margin-top:20px}[role=alert]{color:var(--warn);margin-top:14px}
</style>
