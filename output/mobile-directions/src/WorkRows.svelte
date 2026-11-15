<script>
  import { statusLabel } from './model.js';
  export let items = [], computers = [], open, showComputer = false;
</script>
<div class="work-rows">
  {#each items as item (item.id)}
    <button class="work-row" data-item={item.id} onclick={() => open(item)}>
      <span class="source-icon" class:native={item.source === 'Herdr'}>{item.source === 'Terminal' ? '>_' : item.source === 'Codex' ? '◇' : '⊞'}</span>
      <span class="row-copy"><strong>{item.name}</strong><span class="muted">{item.source}{item.source === 'Codex' ? ' · Requests unknown' : ''} · {showComputer ? computers.find(c => c.id === item.computer)?.name + ' · ' : ''}{item.source === 'Herdr' ? `${item.space} / ${item.tab} / Pane ${item.pane}` : item.workspace ? `Desktop ${item.workspace}` : 'Detached'}</span><span class="path">{item.cwd} <span class="identity">· {item.id}</span></span></span>
      <span class="row-end"><span class="status" class:needs={item.status === 'needs'}><i class={item.status}></i>{statusLabel[item.status]}</span><span class="open-label">{item.connected ? 'Open' : 'Connect'} ↗</span></span>
    </button>
  {:else}<div class="empty"><strong>No matching work</strong><p>Try another name, folder, source, or filter. Closed work is never recreated.</p></div>{/each}
</div>
