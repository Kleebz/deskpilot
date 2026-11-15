<script>
  import { onMount, onDestroy, untrack } from 'svelte';
  import { api, post } from './api.js';
  import { currentHost } from './hosts.svelte.js';
  import { vis } from './visible.svelte.js';

  const host = currentHost();
  let items = $state([]), selected = $state(''), loading = $state(true), error = $state('');
  let image = $state(''), imageError = $state(''), imageLoading = $state(false), removing = $state(false);
  let dialog = $state(null), fullSize = $state(false);
  let alive = true, refreshing = false, imageRequest = 0, controller;
  const current = $derived(items.find(p => p.id === selected));
  const when = time => new Date(time).toLocaleString();

  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    try {
      const list = await api('/previews', { host });
      if (!alive) return;
      const followLatest = !selected || selected === items[0]?.id;
      items = list;
      if (!items.some(p => p.id === selected) || (followLatest && !dialog?.open)) selected = items[0]?.id ?? '';
      error = '';
    } catch (e) { if (alive) error = e.message; }
    finally { if (alive) loading = false; refreshing = false; }
  }
  onMount(() => { refresh(); });
  onDestroy(() => {
    alive = false; imageRequest++; controller?.abort();
    if (image) URL.revokeObjectURL(image);
  });
  $effect(() => {
    void vis.wokeAt;
    if (!vis.visible) return;
    untrack(refresh);
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  });
  $effect(() => {
    const id = selected;
    untrack(async () => {
      const request = ++imageRequest;
      controller?.abort(); controller = new AbortController();
      if (image) URL.revokeObjectURL(image);
      image = ''; imageError = ''; imageLoading = !!id;
      if (!id) return;
      try {
        const blob = await api(`/previews/${id}`, { host, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) });
        if (!alive || request !== imageRequest) return;
        image = URL.createObjectURL(blob);
      } catch (e) { if (alive && request === imageRequest) imageError = e.message; }
      finally { if (alive && request === imageRequest) imageLoading = false; }
    });
  });
  async function remove() {
    if (!current || removing) return;
    removing = true;
    try {
      await post('/previews/remove', { id: current.id }, { host });
      if (alive) { dialog?.close(); await refresh(); }
    } catch (e) { if (alive) error = e.message; }
    finally { if (alive) removing = false; }
  }
  function enlarge() { fullSize = false; dialog?.showModal(); }
</script>

<div class="heading"><h1 tabindex="-1">Previews</h1><button aria-label="Refresh previews" onclick={refresh}>Refresh</button></div>
<p class="dim">Screenshots and renders you request from a working task. Refresh checks published images; it does not capture new ones.</p>
{#if error}<p class="err" role="alert">{error}</p>{/if}
{#if loading}<p role="status">Loading previews…</p>
{:else if !items.length}
  <p>No previews yet. Ask the agent in your working session to publish one preview, or publish a saved screenshot or render:</p>
  <pre><code>deskpilot preview screenshot.png --caption "Latest progress"</code></pre>
{:else if current}
  <section class="selected-preview" aria-label="Selected preview">
    <div class="details"><h2>{current.task}</h2><p>{current.caption || 'Task preview'}</p><span class="dim"><time datetime={new Date(current.created).toISOString()}>{when(current.created)}</time> · {current.width} × {current.height}</span></div>
    {#if imageLoading}<p role="status">Loading image…</p>{/if}
    {#if imageError}<p class="err" role="alert">{imageError}</p>{/if}
    {#if image}<button class="image-button" aria-label="Enlarge preview" onclick={enlarge}><img src={image} alt={current.caption || `Preview for ${current.task}`} width={current.width} height={current.height} onerror={() => imageError = 'This image could not be displayed.'} /></button>{/if}
    <button class="danger" disabled={removing} onclick={remove}>{removing ? 'Removing…' : 'Remove preview'}</button>
  </section>
  <section class="history" aria-label="Recent previews"><h2>Recent previews</h2>
    {#each items as p (p.id)}<button class:chosen={selected === p.id} aria-current={selected === p.id ? 'true' : undefined} onclick={() => selected = p.id}>
      <strong>{p.task}</strong><span>{p.caption || 'Task preview'}</span><time class="dim" datetime={new Date(p.created).toISOString()}>{when(p.created)}</time>
    </button>{/each}
  </section>
{/if}

<dialog bind:this={dialog} aria-label="Preview image">
  <div class="zoom-toolbar"><button onclick={() => fullSize = !fullSize}>{fullSize ? 'Fit image' : 'Actual size'}</button><button onclick={() => dialog.close()}>Close preview</button></div>
  <div class="zoom-scroll">{#if image && current}<img class:full={fullSize} src={image} alt={current.caption || `Preview for ${current.task}`} />{/if}</div>
</dialog>

<style>
  .heading { display:flex; justify-content:space-between; gap:.5rem; align-items:center; min-width:0; }
  .selected-preview,.details,.history { display:flex; flex-direction:column; gap:.5rem; min-width:0; }
  .selected-preview { padding:.7rem; border:1px solid var(--card-line); border-radius:var(--radius); }
  .details h2,.details p { margin:0; overflow-wrap:anywhere; }
  .details span,.history time { font-size:12px; }
  .image-button { display:block; width:100%; padding:0; overflow:hidden; border:0; }
  .image-button img { display:block; width:100%; height:auto; max-height:55dvh; object-fit:contain; }
  .history button { display:flex; flex-direction:column; align-items:stretch; text-align:left; overflow-wrap:anywhere; gap:.3rem; }
  .chosen { border-color:var(--ok); }
  pre { white-space:pre-wrap; overflow-wrap:anywhere; min-width:0; }
  dialog { color:var(--fg); background:var(--bg); border:1px solid var(--line); border-radius:var(--radius); padding:.5rem; width:96vw; max-width:96vw; height:92dvh; max-height:92dvh; }
  dialog[open] { display:flex; flex-direction:column; gap:.5rem; }
  dialog::backdrop { background:#000b; }
  .zoom-toolbar { display:flex; gap:.5rem; flex:none; }
  .zoom-toolbar button { flex:1; min-width:0; }
  .zoom-scroll { overflow:auto; min-height:0; flex:1; }
  .zoom-scroll img { max-width:100%; height:auto; display:block; }
  .zoom-scroll img.full { max-width:none; }
</style>
