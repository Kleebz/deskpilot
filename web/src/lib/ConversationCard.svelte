<script>
  import { workStateLabel } from './work-model.js';
  import { tilde } from './api.js';
  let { chat, connecting = '', onconnect, hint = '', onscreen = null, screen = null, provider = 'Codex', compact = false } = $props();
</script>
<div class="conversation-card" class:compact data-conversation={chat.id}>
  {#if compact}
    <button class="conversation-open" aria-label={chat.session?'Open mobile terminal':'Enable mobile control'} disabled={!!connecting} onclick={()=>onconnect(chat)}>
      <span class="conversation-heading"><strong>{chat.title}</strong><span class="dim">{workStateLabel(chat)}</span></span>
      <span class="dim conversation-path">{provider} · Requests unknown · {tilde(chat.path)}</span>
      <span class="row-foot"><span class="dim">{chat.address??chat.id.slice(-8)}</span><span>{connecting===chat.id?'Connecting…':chat.session?'Open ↗':'Connect ↗'}</span></span>
    </button>
  {:else}
    {#if hint}<span class="dim match-hint">{hint}</span>{/if}
    <span class="conversation-heading"><strong>{chat.title}</strong><span class="dim">{workStateLabel(chat)}</span></span>
    <span class="dim conversation-path">{tilde(chat.path)}</span>
    <span class="dim">{provider} · {chat.address ?? chat.id.slice(-8)}</span>
    <button disabled={!!connecting} onclick={() => onconnect(chat)}>{connecting === chat.id ? 'Connecting…' : chat.session ? 'Open mobile terminal' : 'Enable mobile control'}</button>
  {/if}
  {#if onscreen && screen != null}<button class="show-screen" onclick={onscreen}>Show on Screen {screen}</button>{/if}
</div>
<style>
.conversation-card{display:flex;flex-direction:column;gap:.4rem;min-width:0;padding:.6rem;border:1px solid var(--line);border-radius:var(--radius);background:var(--panel);}.conversation-heading{display:flex;justify-content:space-between;align-items:baseline;gap:.5rem;min-width:0;}.conversation-heading strong,.conversation-path{overflow-wrap:anywhere;min-width:0;}.conversation-heading strong{color:var(--ok);}.conversation-heading>.dim{flex:none;font-size:11px;}.match-hint{font-size:12px;}button{min-height:44px;}.show-screen{color:var(--dim);font-size:11px;}
.compact{padding:0;border:0;border-bottom:1px solid var(--line);border-radius:0;background:transparent;gap:0;}.conversation-open{width:100%;display:flex;flex-direction:column;align-items:stretch;justify-content:flex-start;gap:7px;border:0;text-align:left;padding:16px 0;background:transparent;}.compact .conversation-heading strong{font-size:14px;font-weight:550;color:var(--fg);display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;}.compact .conversation-path{font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}.row-foot{display:flex;justify-content:space-between;gap:8px;font-size:10px;}.row-foot>span:last-child{color:var(--ok);}.compact .show-screen{border:0;justify-content:flex-start;padding:0 0 8px;}
</style>
