<script>
  import { api, post } from "./api.js";

  let { win, workspaces, onstatus, onchanged } = $props();

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

  function clearShot() {
    if (shot) URL.revokeObjectURL(shot);
    shot = null;
  }
</script>

<div class="win">
  <span class="t">{win.class} <span class="dim">{win.title}</span></span>
  <span class="mode">{mode}</span>
  <button class="sm" disabled={busy} onclick={tile}>tile</button>
  <select class="sm" disabled={busy} onchange={move}>
    <option value="">→</option>
    {#each workspaces as n}<option value={n}>{n}</option>{/each}
  </select>
  <button class="sm" disabled={busy} onclick={look}>look</button>
</div>

{#if shot}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
  <img src={shot} alt="{win.class} window" onclick={clearShot} />
{/if}

<style>
  .win {
    display: flex; gap: .35rem; align-items: center;
    border: 1px solid var(--line); border-radius: 8px; padding: .4rem .5rem;
  }
  .t {
    flex: 1; min-width: 0; font-size: 12px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .mode { font-size: 10px; color: var(--dim); text-transform: uppercase; }
  img {
    width: 100%; display: block; border-radius: 8px;
    border: 1px solid var(--line);
  }
</style>
