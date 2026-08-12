<script>
  import { api, post } from "./api.js";

  let { win, workspaces, onstatus, onchanged, self = false } = $props();

  let shot = $state(null);      // object URL, kept across polls
  let busy = $state(false);

  const mode = $derived(
    win.fullscreen !== 0 ? "fs" : win.floating ? "float" : "tiled"
  );

  async function act(fn, msg) {
    busy = true;
    try { await fn(); onstatus(msg); onchanged(); }
    catch (e) { onstatus(e.message, true); }
    finally { busy = false; }
  }

  const tile = () =>
    act(() => post("/desk/tile", { address: win.address }), "tiled");

  const move = (ev) => {
    const ws = ev.currentTarget.value;
    ev.currentTarget.value = "";
    if (!ws) return;
    act(() => post("/desk/move", { address: win.address, workspace: Number(ws) }),
        `moved → ws${ws}`);
  };

  async function look() {
    busy = true;
    try {
      const blob = await api(`/desk/shot?address=${encodeURIComponent(win.address)}`);
      if (shot) URL.revokeObjectURL(shot);
      shot = URL.createObjectURL(blob);
      onstatus(`${Math.round(blob.size / 1024)} KB`);
    } catch (e) { onstatus(e.message, true); }
    finally { busy = false; }
  }

  let zoom = $state(false);

  function clearShot() {
    if (shot) URL.revokeObjectURL(shot);
    shot = null;
    zoom = false;
  }
</script>

<!-- Two lines: three controls plus a title on one 390px row left about 150px
     for the title, which truncated everything to "Alacritty jaco…". -->
<div class="win" class:self>
  <div class="head">
    {#if self}<span class="tag">this</span>{/if}
    <span class="cls">{win.class}</span>
    <span class="ttl dim">{win.title}</span>
    <span class="mode">{mode}</span>
  </div>
  <div class="acts">
    <button class="sm" disabled={busy} onclick={tile}>tile</button>
    <select class="sm" disabled={busy} onchange={move}>
      <option value="">move →</option>
      {#each workspaces as n}<option value={n}>screen {n}</option>{/each}
    </select>
    <button class="sm" disabled={busy} onclick={look}>look</button>
  </div>
</div>

{#if shot}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
  <img class="thumb" src={shot} alt="{win.class} window" onclick={() => (zoom = true)} />
{/if}

{#if zoom}
  <!-- A 1200px capture shown at 375px tells you something rendered, not what it
       says. Full screen with native scrolling and pinch-zoom does. -->
  <div class="lightbox">
    <div class="lbbar">
      <span class="lbname">{win.class}</span>
      <button class="sm" onclick={() => (zoom = false)}>close</button>
      <button class="sm" onclick={clearShot}>discard</button>
    </div>
    <div class="lbscroll"><img src={shot} alt="{win.class} window, full size" /></div>
  </div>
{/if}

<style>
  .win {
    display: flex; flex-direction: column; gap: .4rem; min-width: 0;
    background: var(--card);
    border: 1px solid var(--card-line); border-radius: var(--radius);
    padding: .45rem .5rem;
  }
  .win.self { border-color: color-mix(in srgb, var(--ok) 45%, var(--card-line)); }
  .head { display: flex; align-items: baseline; gap: .35rem; min-width: 0; }
  .cls { font-size: 12px; flex: none; }
  .ttl {
    flex: 1; min-width: 0; font-size: 12px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .mode { font-size: 9px; color: var(--dim); text-transform: uppercase; flex: none; }
  .acts { display: flex; gap: .35rem; min-width: 0; }
  .acts :global(button) { flex: none; }
  .acts select { flex: 1; min-width: 0; font-size: 12px; }
  /* A session and the terminal hosting it are the same thing. Listing both
     without saying so makes one session plus one window look like three. */
  .win.self { border-color: color-mix(in srgb, var(--ok) 45%, var(--line)); }
  .tag {
    font-size: 9px; letter-spacing: .06em; text-transform: uppercase; flex: none;
    color: var(--bg); background: var(--ok); border-radius: 3px; padding: .05rem .25rem;
  }
  .thumb {
    width: 100%; display: block; border-radius: 8px;
    border: 1px solid var(--line);
  }
  .lightbox {
    position: fixed; inset: 0; z-index: 50; background: var(--bg);
    display: flex; flex-direction: column;
  }
  .lbbar {
    display: flex; align-items: center; gap: .4rem; padding: .5rem .6rem;
    border-bottom: 1px solid var(--line);
  }
  .lbname {
    flex: 1; min-width: 0; font-size: 12px; color: var(--dim);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .lbscroll { flex: 1; overflow: auto; touch-action: pinch-zoom pan-x pan-y; }
  .lbscroll img { display: block; max-width: none; }
</style>
