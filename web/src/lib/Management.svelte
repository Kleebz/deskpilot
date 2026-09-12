<script>
  import { onDestroy } from "svelte";
  import {
    hosts, currentHost as viewHost, displayName, setHostAlias, removeHost,
  } from "./hosts.svelte.js";
  import { api as requestApi, post as requestPost, enroll as requestEnroll, setToken } from './api.js';
  import Usage from './Usage.svelte';
  import Notify from './Notify.svelte';
  import Install from './Install.svelte';
  let { onstatus: reportStatus, connected = true } = $props();
  const actionHost = viewHost();
  let mounted = true;
  onDestroy(() => mounted = false);
  const onstatus = (...args) => { if (mounted && viewHost().origin === actionHost.origin) reportStatus?.(...args); };
  const api = (path, opts = {}) => requestApi(path, { ...opts, host: actionHost });
  const post = (path, body, opts = {}) => requestPost(path, body, { ...opts, host: actionHost });
  const enroll = async code => {
    const result = await requestEnroll(code, actionHost, { activate: false });
    if (mounted && viewHost().origin === actionHost.origin) setToken(result.token);
    return result;
  };
  const ago = t => t ? new Date(t).toLocaleString() : 'never';
  // Paired devices. This is the half that makes a lost phone survivable: a
  // credential you can take away on its own, and a list honest enough to tell
  // you which one you are holding.
  let devices = $state([]);
  let legacy = $state(false);
  let renamingMachine = $state(false);
  let machineNameInput = $state("");
  let renamingDevice = $state("");
  let deviceNameInput = $state("");
  // Entering a code on a device that is already in. The gate in App.svelte only
  // renders when you are *not* authenticated, so a phone already paired had
  // nowhere to type one — while the notice above it said "pair it again below"
  // to trade the shared token for its own. It was telling you to do something
  // the app gave you no way to do.
  let ownCode = $state("");
  let claiming = $state(false);

  // A device on the shared credential already holds full access to this
  // machine, so minting a code and spending it on itself grants nothing it
  // could not already do — it only trades a credential that cannot be taken
  // away for one that can. Both calls are already available to it: /devices/code
  // is authenticated and this device is authenticated. So there is no reason to
  // make someone carry a code from one half of a screen to the other.
  let upgrading = $state(false);
  async function claimOwnCredential() {
    if (upgrading) return;
    upgrading = true;
    try {
      const { code } = await post("/devices/code", {});
      await enroll(code, viewHost());
      onstatus("this device now has its own credential");
      loadDevices(hosts.current);
    } catch (e) {
      onstatus(e.message, true);
    } finally {
      upgrading = false;
    }
  }

  async function claimOwn(ev) {
    ev.preventDefault();
    const code = ownCode.trim();
    if (!code || claiming) return;
    claiming = true;
    try {
      await enroll(code, viewHost());
      ownCode = "";
      onstatus("this device now has its own credential");
      loadDevices(hosts.current);
    } catch (e) {
      onstatus(e.message, true);
    } finally {
      claiming = false;
    }
  }

  async function loadDevices(here) {
    try {
      const d = await api("/devices");
      // The list belongs to one machine. Arriving after a switch, it belongs
      // to the wrong one.
      if (!mounted || hosts.current !== here) return;
      devices = d.devices;
      legacy = d.legacy;
    } catch (e) { onstatus(`Could not load authorized devices: ${e.message}`, true); }
  }

  // Read the machine *synchronously*, or this effect tracks nothing at all:
  // api() only resolves which host it is talking to after its first await, so
  // `$effect(() => { loadDevices(); })` had no dependency on the selection and
  // never re-ran. Measured: zero /devices requests across a switch, leaving
  // one machine's paired devices — and its pairing code — on screen under
  // another machine's name, with a revoke button that posted the first
  // machine's device ids to the second.
  $effect(() => {
    const here = hosts.current;
    devices = [];
    legacy = false;
    // Rename forms belong to the machine this component mounted for. Closing
    // them on a switch prevents a stale form acting on the next machine.
    renamingMachine = false;
    renamingDevice = "";
    if (connected) loadDevices(here);
  });

  async function revokeDevice(d) {
    try {
      const r = await post("/devices/revoke", { id: d.id });
      onstatus(r.self ? "revoked this device — reload to re-pair" : `revoked ${d.name}`);
      loadDevices(hosts.current);
    } catch (e) { onstatus(e.message, true); }
  }

  function startMachineRename() {
    machineNameInput = displayName(viewHost());
    renamingMachine = true;
  }

  function saveMachineRename(ev) {
    ev.preventDefault();
    const name = machineNameInput.trim();
    if (!name) return;
    setHostAlias(actionHost.origin, name === actionHost.name ? "" : name);
    renamingMachine = false;
    onstatus(`machine label saved as ${displayName(actionHost)}`);
  }

  function resetMachineName() {
    setHostAlias(actionHost.origin, "");
    renamingMachine = false;
    onstatus(`machine label reset to ${displayName(actionHost)}`);
  }

  function startDeviceRename(d) {
    renamingDevice = d.id;
    deviceNameInput = d.name;
  }

  async function saveDeviceRename(ev, d) {
    ev.preventDefault();
    const name = deviceNameInput.trim();
    if (!name || name === d.name) { renamingDevice = ""; return; }
    try {
      await post("/devices/rename", { id: d.id, name });
      renamingDevice = "";
      onstatus(`renamed device to ${name}`);
      loadDevices(hosts.current);
    } catch (e) { onstatus(e.message, true); }
  }

