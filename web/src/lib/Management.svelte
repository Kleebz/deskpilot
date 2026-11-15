<script>
  import { onDestroy } from "svelte";
  import {
    hosts, currentHost as viewHost, displayName, setHostAlias, removeHost,
  } from "./hosts.svelte.js";
  import { api as requestApi, post as requestPost } from './api.js';
  import Usage from './Usage.svelte';
  import Notify from './Notify.svelte';
  import Install from './Install.svelte';
  let { onstatus: reportStatus, connected = true, onpair, onwork, herdr = null, page = $bindable('home') } = $props();
  const pages = [['machines','Computers & pairing','Labels, pairing and saved machines'],['devices','Authorized devices','Rename, revoke and re-pair devices'],['notifications','Notifications','Enable, test and repair delivery'],['usage','Agent usage','Remaining allowances and resets'],['connections','Connections','Herdr, desktop and terminal availability'],['app','App & installation','This browser and build version']];
  const actionHost = viewHost();
  let mounted = true;
  onDestroy(() => mounted = false);
  const onstatus = (...args) => { if (mounted && viewHost().origin === actionHost.origin) reportStatus?.(...args); };
  const api = (path, opts = {}) => requestApi(path, { ...opts, host: actionHost });
  const post = (path, body, opts = {}) => requestPost(path, body, { ...opts, host: actionHost });
  const ago = t => t ? new Date(t).toLocaleString() : 'never';
  // Paired devices. This is the half that makes a lost phone survivable: a
  // credential you can take away on its own, and a list honest enough to tell
  // you which one you are holding.
  let devices = $state([]);
  let renamingMachine = $state(false);
  let machineNameInput = $state("");
  let renamingDevice = $state("");
  let deviceNameInput = $state("");
  async function loadDevices(here) {
    try {
      const d = await api("/devices");
      // The list belongs to one machine. Arriving after a switch, it belongs
      // to the wrong one.
      if (!mounted || hosts.current !== here) return;
      devices = d.devices;
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
<div class="settings-heading"><h1 tabindex="-1">Settings</h1>{#if page!=='home'}<button onclick={() => page='home'}>Back to settings</button>{/if}</div>
{#if page==='home'}
  <p class="dim">Selected computer: {displayName(viewHost())}</p>
  <div class="settings-pages">{#each pages as [id,title,detail]}<button aria-label={title} onclick={() => page=id}><strong>{title}</strong><span class="dim">{detail}</span></button>{/each}</div>
{:else if page!=='app'}<p class="dim">For {displayName(viewHost())}</p>{:else}<p class="dim">This browser</p>{/if}
{#if page==='machines'}
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
<button id="settings-pair" class="primary" onclick={onpair}>Pair computer</button>
{/if}
{#if connected}
  {#if page==='devices'}


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


  </div>
  {/if}
  {#if page==='usage'}<h2>Agent usage</h2><Usage {onstatus} />{/if}
  {#if page==='notifications'}<h2>Notifications</h2><Notify {onstatus} />{/if}
{:else if ['devices','usage','notifications'].includes(page)}<p class="dim">Connect to this machine to manage its authorized devices, credentials, usage and notifications.</p>{/if}
{#if page==='app'}<h2>App & installation</h2><p class="dim">UI build {uiBuild}<br/>Backend {hosts.caps[hosts.current]?.version ?? 'unknown'}</p><button disabled={updates.checking} onclick={()=>checkUpdates()}>{updates.checking?'Checking…':'Check for updates'}</button>{#if updates.available}<p role="status">A new UI is ready. Use Reload above to save drafts and update.</p>{:else if updates.error}<p role="status">{updates.error}</p>{:else if updates.checkedAt}<p role="status">Current UI is up to date.</p>{/if}<Install /><p class="dim">If already installed, open Deskpilot from your home screen. Terminal text size is available in each terminal.</p>{/if}
{#if page==='connections'}<h2>Connections</h2><p>Deskpilot · {connected?'Connected':'Unavailable'}</p><p>Herdr · {herdr?.available?'Running':'Unavailable'}</p>{#if herdr?.reason}<p class="dim">{herdr.reason}</p>{/if}<p>Desktop · {hosts.caps[hosts.current]?.windows?'Available':'Headless or unsupported'}</p><button onclick={onwork}>Open Work</button><p class="dim">Version {hosts.caps[hosts.current]?.version ?? 'unknown'}</p>{/if}

<style>
.settings-heading {display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;}
.settings-pages {display:flex;flex-direction:column;gap:8px;}.settings-pages button {display:flex;flex-direction:column;align-items:flex-start;text-align:left;gap:5px;padding:14px;}.settings-pages span {font-size:12px;}
.machine-summary { display:flex; align-items:center; gap:.5rem; min-width:0; }
.machine-summary p { flex:1; min-width:0; overflow-wrap:anywhere; }
.machine-hint { font-size:12px; }
.row { display:flex; flex-wrap:wrap; gap:.5rem; padding:.6rem 0; }
.go { display:flex; flex:1; min-width:0; flex-wrap:wrap; justify-content:flex-start; }
.path { width:100%; overflow-wrap:anywhere; }
.unlock { display:flex; flex-wrap:wrap; gap:.5rem; }
input { min-width:0; flex:1; }
.mblock { padding:.8rem; border:1px solid var(--line); border-radius:10px; }
.hint { color:var(--dim); margin:.6rem 0; }
</style>
