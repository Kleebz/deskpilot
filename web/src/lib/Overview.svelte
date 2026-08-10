<script>
  import { api, post, waitFor } from "./api.js";

  let { sessions, workspaces, locked, onstatus, onchanged, onjump } = $props();

  // The workspace-swipe model can only show a session that is on a workspace.
  // Detached ones — the normal result of closing a terminal — would otherwise
  // be invisible everywhere, so this pane is the one place that lists all of
  // them regardless of where they are.
  const placed = $derived(sessions.filter((s) => s.workspace !== null));
  const detached = $derived(sessions.filter((s) => s.workspace === null));

  let target = $state({});

  async function adopt(name) {
    const ws = Number(target[name] ?? 0);
    if (!ws) { onstatus("pick a screen first", true); return; }
    try {
      await post("/sessions/attach", { session: name, workspace: ws });
      onstatus(`opening ${name} on screen ${ws}…`);
      await waitFor(async () => {
        const list = await api("/sessions");
        return list.some((s) => s.session === name && s.workspace === ws);
      });
      onchanged();
      onjump(ws);
    } catch (e) { onstatus(e.message, true); }
  }

  async function kill(name) {
    if (!confirm(`Kill session "${name}"? Anything running in it is lost.`)) return;
    try {
      await post("/sessions/kill", { session: name });
      onstatus(`killed ${name}`);
      onchanged();
    } catch (e) { onstatus(e.message, true); }
  }
</script>

<section>
  <h2 class="first">sessions</h2>

  {#if locked}
    <div class="why">Screen is locked. Text still works; captures do not.</div>
  {/if}

  {#if placed.length}
    {#each placed as s (s.session)}
      <button class="row" onclick={() => onjump(s.workspace)}>
        <span class="badge">ws{s.workspace}</span>
        <span class="nm">{s.session}</span>
        <span class="path dim">{s.path}</span>
        <span class="go dim">›</span>
      </button>
    {/each}
  {:else}
    <div class="why">No session has a window right now.</div>
  {/if}

  {#if detached.length}
    <h2>detached · {detached.length}</h2>
    <div class="why">
      Running, but with no window. Closing a terminal detaches a session rather than
      killing it — that is what keeps work alive when your phone drops.
    </div>
    {#each detached as s (s.session)}
      <div class="row static">
        <span class="nm">{s.session}</span>
        <span class="path dim">{s.path}</span>
      </div>
      <div class="acts">
        <select bind:value={target[s.session]}>
          <option value="">screen…</option>
          {#each workspaces as n}<option value={n}>{n}</option>{/each}
        </select>
        <button class="sm" onclick={() => adopt(s.session)}>open</button>
        <button class="sm" onclick={() => kill(s.session)}>kill</button>
      </div>
    {/each}
  {/if}

  <div class="hint dim">Swipe right for screens 1–10.</div>
</section>

<style>
  section {
    flex: 0 0 100%; scroll-snap-align: start;
    display: flex; flex-direction: column; gap: .5rem;
    padding: .7rem; overflow-y: auto;
  }
  h2 {
    margin: .2rem 0 0; font-size: .72rem; letter-spacing: .09em; text-transform: uppercase;
    color: var(--dim); border-top: 1px solid var(--line); padding-top: .5rem;
  }
  h2.first { border-top: 0; padding-top: 0; }
  .row {
    display: flex; align-items: center; gap: .45rem; width: 100%; text-align: left;
    border: 1px solid var(--line); border-radius: 8px; padding: .5rem;
  }
  .row.static { border-style: dashed; }
  .nm { font-weight: 600; color: var(--ok); }
  .path {
    flex: 1; min-width: 0; font-size: 11px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .badge {
    font-size: .6rem; letter-spacing: .08em; text-transform: uppercase;
    color: var(--bg); background: var(--ok); border-radius: 4px; padding: .1rem .3rem;
  }
  .acts { display: flex; gap: .4rem; padding-left: .5rem; }
  .acts select { flex: 1; min-width: 0; }
  .why {
    font-size: 11.5px; color: var(--dim); line-height: 1.5;
    border-left: 2px solid var(--line); padding-left: .5rem;
  }
  .hint { font-size: 11px; margin-top: auto; padding-top: .5rem; }
</style>
