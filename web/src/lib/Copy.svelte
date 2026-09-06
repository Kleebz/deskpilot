<script>
  import { onMount } from "svelte";
  import { copyText, selectNode } from "./clipboard.js";

  let { session, text, onclose } = $props();

  let pre = $state(null);
  let scroller = $state(null);
  let note = $state("drag to select part of it, or copy the lot");

  const lines = $derived(text ? text.split("\n").length : 0);

  async function all() {
    const how = await copyText(text);
    if (how) {
      note = `${lines} lines on the clipboard`;
      return;
    }
    // No clipboard API and no execCommand — over plain http with a browser that
    // has retired it. Hand the job to the phone, which can always do it.
    selectNode(pre);
    note = "long-press the highlighted text → Copy";
  }

  onMount(() => {
    // Opens where you were looking. The interesting text is nearly always the
    // last thing printed, and a sheet that starts a thousand lines above it
    // reads as having loaded the wrong session.
    scroller?.scrollTo(0, scroller.scrollHeight);
  });
</script>

<!-- Full screen, like the window lightbox: this is text you are going to read
     and drag a selection across, and a modal that leaves the app visible behind
     it is a modal you keep dismissing by accident. -->
<div class="sheet">
  <div class="bar">
    <span class="name">{session}</span>
    <span class="count">{lines} lines</span>
    <button class="sm" onclick={all}>copy all</button>
    <button class="sm" onclick={onclose}>close</button>
  </div>

  <div class="scroll" bind:this={scroller}>
    <!-- Plain text, deliberately. The terminal renders to a canvas, where the
         phone's own selection handles have nothing to grab — this is the same
         bytes as a DOM node so long-press, the magnifier and the drag handles
         all behave as they do in any other app. -->
    <pre bind:this={pre}>{text}</pre>
  </div>

  <div class="note">{note}</div>
</div>

<style>
  .sheet {
    position: fixed; inset: 0; z-index: 60; background: var(--bg);
    display: flex; flex-direction: column;
  }
  .bar {
    display: flex; align-items: center; gap: .4rem; min-width: 0;
    padding: .5rem .6rem; border-bottom: 1px solid var(--line);
  }
  .name {
    flex: 1; min-width: 0; font-size: 12px; color: var(--ok);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .count { font-size: 11px; color: var(--dim); flex: none; }
  .scroll {
    flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden;
    padding: .5rem .6rem;
    /* Vertical panning only — a sideways drag here is the start of a selection,
       not a swipe to the next screen. */
    touch-action: pan-y pinch-zoom;
  }
  pre {
    margin: 0; font-size: 12px; line-height: 1.45;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    color: var(--fg);
    /* Wrapping changes what is displayed, never what is copied: a wrapped line
       is still one line in the buffer and comes out of a selection as one. */
    white-space: pre-wrap; overflow-wrap: anywhere;
    -webkit-user-select: text; user-select: text;
    -webkit-touch-callout: default;
  }
  .note {
    font-size: 11px; color: var(--dim); border-top: 1px solid var(--line);
    padding: .5rem .6rem;
    padding-bottom: calc(.5rem + env(safe-area-inset-bottom, 0px));
  }
</style>
