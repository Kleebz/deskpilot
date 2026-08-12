<script>
  import { installable, doInstall } from "./installable.svelte.js";

  // The listener itself lives in installable.svelte.js, armed at page load.
  // This component only renders what that captured — it must not own the
  // listener, because it mounts after the token gate and the event fires
  // before that.

  let dismissed = $state(localStorage.getItem("dp_install_dismissed") === "1");

  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  const show = $derived(
    !installable.standalone && !installable.installed && !dismissed &&
    (installable.prompt || ios),
  );

  function dismiss() {
    dismissed = true;
    localStorage.setItem("dp_install_dismissed", "1");
  }
</script>

{#if show}
  <div class="install">
    {#if installable.prompt}
      <span class="txt">Add to your home screen for a full-screen app.</span>
      <button class="sm go" onclick={doInstall}>install</button>
    {:else}
      <span class="txt">
        Add to your home screen: tap <b>Share</b>, then <b>Add to Home Screen</b>.
      </span>
    {/if}
    <button class="sm ghost" onclick={dismiss} aria-label="dismiss">✕</button>
  </div>
{/if}

<style>
  .install {
    display: flex; align-items: center; gap: .5rem; min-width: 0;
    border: 1px solid color-mix(in srgb, var(--ok) 40%, var(--line));
    border-radius: 8px; padding: .5rem .6rem;
  }
  .txt { flex: 1; min-width: 0; font-size: 11.5px; line-height: 1.45; color: var(--dim); }
  .go { border-color: var(--ok); color: var(--ok); }
  .ghost { border-color: transparent; color: var(--dim); }
</style>
