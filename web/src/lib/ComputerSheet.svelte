<script>
  import { onMount } from 'svelte';
  import { displayName } from './hosts.svelte.js';
  let { hosts, current, caps, onchoose, onopen, onpair, onclose } = $props();
  let dialog;
  onMount(() => { dialog.showModal(); return () => dialog?.close(); });
</script>
<dialog bind:this={dialog} class="computer-sheet" aria-label="Computer" oncancel={e=>{e.preventDefault();onclose();}} onclick={e=>{if(e.target===dialog&&e.clientY<dialog.getBoundingClientRect().top)onclose();}}>
  <header><div><span class="eyebrow">YOUR WORK, WHERE YOU LEFT IT</span><h1>Computer</h1></div><button class="sheet-close" aria-label="Close Computer" onclick={onclose}>×</button></header>
  <p class="dim">Switching computers restores their previous view.</p>
  <div class="computers">{#each hosts as host (host.origin)}<button class="computer-row" data-host={host.origin} onclick={()=>onchoose(host.origin)}><span class="computer-icon">▣</span><span><strong>{displayName(host)}</strong><span class="dim">{host.origin}</span></span><span>{host.origin===current?'✓':'→'}</span></button>{/each}</div>
  <div class="tools">
    <button aria-label="Desktop" onclick={()=>onopen('screens')}>Desktop <span>{caps.windows?'Screens & windows →':'Headless / unavailable →'}</span></button>
    <button aria-label="Previews" onclick={()=>onopen('previews')}>Previews <span>Published images →</span></button>
    <button aria-label="Settings" onclick={()=>onopen('management')}>Settings <span>Devices, notifications & connection →</span></button>
    <button id="add-machine" aria-label="Pair computer" onclick={onpair}>Pair computer <span>＋</span></button>
  </div>
</dialog>
<style>
.computer-sheet{color:var(--fg);background:var(--panel);width:min(100%,720px);max-height:88dvh;margin:auto auto 0;padding:22px 22px max(24px,env(safe-area-inset-bottom));border:1px solid var(--card-line);border-radius:22px 22px 0 0;overflow:auto;}
.computer-sheet::backdrop{background:#050905b8;backdrop-filter:blur(3px);}header{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:14px;}h1{font-size:28px;margin:5px 0 0;}.eyebrow{font-size:9px;letter-spacing:1.5px;color:var(--dim);}.sheet-close{width:44px;flex:none;font-size:24px;border:0;}p{font-size:12px;}.computer-row{display:flex;width:100%;justify-content:flex-start;gap:12px;border:0;border-bottom:1px solid var(--line);border-radius:0;padding:16px 0;text-align:left;}.computer-icon{color:var(--ok);font-size:25px;}.computer-row>span:nth-child(2){flex:1;min-width:0;}.computer-row strong{display:block;font-weight:550;}.computer-row .dim{display:block;font-size:11px;margin-top:5px;overflow-wrap:anywhere;}.computer-row>span:last-child{color:var(--ok);}.tools{margin-top:20px;}.tools button{display:flex;width:100%;justify-content:space-between;gap:12px;min-height:56px;border:0;border-bottom:1px solid var(--line);border-radius:0;padding:12px 0;text-align:left;}.tools span{font-size:11px;color:var(--dim);max-width:55%;text-align:right;}
@media(min-width:960px){.computer-sheet{margin:auto;border-radius:18px;max-height:88dvh;}}
</style>
