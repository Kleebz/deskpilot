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

  // The server refuses anything outside this set rather than escaping it, since
  // the name reaches tmux. Enforce it here so a space produces guidance in the
  // field instead of "bad session name" after a round trip.
  const OK = /^[A-Za-z0-9_.-]{1,64}$/;
  const clash = $derived(taken.includes(name.trim()));
  const nameProblem = $derived(
    !name.trim() ? "required"
    : !OK.test(name.trim()) ? "letters, numbers, dot, dash, underscore only"
    : clash ? "already in use"
    : "",
  );

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
    if (nameProblem) { onstatus(`name: ${nameProblem}`, true); return; }
    if (!command) { onstatus("pick something to run", true); return; }
    busy = true;
    const n = name.trim();
    try {
      await post("/sessions", { name: n, path: dir, command, workspace: ws });
    } catch (e) {
      onstatus(e.message, true);
      busy = false;
      return;
    }
    // Creation succeeded. The window takes a moment to appear, and if it never
    // does the session still exists — reporting that as a failure would be a
    // lie that also hides a working session.
    onstatus(`${n} created, opening window…`);
    const placed = await waitFor(async () => {
      const list = await api("/sessions");
      return list.some((s) => s.session === n && s.workspace === ws);
    });
    onstatus(placed
      ? `${n} · ${command} · screen ${ws}`
      : `${n} created but has no window yet — see the sessions index`);
    busy = false;
    onchanged();
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
      class:bad={touchedName && nameProblem}
      bind:value={name}
      oninput={(e) => {
        touchedName = true;
        // spaces are the common case; turn them into something legal as you type
        const fixed = e.currentTarget.value.replace(/\s+/g, "-");
        if (fixed !== e.currentTarget.value) name = fixed;
      }}
      placeholder="session name" autocapitalize="off" autocorrect="off" />
    {#if touchedName && nameProblem}
      <span class="hint err">{nameProblem}</span>
    {/if}
  </label>

  <div class="acts">
    <button onclick={oncancel}>cancel</button>
    <button class="go" disabled={busy || !!nameProblem} onclick={create}>
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
  .acts .go:disabled { border-color: var(--line); color: var(--dim); }
  input.bad { border-color: var(--err); }
  .hint { font-size: 11px; }
</style>
