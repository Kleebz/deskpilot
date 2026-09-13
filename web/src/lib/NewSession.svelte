<script>
  import { onMount, onDestroy } from 'svelte';
  import { api, post, tilde } from './api.js';
  import { currentHost, capsFor } from './hosts.svelte.js';
  const COMMAND_PRESETS = [
    { label: 'Terminal', command: 'bash' },
    { label: 'Claude', command: 'claude' },
    { label: 'Claude continue', command: 'claude --continue' },
    { label: 'Codex', command: 'codex --no-alt-screen' },
    { label: 'Codex continue', command: 'codex resume --last --no-alt-screen' },
    { label: 'Codex yolo', command: 'codex --yolo --no-alt-screen' },
  ];
  let { ws = null, taken = [], onchanged, oncancel, draft = $bindable({ name: '', dir: '', command: 'claude', workspace: ws }) } = $props();
  const host = currentHost();
  let alive = true;
  let dirs = $state([]), busy = $state(false), error = $state('');
  const preset = $derived(COMMAND_PRESETS.some((item) => item.command === draft.command) ? draft.command : 'custom');
  const yolo = $derived(/(?:^|\s)(?:--yolo|--dangerously-bypass-approvals-and-sandbox)(?:\s|$)/.test(draft.command));
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

  function choosePreset(e) {
    draft.command = e.currentTarget.value === 'custom' ? '' : e.currentTarget.value;
  }
</script>
<form onsubmit={create}>
  <label>Session name<input bind:value={draft.name} autocomplete="off" autocapitalize="off" placeholder="e.g. api-review" /></label>
  {#if draft.name && problem}<span class="err">{problem}</span>{/if}
  <label>Directory<select bind:value={draft.dir}>{#each dirs as d}<option value={d}>{tilde(d)}</option>{/each}</select></label>
  <label>Command preset<select aria-label="Command preset" value={preset} onchange={choosePreset}>{#each COMMAND_PRESETS as item}<option value={item.command}>{item.label}</option>{/each}<option value="custom">Custom command</option></select></label>
  <label>Command to run<input bind:value={draft.command} placeholder="Type a command or edit the selected preset" autocapitalize="off" autocomplete="off" /></label>
  {#if yolo}<p class="command-warning" role="status">Yolo mode disables Codex approval prompts and sandboxing. Use it only in a trusted, isolated environment.</p>{/if}
  {#if capsFor(host.origin).windows}<label>Desktop placement<select aria-label="Desktop placement" bind:value={draft.workspace}><option value={null}>No desktop window</option>{#each [1,2,3,4,5,6,7,8,9,10] as n}<option value={n}>Screen {n}</option>{/each}</select></label>{/if}
  {#if error}<p role="alert" class="err">{error}</p>{/if}
  <div class="form-actions"><button type="button" onclick={oncancel}>Cancel</button><button class="primary" disabled={busy || !!problem || !draft.command.trim()}>{busy ? 'Starting…' : 'Create session'}</button></div>
</form>

<style>
  .command-warning { color: var(--warn); font-size: 12px; }
</style>
