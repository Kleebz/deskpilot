<script>export let kind = 'layout';</script>
<svg viewBox="0 0 600 400" role="img" aria-label={kind === 'part' ? 'Simulated fixture assembly render' : 'Simulated published mobile design'}>
  <defs><pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M 24 0 L 0 0 0 24" fill="none" stroke="#a6c780" stroke-opacity=".1" /></pattern></defs>
  <rect width="600" height="400" fill="#20271f"/><rect width="600" height="400" fill="url(#grid)"/>
  {#if kind === 'part'}
    <g transform="translate(110 60)"><path d="M0 140 220 30 390 110 170 230Z" fill="#a6b7a0"/><path d="M0 140V175L170 270V230Z" fill="#72876b"/><path d="M170 230V270L390 150V110Z" fill="#52654b"/><path d="M70 110 210 40 310 90 170 165Z" fill="#d1dcbd"/><path d="M70 110V40L170 90V165Z" fill="#809a72"/><path d="M70 40 210 0 310 50 170 90Z" fill="#c3d5ad"/><ellipse cx="130" cy="160" rx="14" ry="8" fill="#263422"/><ellipse cx="290" cy="126" rx="14" ry="8" fill="#263422"/></g>
  {:else}
    <g transform="translate(205 24)"><rect width="190" height="352" rx="24" fill="#101410" stroke="#b5c7a6" stroke-width="2"/><rect x="10" y="40" width="170" height="240" rx="10" fill="#1b211a" stroke="#c7ef92"/><text x="23" y="28" fill="#e8efdf" font-size="11" font-family="sans-serif">deskpilot</text><text x="22" y="64" fill="#c7ef92" font-size="10" font-family="monospace">› Return to your flow.</text>{#each [0,1,2,3,4,5,6,7] as n}<rect x="23" y={90+n*17} width={n % 3 === 0 ? 100 : 140} height="4" rx="2" fill={n === 4 ? '#c7ef92' : '#52634a'}/>{/each}<rect x="10" y="292" width="170" height="32" rx="8" fill="#313e2a"/><text x="22" y="312" fill="#b6c0b0" font-size="9" font-family="sans-serif">Reply to this session…</text><circle cx="160" cy="308" r="11" fill="#c7ef92"/></g>
  {/if}
</svg>
