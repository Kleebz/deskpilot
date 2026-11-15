<script>
  import ConversationCard from './ConversationCard.svelte';
  let { win, chats, connecting, onconnect, onclose } = $props();
  let dialog = $state(null), error = $state('');
  $effect(() => { if (dialog && !dialog.open) dialog.showModal(); });
  async function choose(chat) {
    error = '';
    const result = await onconnect(chat);
    if (typeof result === 'string') error = result;
  }
</script>

<dialog bind:this={dialog} aria-labelledby="conversation-picker-title" onclose={onclose} oncancel={onclose}>
  <div class="picker-heading"><h2 id="conversation-picker-title">Conversation on Screen {win.workspace}</h2><button onclick={onclose}>Cancel</button></div>
  <p class="window-title">{win.title || win.class}</p>
  <p class="dim">Choose the conversation you recognize in this window. Its desktop window and pet stay in place.</p>
  {#if error}<p class="err" role="alert">{error}</p>{/if}
  <div class="choices">
    {#each chats as chat (chat.id)}<ConversationCard {chat} {connecting} onconnect={choose} />{:else}<p>No supported conversations are available. Open Codex normally, then refresh Screens.</p>{/each}
  </div>
</dialog>

<style>
  dialog { width:min(560px,calc(100vw - 24px)); max-height:calc(100dvh - 24px); padding:12px; color:var(--fg); background:var(--bg); border:1px solid var(--line); border-radius:var(--radius); }
  dialog[open] { display:flex; flex-direction:column; gap:.6rem; }
  dialog::backdrop { background:#000b; }
  .picker-heading { display:flex; align-items:center; gap:.5rem; min-width:0; flex:none; }
  h2 { flex:1; min-width:0; font-size:16px; margin:0; }
  button { min-height:44px; }
  p { margin:0; overflow-wrap:anywhere; flex:none; }
  .window-title { max-height:4.5em; overflow:auto; }
  .choices { display:flex; flex-direction:column; gap:.6rem; min-height:0; overflow:auto; overscroll-behavior:contain; }
</style>
