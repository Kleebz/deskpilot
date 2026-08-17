<script>
  import { api, post } from "./api.js";

  let { onstatus } = $props();

  // Three separate things have to line up for a push to arrive: a registered
  // service worker, granted permission, and a subscription the server knows
  // about. They fail independently, so the button reports which one is missing
  // rather than pretending it is a single switch — "denied" in particular is
  // unrecoverable from here and has to say so, because the browser will never
  // prompt again and the fix is in system settings.
  const supported = "serviceWorker" in navigator &&
    "PushManager" in window && "Notification" in window;

  let mode = $state("checking");   // checking | unsupported | off | on | denied
  let busy = $state(false);

  $effect(() => { look(); });

  async function look() {
    if (!supported) { mode = "unsupported"; return; }
    if (Notification.permission === "denied") { mode = "denied"; return; }
    try {
      const reg = await navigator.serviceWorker.ready;
      mode = (await reg.pushManager.getSubscription()) ? "on" : "off";
    } catch {
      mode = "off";
    }
  }

  // applicationServerKey is the one place the browser insists on raw bytes
  // rather than the base64url every other part of this exchange uses.
  function keyBytes(s) {
    const pad = s.replace(/-/g, "+").replace(/_/g, "/") +
      "=".repeat((4 - (s.length % 4)) % 4);
    const bin = atob(pad);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  }

  async function enable() {
    busy = true;
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        mode = perm === "denied" ? "denied" : "off";
        onstatus("notifications not granted", true);
        return;
      }
      const { key } = await api("/push/key");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(key),
      });
      const r = await post("/push/subscribe", sub.toJSON());
      mode = "on";
      onstatus(`notifications on · ${r.devices} device${r.devices === 1 ? "" : "s"}`);
    } catch (e) {
      onstatus(e.message, true);
      await look();
    } finally {
      busy = false;
    }
  }

  async function disable() {
    busy = true;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await post("/push/unsubscribe", { endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      mode = "off";
      onstatus("notifications off");
    } catch (e) {
      onstatus(e.message, true);
    } finally {
      busy = false;
    }
  }

  async function test() {
    busy = true;
    try {
      await post("/push/test", {});
      onstatus("test sent");
    } catch (e) { onstatus(e.message, true); } finally { busy = false; }
  }
</script>

{#if mode !== "checking" && mode !== "unsupported"}
  <div class="notify">
    <span class="lbl">notifications</span>
    {#if mode === "denied"}
      <span class="hint">blocked — allow them for this site in your browser settings</span>
    {:else if mode === "on"}
      <button class="sm" disabled={busy} onclick={test}>test</button>
      <button class="sm" disabled={busy} onclick={disable}>turn off</button>
    {:else}
      <button class="sm go" disabled={busy} onclick={enable}>
        {busy ? "…" : "turn on"}
      </button>
    {/if}
  </div>
{/if}

<style>
  .notify {
    display: flex; align-items: center; gap: .4rem; flex-wrap: wrap;
    min-width: 0; padding: .5rem;
    border: 1px solid var(--card-line); border-radius: var(--radius);
    background: var(--panel);
  }
  .lbl { font-size: 12px; color: var(--dim); flex: 1 1 auto; min-width: 0; }
  .hint { font-size: 11.5px; color: var(--dim); flex: 1 1 100%; }
  .notify button { min-height: 44px; }
</style>
