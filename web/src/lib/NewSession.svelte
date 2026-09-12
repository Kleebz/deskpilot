<script>
  import { onMount, onDestroy } from 'svelte';
  import { api, post, tilde } from './api.js';
  import { currentHost, capsFor } from './hosts.svelte.js';
  let { ws = null, taken = [], onchanged, oncancel, draft = $bindable({ name: '', dir: '', command: 'claude', workspace: ws }) } = $props();
  const host = currentHost();
  let alive = true;
  let dirs = $state([]), busy = $state(false), error = $state('');
  onDestroy(() => alive = false);
  onMount(async () => {
    try { dirs = await api('/dirs', { host }); if (!draft.dir) draft.dir = dirs[1] ?? dirs[0] ?? ''; }
    catch (e) { error = e.message; }
  });
  const problem = $derived(!/^[A-Za-z0-9_.-]{1,64}$/.test(draft.name.trim()) ? 'Use 1–64 letters, numbers, dots, dashes or underscores.' : taken.includes(draft.name.trim()) ? 'That name is already in use.' : '');
  async function create(e) {
    e.preventDefault();
    if (busy || problem || !draft.command.trim()) return;
    busy = true; error = '';
    try {
      const result = await post('/sessions', { name: draft.name.trim(), path: draft.dir, command: draft.command.trim(), workspace: capsFor(host.origin).windows ? draft.workspace : null }, { host });
      if (alive) onchanged(result);
    } catch (e) { if (alive) error = e.message; }
    finally { busy = false; }
  }
</script>
<form onsubmit={create}>
  <label>Session name<input bind:value={draft.name} autocomplete="off" autocapitalize="off" placeholder="e.g. api-review" /></label>
  {#if draft.name && problem}<span class="err">{problem}</span>{/if}
  <label>Directory<select bind:value={draft.dir}>{#each dirs as d}<option value={d}>{tilde(d)}</option>{/each}</select></label>
  <label>Command<input bind:value={draft.command} list="commands" autocapitalize="off" autocomplete="off" /></label>
  <datalist id="commands"><option value="bash"></option><option value="claude"></option><option value="claude --continue"></option></datalist>
  {#if capsFor(host.origin).windows}<label>Desktop placement<select bind:value={draft.workspace}><option value={null}>No desktop window</option>{#each [1,2,3,4,5,6,7,8,9,10] as n}<option value={n}>Screen {n}</option>{/each}</select></label>{/if}
  {#if error}<p role="alert" class="err">{error}</p>{/if}
  <div class="form-actions"><button type="button" onclick={oncancel}>Cancel</button><button class="primary" disabled={busy || !!problem || !draft.command.trim()}>{busy ? 'Starting…' : 'Create session'}</button></div>
</form>
