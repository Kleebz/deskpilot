<script>
  import { onMount } from 'svelte';
  let { label, onclose, children, drawer=false, initialScroll=0, onscroll } = $props();
  let dialog;
  onMount(()=>{dialog.showModal();dialog.scrollTop=initialScroll;return()=>dialog?.close();});
</script>
<dialog class:drawer onscroll={e=>onscroll?.(e.currentTarget.scrollTop)} bind:this={dialog} aria-label={label} oncancel={e=>{e.preventDefault();onclose();}}>
  <header><h1>{label}</h1><button aria-label="Close panel" onclick={onclose}>×</button></header>
  {@render children()}
</dialog>
<style>
dialog{width:min(100%,720px);max-height:88dvh;margin:auto auto 0;padding:20px;color:var(--fg);background:var(--panel);border:1px solid var(--card-line);border-radius:20px 20px 0 0;overflow:auto;}dialog::backdrop{background:#050905b8;backdrop-filter:blur(3px);}header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px;}h1{font-size:24px;}header button{width:44px;border:0;font-size:24px;flex:none;}
.drawer{width:min(360px,calc(100% - 16px));height:100dvh;max-height:100dvh;margin:0 auto 0 0;border-radius:0 18px 18px 0;padding:14px;}.drawer header{margin-bottom:12px}.drawer header h1{font-size:16px;color:var(--dim)}
@media(min-width:960px){dialog{margin:auto;border-radius:18px;}}
</style>
