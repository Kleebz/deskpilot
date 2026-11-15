<script>
  import SpaceBrowser from './SpaceBrowser.svelte';
  import { taskFor, draftKey } from './model.js';
  import './workbench.css';
  export let state, computer, item, output;
  export let simulated=false;
  export let focused=false,composer,scroller,touchStart=null;
  export let showSheet,step,chooseTask,openTask,newTask,swipeEnd,sendPrompt,openItem,newWorkSpace,manageSpace,rememberScroll;
  $: workContext=taskFor(state,item);
  $: siblingTasks=workContext?.space.tabs||[];
  $: activeKey=draftKey(item);
</script>
<div class="spaces-workbench" class:keyboard={focused} class:still={state.browserMotion}>
  {#if state.view==='terminal'&&item}
      <header class="terminal-header">
        <button class="icon-button" aria-label="Open spaces" onclick={()=>showSheet('work-drawer')}>☰</button>
        <button class="title-picker" aria-label="Choose session" onclick={() => { showSheet('work-drawer'); }}><strong>{item.name}</strong><span>{workContext?.space.name || 'Unassigned'} / {workContext?.tab.name || item.name} ⌄</span></button>
        <button class="icon-button" aria-label="Previous session" disabled={state.sequence.indexOf(item.id) <= 0} onpointerdown={e => e.preventDefault()} onclick={() => step(-1)}>‹</button>
        <button class="icon-button" aria-label="Next session" disabled={state.sequence.indexOf(item.id) >= state.sequence.length - 1} onpointerdown={e => e.preventDefault()} onclick={() => step(1)}>›</button>
        <button class="icon-button" aria-label="Session actions" onclick={() => showSheet('session-actions')}>⋯</button>
      </header>
        <div class="task-tabs" aria-label="Task tabs">{#each siblingTasks as task (task.id)}<button class:chosen={task.id===workContext?.tab.id} aria-pressed={task.id===workContext?.tab.id} onpointerdown={e=>e.preventDefault()} onclick={()=>openTask(workContext.space,task)}>{task.name}{#if task.items.some(i=>i.status==='needs')}<span class="task-attention" aria-label="Needs you">●</span>{/if}</button>{/each}<button aria-label={workContext?.space.unassigned||workContext?.space.available||workContext?.space.hidden?"New space":"New task"} onclick={newTask}>＋</button></div>
        {#if workContext?.tab.items.length>1}<div class="pane-tabs" aria-label="Terminals in this task">{#each workContext.tab.items as pane,index (pane.id)}<button aria-pressed={pane.id===item.id} onpointerdown={e=>e.preventDefault()} onclick={()=>chooseTask(pane)}>Terminal {index+1} · {pane.name}</button>{/each}</div>{/if}

      <div class="terminal-context"><span><i class:online={computer.health === 'online'}></i>{computer.name} · {computer.health}</span><span title={item.source === 'Herdr' ? `${item.space} / ${item.tab} / Pane ${item.pane}` : item.cwd}>{item.source === 'Herdr' ? `${item.space} / ${item.tab} / Pane ${item.pane}` : item.cwd}</span></div>
      {#if computer.health !== 'online'}<button class="connection-banner" onclick={() => showSheet('recovery')}>Stale output · {computer.health} · Recover connection →</button>{/if}
      <div class="terminal-frame" class:output-active={item.outputActive} ontouchstart={e => touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY }} ontouchend={swipeEnd} role="region" aria-label={simulated?"Simulated terminal output":"Terminal output"}>
        <slot name="terminal"><pre class="terminal-output" style:font-size={state.textSize + 'px'}>{output}<span class="cursor">▍</span></pre></slot>
        <span class="terminal-tag">{item.outputActive ? 'Output active · ' : ''}{item.status === 'needs' ? 'Reported request' : item.source === 'Codex' || item.status === 'unknown' ? 'Requests unknown' : 'No reported requests'} · {state.sequence.indexOf(item.id) + 1}/{state.sequence.length}</span>
      </div>
      <form class="composer" onsubmit={e => { e.preventDefault(); sendPrompt(); }}>
        <button type="button" class="icon-button tools-trigger" aria-label="Input tools" onpointerdown={e => e.preventDefault()} onclick={() => showSheet('tools')}>＋</button>
        <textarea bind:this={composer} aria-label="Reply to this session" placeholder="Reply to this session…" rows="1" value={state.drafts[activeKey] || ''} oninput={e => { state.drafts[activeKey] = e.currentTarget.value; }} onfocus={() => focused = true} onblur={() => focused = false}></textarea>
        <button class="send-button" aria-label="Send prompt" disabled={computer.health !== 'online'}>↑</button>
      </form>
  {:else}
    <main class="app-main" bind:this={scroller} onscroll={rememberScroll}>
      <SpaceBrowser bind:state open={openItem} create={newWorkSpace} manage={manageSpace} {openTask} computer={()=>showSheet('computer')} coverage={()=>showSheet('coverage')}/>
    </main>
  {/if}
</div>