</script>
<h1 tabindex="-1">Management</h1>
<h2>Selected remote machine</h2>
<div class="machine-summary">
  <p><strong>{displayName(viewHost())}</strong><br />
    {#if actionHost.alias}<span class="dim">Reported as {actionHost.name}</span><br />{/if}
    <span class="dim">{actionHost.origin}</span>
  </p>
  <button class="sm" onclick={startMachineRename}>rename label</button>
</div>
<p class="dim machine-hint">This label is stored only in this app and does not rename the machine.</p>
{#if renamingMachine}
  <form class="unlock machine-rn" onsubmit={saveMachineRename}>
    <input bind:value={machineNameInput} maxlength="40" aria-label="machine label" />
    <button disabled={!machineNameInput.trim()}>save</button>
    <button type="button" onclick={() => (renamingMachine = false)}>cancel</button>
    {#if actionHost.alias}<button type="button" onclick={resetMachineName}>use reported name</button>{/if}
  </form>
{/if}
<p class="dim">Version {hosts.caps[hosts.current]?.version ?? 'unknown'}</p>
{#if hosts.list.length > 1}<button class="danger" onclick={() => removeHost(hosts.current)}>Forget this machine</button>{/if}
{#if connected}
  {#if legacy}
    <div class="legacybar">
      <span>
        This device shares the machine's key, so it cannot be revoked on its own.
        Losing the phone would mean re-pairing everything else.
      </span>
      <button class="sm" onclick={claimOwnCredential} disabled={upgrading}>
        {upgrading ? "…" : "give it its own"}
      </button>
    </div>
  {/if}

  <div class="mblock">
  <h2>Authorized devices · {devices.length}</h2>

  {#each devices as d (d.id)}
    <div class="row">
      <div class="go">
        <span class="badge" class:live={d.current}>{d.current ? "this" : "•"}</span>
        <span class="nm">{d.name}</span>
        <span class="path dim">last used {ago(d.lastSeen)}</span>
      </div>
      <button class="sm" onclick={() => startDeviceRename(d)}>rename</button>
      <button class="sm danger" onclick={() => revokeDevice(d)}>revoke</button>
    </div>
    {#if renamingDevice === d.id}
      <form class="unlock rn device-rn" onsubmit={(ev) => saveDeviceRename(ev, d)}>
        <input bind:value={deviceNameInput} maxlength="40" aria-label="device name" />
        <button>save</button>
        <button type="button" onclick={() => (renamingDevice = "")}>cancel</button>
      </form>
    {/if}
  {/each}

  <div class="hint dim">
    These devices can access the selected machine. Run <code>deskpilot pair</code> on this machine to authorize another — it prints a QR
    carrying the address and a one-time code together. Revoking here takes one
    device's credential away and leaves the rest paired.
  </div>

  {#if legacy}
    <!-- Somewhere to type a code on a device that is already in: the gate that
         accepts one renders only while you are *not* authenticated, so a paired
         phone had nowhere at all. Beside the one-tap button above, for a code
         carried from `deskpilot pair` on the machine itself. -->
    <form class="unlock claim" onsubmit={claimOwn}>
      <input
        bind:value={ownCode} aria-label="Pairing code" placeholder="code, to re-pair this device"
        autocapitalize="characters" autocorrect="off" spellcheck="false" />
      <button disabled={!ownCode.trim() || claiming}>{claiming ? "…" : "use"}</button>
    </form>
  {/if}
  </div>

  <div class="foot"></div>
  <Usage {onstatus} />
  <Notify {onstatus} />
{:else}<p class="dim">Connect to this machine to manage its authorized devices, credentials, usage and notifications.</p>{/if}
  <Install />

<style>
.machine-summary { display:flex; align-items:center; gap:.5rem; min-width:0; }
.machine-summary p { flex:1; min-width:0; overflow-wrap:anywhere; }
.machine-hint { font-size:12px; }
.row { display:flex; flex-wrap:wrap; gap:.5rem; padding:.6rem 0; }
.go { display:flex; flex:1; min-width:0; flex-wrap:wrap; justify-content:flex-start; }
.path { width:100%; overflow-wrap:anywhere; }
.unlock { display:flex; flex-wrap:wrap; gap:.5rem; }
input { min-width:0; flex:1; }
.legacybar,.mblock { padding:.8rem; border:1px solid var(--line); border-radius:10px; }
.hint { color:var(--dim); margin:.6rem 0; }
</style>
