<script>
  import { updates } from './updates.svelte.js';
  let {onreload}=$props();
</script>
{#if updates.available}
  <div class="update-notice" role="status"><span>New UI ready. Your drafts will be saved.</span><button onclick={onreload}>Reload</button></div>
{:else if updates.cached}
  <div class="cached-notice" role="status">Using saved UI · app source unavailable. Computer connection is shown separately.</div>
{/if}
<style>
.update-notice{display:flex;align-items:center;gap:8px;padding:3px 10px;background:var(--panel);border-bottom:1px solid var(--line);font-size:12px;flex:none}.update-notice span{flex:1}.update-notice button{min-height:44px;border-color:var(--ok);color:var(--ok);font-size:12px}.cached-notice{font-size:11px;padding:6px 10px;color:var(--warn);border-bottom:1px solid var(--line);flex:none}
</style>
