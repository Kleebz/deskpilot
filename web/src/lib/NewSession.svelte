<script>
  import { api, post, waitFor } from "./api.js";

  let { ws, taken, onstatus, onchanged, oncancel } = $props();

  // The old flow hardcoded bash in $HOME, which meant you could not start an
  // agent on a project from your phone — the thing this exists for.
  const PRESETS = [
    { label: "shell", cmd: "bash" },
    { label: "claude", cmd: "claude" },
    { label: "continue", cmd: "claude --continue" },
  ];

  let dirs = $state([]);
  let dir = $state("");
  let name = $state("");
  let preset = $state("claude");
  let custom = $state("");
  let busy = $state(false);
  let touchedName = $state(false);

  const command = $derived(preset === "custom" ? custom.trim() : preset);

  $effect(() => {
    api("/dirs")
      .then((d) => { dirs = d; if (!dir) dir = d[1] ?? d[0] ?? ""; })
      .catch((e) => onstatus(e.message, true));
  });

  // Name follows the directory until you type your own — same rule as the
  // shell wrapper, so a session is named for its project either way.
  $effect(() => {
    if (touchedName || !dir) return;
    const base = dir.split("/").filter(Boolean).pop() ?? "s";
    name = uniquify(base.replace(/[^A-Za-z0-9_.-]/g, "-"));
  });

  function uniquify(base) {
    if (!taken.includes(base)) return base;
    for (let i = 2; i < 99; i++) if (!taken.includes(`${base}-${i}`)) return `${base}-${i}`;
    return base;
  }

  async function create() {
    if (!name.trim()) { onstatus("name required", true); return; }
    if (taken.includes(name.trim())) { onstatus(`"${name}" already exists`, true); return; }
    if (!command) { onstatus("pick something to run", true); return; }
    busy = true;
    try {
      await post("/sessions", { name: name.trim(), path: dir, command, workspace: ws });
      await waitFor(async () => {
        const list = await api("/sessions");
        return list.some((s) => s.session === name.trim() && s.workspace === ws);
      });
      onstatus(`${name} · ${command} · screen ${ws}`);
      onchanged();
    } catch (e) { onstatus(e.message, true); }
    finally { busy = false; }
  }
</script>

<div class="form">
  <label>
    <span class="lbl">directory</span>
    <select bind:value={dir}>
      {#each dirs as d}<option value={d}>{d.replace(/^\/home\/[^/]+/, "~")}</option>{/each}
    </select>
  </label>

  <label>
    <span class="lbl">run</span>
    <div class="presets">
      {#each PRESETS as p}
        <button class="sm" class:sel={preset === p.cmd} onclick={() => (preset = p.cmd)}>
          {p.label}
        </button>
      {/each}
      <button class="sm" class:sel={preset === "custom"} onclick={() => (preset = "custom")}>
        other
      </button>
    </div>
  </label>

  {#if preset === "custom"}
    <input bind:value={custom} placeholder="command" autocapitalize="off" autocorrect="off" />
  {/if}

  <label>
    <span class="lbl">name</span>
    <input
      bind:value={name}
      oninput={() => (touchedName = true)}
      placeholder="session name" autocapitalize="off" autocorrect="off" />
  </label>

  <div class="acts">
    <button onclick={oncancel}>cancel</button>
    <button class="go" disabled={busy} onclick={create}>
      {busy ? "starting…" : `start on screen ${ws}`}
    </button>
  </div>
</div>

<style>
  .form {
    display: flex; flex-direction: column; gap: .5rem; min-width: 0;
    border: 1px solid var(--line); border-radius: 8px; padding: .6rem;
  }
  label { display: flex; flex-direction: column; gap: .25rem; min-width: 0; }
  .lbl { font-size: .65rem; letter-spacing: .09em; text-transform: uppercase; color: var(--dim); }
  select, input { width: 100%; min-width: 0; }
  .presets { display: flex; gap: .3rem; flex-wrap: wrap; min-width: 0; }
  .presets button.sel { border-color: var(--ok); color: var(--ok); }
  .acts { display: flex; gap: .4rem; min-width: 0; }
  .acts button { flex: 1; min-width: 0; }
  .acts .go { border-color: var(--ok); color: var(--ok); }
</style>
