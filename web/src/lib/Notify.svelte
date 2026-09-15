<script>
  import { onDestroy } from "svelte";
  import { currentHost as viewHost } from "./hosts.svelte.js";
  import { api as requestApi, post as requestPost } from "./api.js";

  let { onstatus: reportStatus } = $props();
  const actionHost = viewHost();
  let mounted = true;
  onDestroy(() => mounted = false);
  const onstatus = (...args) => { if (mounted && viewHost().origin === actionHost.origin) reportStatus?.(...args); };
  const api = (path, opts = {}) => requestApi(path, { ...opts, host: actionHost });
  const post = (path, body, opts = {}) => requestPost(path, body, { ...opts, host: actionHost });


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

  function scopeFor(origin) {
    return `/push/${encodeURIComponent(origin)}/`;
  }

  async function activeRegistration(reg) {
    for (let i = 0; i < 50 && !reg.active; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!reg.active) throw new Error("notification worker did not become ready");
    return reg;
  }

  async function registration() {
    const scope = scopeFor(actionHost.origin);
    const existing = await navigator.serviceWorker.getRegistration(scope);
    if (existing) return activeRegistration(existing);
    const reg = await navigator.serviceWorker.register(
      `/sw.js?machine=${encodeURIComponent(actionHost.origin)}`,
      { scope },
    );
    return activeRegistration(reg);
  }

  $effect(() => { look(); });

  async function look() {
    if (!supported) { mode = "unsupported"; return; }
    if (Notification.permission === "denied") { mode = "denied"; return; }
    try {
      const reg = await registration();
      const sub = await reg.pushManager.getSubscription();
      if (!sub) { mode = "off"; return; }
      const status = await api(`/push/status?endpoint=${encodeURIComponent(sub.endpoint)}`);
      mode = status.registered ? "on" : "repair";
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
      const reg = await registration();
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(key),
      });
      // Before per-machine scopes there was one root subscription. It could
      // only have used the serving machine's VAPID key, so migrate that exact
      // case and retire the duplicate after the owned registration is durable.
      const rootReg = actionHost.origin === location.origin
        ? await navigator.serviceWorker.getRegistration("/")
        : null;
      const old = rootReg && rootReg.scope !== reg.scope
        ? await rootReg.pushManager.getSubscription()
        : null;
      const r = await post("/push/subscribe", {
        ...sub.toJSON(), machine: actionHost.origin,
        ...(old ? { replaceEndpoint: old.endpoint } : {}),
      });
      if (old) await old.unsubscribe();
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
      const reg = await registration();
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
        {busy ? "…" : mode === "repair" ? "repair" : "turn on"}
      </button>
      {#if mode === "repair"}<span class="hint">browser subscription is missing on this machine</span>{/if}
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
