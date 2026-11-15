<script>
  export let context=null,selected=null,openTask,newTask,openTerminal;
</script>
{#if context}
<div class="task-tabs" aria-label="Task tabs">
  {#each context.space.tabs as task (task.id)}<button class:chosen={task.id===context.tab.id} aria-pressed={task.id===context.tab.id} onpointerdown={e=>{if(document.activeElement?.matches('.composer input,.composer textarea'))e.preventDefault();}} onclick={()=>openTask(context.space,task)}>{task.name}{#if task.items.some(i=>i.status==='needs')}<span class="task-attention">●</span>{/if}</button>{/each}
  <button aria-label={context.space.unassigned||context.space.available||context.space.hidden?'New space':'New task'} onclick={()=>newTask(context.space)}>＋</button>
</div>
{#if context.tab.items.length>1}<div class="pane-tabs" aria-label="Terminals in this task">{#each context.tab.items as item,index (item.id)}<button aria-pressed={item.id===selected?.id} onpointerdown={e=>{if(document.activeElement?.matches('.composer input,.composer textarea'))e.preventDefault();}} onclick={()=>openTerminal(item)}>Terminal {index+1} · {item.name}</button>{/each}</div>{/if}
{/if}
<style>
.task-tabs,.pane-tabs{display:flex;flex:none;gap:4px;overflow-x:auto;scrollbar-width:thin;max-width:100%;padding:3px 0 5px;border-bottom:1px solid var(--line)}button{flex:none;min-height:44px;max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px;padding:0 12px;border:0;color:var(--dim);background:transparent}.chosen{background:var(--panel);color:var(--ok)}.task-attention{font-size:8px;color:var(--warn)}.pane-tabs{padding-block:0;border:0}.pane-tabs button{font-size:11px}.pane-tabs [aria-pressed=true]{color:var(--ok);box-shadow:inset 0 -2px var(--ok)}@media(max-height:520px){.task-tabs,.pane-tabs{display:none}}
</style>
