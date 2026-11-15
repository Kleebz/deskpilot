<script>
  export let keyboard=false,terminal=false;
  export let needs=0,openSpaces,openAttention,openComputer;
</script>
<nav class="spaces-tools" class:keyboard class:terminal aria-label="Work navigation">
  <button aria-label="Open spaces" onclick={openSpaces}>☰ Spaces</button>
  <button aria-label="Needs attention" onclick={openAttention}>Needs you <span>{needs}</span></button>
  <button aria-label="Computer" onclick={openComputer}>▣ Computer</button>
</nav>

<style>
.spaces-tools{display:flex;flex:none;justify-content:space-between;gap:4px;padding:5px 12px;border-top:1px solid var(--line);background:var(--panel,#171d14)}.spaces-tools button{min-height:44px;padding:0 7px;font-size:11px;color:var(--muted,var(--dim,#a1ad99))}.spaces-tools button:first-child{color:var(--lime,var(--ok,#c7ef92))}.spaces-tools span{font-size:10px;color:var(--orange,var(--warn,#efb38c))}
.spaces-tools.keyboard{display:none}@media(max-height:520px){.spaces-tools.terminal{display:none}}
</style>
