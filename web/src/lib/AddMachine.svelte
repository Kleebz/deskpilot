<script>
  import { onDestroy } from 'svelte';
  import { enroll, hasDeviceCredential } from './api.js';
  import { hosts, addHost } from './hosts.svelte.js';
  import PairScanner from './PairScanner.svelte';
  let { draft = $bindable({ address: '', code: '' }), onpaired, oncancel } = $props();
  let busy = $state(false), error = $state('');
  let alive = true;
  onDestroy(() => alive = false);
  async function pair(raw = draft.address) {
    if (busy) return;
    error = '';
    let url;
    try {
      const value = raw.trim();
      const scheme = /:\d+/.test(value) || /^(localhost|\d+\.\d+\.\d+\.\d+)/i.test(value) ? 'http' : 'https';
      url = new URL(/^https?:\/\//i.test(value) ? value : `${scheme}://${value}`);
      if (!/^https?:$/.test(url.protocol)) throw Error();
    } catch { error = 'Enter a valid machine address or pairing link.'; return; }
    const code = url.searchParams.get('code') || draft.code.trim();
    if (!/^[34679CDFGHJKMNPQRTVWXY]{8}$/i.test(code)) { error = 'Enter the one-time code from deskpilot pair.'; return; }
    busy = true;
    const host = { origin: url.origin, name: url.hostname, token: '' };
    try {
      const existing = hosts.list.find(h => h.origin === host.origin);
      if (existing && await hasDeviceCredential(existing)) host.token = existing.token;
      else host.token = (await enroll(code, host, { activate: false })).token;
      if (!alive) return;
      addHost(host);
      draft.address = ''; draft.code = '';
      onpaired(host.origin);
    } catch (e) { if (alive) error = e.message || 'Pairing failed. Try again.'; }
    finally { busy = false; }
  }
</script>
<h1 tabindex="-1">Pair computer</h1>
<p class="dim">Run <code>deskpilot pair</code> on the remote machine. Scan its QR or enter its link below.</p>
<PairScanner onscan={value => { draft.address = value; pair(value); }} onstatus={text => error = text} />
<form class="pair-form" onsubmit={e => { e.preventDefault(); pair(); }}>
  <label>Pairing link or address<input bind:value={draft.address} autocomplete="off" autocapitalize="off" spellcheck="false" /></label>
  <label>One-time code <span class="dim">(when using a bare address)</span><input class="code-in" bind:value={draft.code} autocomplete="off" autocapitalize="characters" spellcheck="false" /></label>
  {#if error}<p class="err" role="alert">{error}</p>{/if}
  <div class="form-actions"><button type="button" onclick={oncancel}>Cancel</button><button class="primary" disabled={busy || !draft.address.trim()}>{busy ? 'Pairing…' : 'Pair computer'}</button></div>
</form>
