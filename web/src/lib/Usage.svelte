<script>
  import { api } from "./api.js";

  let { onstatus } = $props();

  // Records are written by omarchy-agent-usage-update on its own schedule, so
  // polling faster than it writes only burns battery. Its default is 15
  // minutes; this checks a little more often so a fresh write is picked up
  // without waiting a whole cycle for it.
  const POLL_MS = 5 * 60 * 1000;
  const STALE_MS = 30 * 60 * 1000;

  let agents = $state([]);
  let now = $state(Date.now());

  async function load() {
    try {
      agents = await api("/usage");
    } catch (e) {
      onstatus?.(e.message, true);
    }
  }

  $effect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    const tick = setInterval(() => (now = Date.now()), 30_000);
    return () => { clearInterval(id); clearInterval(tick); };
  });

  // Only records that actually declare a window. A limit with no reset time is
  // a slot the collector knows about but has nothing to say about yet — the
  // Fable weekly allowance reports exactly that — and drawing it as a
  // confident 0% claims knowledge this does not have.
  const shown = $derived(
    agents
      .map((a) => ({ ...a, limits: (a.limits ?? []).filter((l) => l.resetsAt) }))
      .filter((a) => a.limits.length),
  );

  // Status, not a gradient. A continuous green-to-red ramp reads as "slightly
  // worse than a moment ago" at every point and never announces anything; a
  // small fixed scale has thresholds you can actually act on. Each band ships
  // with a word as well as a colour, because a status colour must never be the
  // only thing carrying the meaning.
  function band(pct) {
    if (pct < 0.6) return { key: "good", word: "comfortable" };
    if (pct < 0.8) return { key: "warning", word: "getting tight" };
    if (pct < 0.95) return { key: "serious", word: "running low" };
    return { key: "critical", word: "nearly out" };
  }

  // "in 3h 57m" rather than a timestamp: this is read on a phone to decide
  // whether to start something now.
  function until(iso) {
    const ms = new Date(iso).getTime() - now;
    if (!isFinite(ms)) return "";
    if (ms <= 0) return "resetting";
    const m = Math.round(ms / 60000);
    if (m < 60) return `in ${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `in ${h}h ${m % 60}m`;
    return `in ${Math.floor(h / 24)}d ${h % 24}h`;
  }

  const R = 26;
  const C = 2 * Math.PI * R;
</script>

{#each shown as a (a.id)}
  {@const hero = a.limits[0]}
  {@const rest = a.limits.slice(1)}
  {@const b = band(hero.percent)}
  {@const stale = a.updatedAt && now - new Date(a.updatedAt).getTime() > STALE_MS}

  <div class="usage" class:stale>
    <svg class="ring" viewBox="0 0 64 64" role="img"
         aria-label="{a.name}: {Math.round(hero.percent * 100)}% of {hero.label} used, {b.word}">
      <circle cx="32" cy="32" r={R} class="track" />
      <!-- Starts at twelve o'clock and fills clockwise as the allowance is
           consumed, so a fuller ring means less headroom.

           Sized with dasharray rather than revealed with dashoffset. The
           offset form draws the arc backwards — it shifts the pattern, so what
           you see is the tail of the dash rather than its head, and the ring
           grows anticlockwise. Confirmed by rendering: at 25% the offset form
           filled the upper-left quadrant, this one fills the upper-right. -->
      <circle cx="32" cy="32" r={R} class="arc {b.key}"
              stroke-dasharray="{Math.min(hero.percent, 1) * C} {C}"
              transform="rotate(-90 32 32)" />
    </svg>

    <div class="body">
      <div class="head">
        <span class="name">{a.name}</span>
        {#if a.tierLabel}<span class="tier">{a.tierLabel}</span>{/if}
      </div>
      <!-- The number is what is LEFT, which is the question being asked, while
           the ring shows what has gone. The word beside it is the status
           channel; the colour alone never carries it. -->
      <div class="left">
        <b class={b.key}>{Math.round((1 - hero.percent) * 100)}%</b> left
        <span class="word {b.key}">· {b.word}</span>
      </div>
      <div class="rows">
        <div class="row">
          <span class="lbl">{hero.label}</span>
          <span class="when">{until(hero.resetsAt)}</span>
        </div>
        {#each rest as l (l.label)}
          {@const lb = band(l.percent)}
          <div class="row">
            <span class="lbl">{l.label}</span>
            <span class="bar"><i class={lb.key} style="width:{Math.min(l.percent, 1) * 100}%"></i></span>
            <span class="when">{until(l.resetsAt)}</span>
          </div>
        {/each}
      </div>
      {#if stale}
        <div class="warn">
          Not updating — the Omarchy agents widget writes these, and it has not
          for {Math.round((now - new Date(a.updatedAt).getTime()) / 60000)} minutes.
        </div>
      {/if}
    </div>
  </div>
{/each}

<style>
  /* Status steps, contrast-checked against this panel (#11131c) rather than
     assumed: good 5.52, warning 10.10, serious 7.02, critical 3.86 — all clear
     the 3:1 floor for a non-text mark. */
  .usage {
    --good: #0ca30c;
    --warning: #fab219;
    --serious: #ec835a;
    --critical: #d03b3b;

    display: flex; align-items: center; gap: .7rem; min-width: 0;
    padding: .55rem; border: 1px solid var(--card-line);
    border-radius: var(--radius); background: var(--panel);
  }
  .usage.stale { opacity: .55; }

  .ring { width: 58px; height: 58px; flex: 0 0 auto; }
  .track { fill: none; stroke: var(--line); stroke-width: 7; }
  .arc {
    fill: none; stroke-width: 7; stroke-linecap: round;
    transition: stroke-dasharray .4s ease, stroke .4s ease;
  }
  .arc.good { stroke: var(--good); }
  .arc.warning { stroke: var(--warning); }
  .arc.serious { stroke: var(--serious); }
  .arc.critical { stroke: var(--critical); }

  .body { flex: 1 1 auto; min-width: 0; }
  .head { display: flex; align-items: baseline; gap: .4rem; min-width: 0; }
  .name {
    font-weight: 600; font-size: 12.5px; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .tier { font-size: 11px; color: var(--dim); flex: 0 0 auto; }

  .left { font-size: 12px; color: var(--dim); margin: .1rem 0 .25rem; }
  .left b { font-size: 15px; font-weight: 700; }
  .left b.good, .word.good { color: var(--good); }
  .left b.warning, .word.warning { color: var(--warning); }
  .left b.serious, .word.serious { color: var(--serious); }
  .left b.critical, .word.critical { color: var(--critical); }
  .word { font-size: 11.5px; }

  .rows { display: flex; flex-direction: column; gap: .18rem; }
  .row { display: flex; align-items: center; gap: .4rem; font-size: 11px; color: var(--dim); }
  .lbl { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .when { margin-left: auto; flex: 0 0 auto; }

  /* The secondary limits get a thin bar rather than a second ring: two equal
     rings compete for the eye and neither wins. */
  .bar {
    flex: 1 1 auto; min-width: 28px; height: 4px; border-radius: 2px;
    background: var(--line); overflow: hidden;
  }
  .bar i { display: block; height: 100%; border-radius: 2px; }
  .bar i.good { background: var(--good); }
  .bar i.warning { background: var(--warning); }
  .bar i.serious { background: var(--serious); }
  .bar i.critical { background: var(--critical); }

  .warn { font-size: 11px; color: var(--dim); margin-top: .3rem; line-height: 1.4; }

  @media (prefers-reduced-motion: reduce) {
    .arc { transition: none; }
  }
</style>
