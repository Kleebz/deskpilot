<script>
  // Installing matters more than it sounds: standalone mode drops the browser
  // chrome, which is ~100px of vertical space back on a phone, and iOS exempts
  // installed apps from the localStorage eviction that would otherwise lose the
  // token after a week of not using it.
  //
  // Android exposes beforeinstallprompt and can do it in one tap. iOS has no
  // API at all — Add to Home Screen lives in the Share sheet — so the honest
  // thing there is instructions rather than a button that cannot work.

  let deferred = $state(null);
  let installed = $state(false);
  let dismissed = $state(localStorage.getItem("dp_install_dismissed") === "1");

  const isStandalone = () =>
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;

  const isIOS = () =>
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPadOS reports as a Mac; the touch check separates them
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  let standalone = $state(isStandalone());
  const ios = isIOS();

  $effect(() => {
    const onPrompt = (e) => { e.preventDefault(); deferred = e; };
    const onInstalled = () => { installed = true; deferred = null; };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    const mq = window.matchMedia("(display-mode: standalone)");
    const onMode = () => (standalone = isStandalone());
    mq.addEventListener?.("change", onMode);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      mq.removeEventListener?.("change", onMode);
    };
  });

  async function install() {
    if (!deferred) return;
    deferred.prompt();
    const { outcome } = await deferred.userChoice;
    if (outcome === "accepted") installed = true;
    deferred = null;
  }

  function dismiss() {
    dismissed = true;
    localStorage.setItem("dp_install_dismissed", "1");
  }

  const show = $derived(!standalone && !installed && !dismissed && (deferred || ios));
</script>

{#if show}
  <div class="install">
    {#if deferred}
      <span class="txt">Add to your home screen for a full-screen app.</span>
      <button class="sm go" onclick={install}>install</button>
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
