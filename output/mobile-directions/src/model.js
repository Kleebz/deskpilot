export const namespace = 'deskpilot-mobile-directions:v1:';
export const directions = {
  spaces: { letter: 'Spaces', name: 'Spaces + tasks', title: 'Your work. In its place.', description: 'Spaces and task tabs for every terminal, with or without Herdr.', home: 'Spaces' },
  combined: { letter: 'A+B', name: 'Focus + Attention', title: 'Return to work. Review when you choose.', description: 'Resume your terminal, search Sessions, and open reported requests across computers in Attention.', home: 'Sessions' },
  focus: { letter: 'A', name: 'Focus deck', title: 'Return to your flow.', description: 'Your terminal takes the lead. Find work in Sessions; everything else lives in Computer.', home: 'Recent work' },
  inbox: { letter: 'B', name: 'Attention inbox', title: 'Pick up what needs you.', description: 'Reported requests across computers, with a complete Library one tap away.', home: 'Attention' },
  explorer: { letter: 'C', name: 'Computer explorer', title: 'Start with a computer.', description: 'Follow the desktop’s organization: computer, space, tab, terminal.', home: 'Computers' },
};
export function fixtures() {
  const computers = [
    { id: 'studio', name: 'Studio', hostname: 'jacob-desktop', health: 'online', desktop: true, management: true, locked: false },
    { id: 'build', name: 'Build server', hostname: 'build-linux', health: 'online', desktop: false, management: false, locked: false },
    { id: 'travel', name: 'Travel laptop', hostname: 'travel-linux', health: 'offline', desktop: true, management: false, locked: true },
  ];
  const names = ['deskpilot', 'api-server', 'docs', 'release', 'shell', 'shell', 'migration', 'logs'];
  const items = names.map((name, i) => ({ id: `tmux-${i}`, computer: 'studio', source: 'Terminal', name, cwd: i === 5 ? '~/personal' : `~/Projects/${i === 4 ? 'deskpilot' : name}`, status: i === 0 ? 'needs' : i === 1 || i === 7 ? 'working' : i === 6 ? 'unknown' : 'idle', workspace: i < 6 ? Math.floor(i / 2) + 1 : null, connected: true, generation: 1 }));
  ['Mobile navigation review', 'Fix the reconnect race without replaying a prompt after authentication', 'deskpilot', 'Investigate build cache'].forEach((name, i) => items.push({ id: `codex-${i}`, computer: 'studio', source: 'Codex', name, cwd: '~/Projects/deskpilot', status: i === 1 ? 'working' : 'unknown', workspace: i < 2 ? 2 : null, connected: i === 0, generation: 1, native: `thread-${i}-a91f` }));
  ['Frontend', 'API', 'Frontend', 'Notes', 'Deploy', 'Tests', 'Scratch', 'Detached shell'].forEach((name, i) => items.push({ id: `herdr-${i}`, computer: 'studio', source: 'Herdr', name, cwd: i < 4 ? '~/Projects/deskpilot' : '~/Projects/herdr', status: i === 0 || i === 4 ? 'needs' : i === 1 || i === 5 ? 'working' : i === 7 ? 'unknown' : 'idle', workspace: 4, connected: i === 0, generation: 1, core: 'core-studio-7', space: i < 4 ? 'Product' : 'Operations', spaceId: i < 4 ? 'space-product' : 'space-ops', tab: i < 2 ? 'Mobile' : i < 4 ? 'Research' : i < 6 ? 'Release' : 'Scratch', tabId: `tab-${Math.floor(i / 2)}`, pane: i % 2 + 1, native: `term-${i}:2026-11-02T08:00:0${i}` }));
  items.push({ id: 'build-job', computer: 'build', source: 'Terminal', name: 'release', cwd: '~/builds/deskpilot', status: 'needs', workspace: null, connected: true, generation: 1 });
  items.push({ id: 'build-shell', computer: 'build', source: 'Terminal', name: 'shell', cwd: '~', status: 'idle', workspace: null, connected: true, generation: 1 });
  items.push({ id: 'build-herdr', computer: 'build', source: 'Herdr', name: 'Worker', cwd: '~/worker', status: 'unknown', workspace: null, space: 'Service', spaceId: 'space-service', tab: 'Headless', tabId: 'tab-headless', pane: 1, native: 'worker:2026-11-01', connected: false, generation: 1 });
  items.push({ id: 'travel-shell', computer: 'travel', source: 'Terminal', name: 'shell', cwd: '~/notes', status: 'unknown', workspace: 1, connected: true, generation: 1 });
  return { computers, items: items.map(i => ({ ...i, outputActive: i.status === 'working', attachment: i.connected ? 'mobile-' + i.id : null })), devices: [{ id: 'phone', computer: 'studio', name: 'Pixel · this browser', seen: 'now' }, { id: 'tablet', computer: 'studio', name: 'Tablet', seen: '2 days ago' }, { id: 'phone-build', computer: 'build', name: 'Pixel · this browser', seen: 'now' }, { id: 'phone-travel', computer: 'travel', name: 'Pixel · this browser', seen: 'yesterday' }], previews: [{ id: 'preview-mobile', computer: 'studio', name: 'Mobile layout', caption: 'Published explicitly from the design task. No terminal ownership is inferred.', time: '10:42', dimensions: '1440 × 960', kind: 'layout' }, { id: 'preview-fixture', computer: 'studio', name: 'Fixture assembly', caption: 'A separate published artifact; available without a terminal.', time: '09:16', dimensions: '1200 × 900', kind: 'part' }] };
}
export function initialState() {
  return { ...fixtures(), computer: 'studio', view: 'home', selected: null, origin: null, sequence: [], sequenceGenerations: {}, drafts: {}, pasteDrafts: {}, logs: {}, recent: ['tmux-0', 'herdr-0', 'codex-0'], query: '', switchQuery: '', filter: 'all', source: 'all', nativeSpace: 'space-product', nativeTab: 'tab-0', workspace: 1, scrolls: {}, visits: {}, workSpaces: [], workAssignments: {}, workExpanded: {}, workQuery: '', workNeeds: false, workAcross: false, textSize: 13, notifyEnabled: {}, pushRegistrations: {}, usageModes: {}, tiled: {}, browserMotion: false, routeVersion: 1 };
}
export function loadState(direction) {
  const fresh = initialState();
  try {
    const saved = JSON.parse(localStorage.getItem(namespace + direction));
    if (saved?.routeVersion !== 1 || !Array.isArray(saved.items) || !Array.isArray(saved.computers)) return fresh;
    const merged = { ...fresh, ...saved };
    if (!merged.computers.some(c => c.id === merged.computer)) return fresh;
    if (merged.view === 'terminal' && !merged.items.some(i => i.id === merged.selected && !i.closed)) merged.view = 'missing';
    return merged;
  } catch { return fresh; }
}
export function persist(direction, state) {
  try { localStorage.setItem(namespace + direction, JSON.stringify(state)); } catch { /* Storage denial must not block work. */ }
}
export function ordered(items) {
  return [...items].sort((a, b) => (a.workspace ?? 999) - (b.workspace ?? 999) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
export function sequenceFor(state, item) {
  const available = state.items.filter(i => !i.closed && i.computer === item.computer);
  return (item.source === 'Herdr' ? available.filter(i => i.source === 'Herdr' && i.tabId === item.tabId && i.spaceId === item.spaceId).sort((a,b) => a.pane - b.pane) : ordered(available.filter(i => i.source !== 'Herdr' && i.connected))).map(i => i.id);
}
export function searchItems(state, { allComputers = false, source = state.source, native = false } = {}) {
  const q = state.query.toLowerCase().trim();
  return ordered(state.items.filter(i => !i.closed && (allComputers || i.computer === state.computer) && (source === 'all' || i.source === source) && (state.filter === 'all' || i.status === state.filter) && (!native || (i.spaceId === state.nativeSpace && i.tabId === state.nativeTab)) && `${i.name} ${i.cwd} ${i.source} ${i.id} ${i.space || ''} ${i.tab || ''} ${state.computers.find(c => c.id === i.computer)?.name}`.toLowerCase().includes(q)));
}
export const statusLabel = { needs: 'Needs you', working: 'Working', idle: 'Idle', unknown: 'Attention unknown' };
export function outputFor(item) {
  if (!item) return '';
  return `${item.cwd}\n${item.source === 'Terminal' ? '$ ' : '› '}${item.name}\n\n${item.status === 'needs' ? 'The changes are ready for review.\n\n  ✓ Input stays bound to its original session\n  ✓ Unsent drafts survive switching\n  ✓ Reconnection never replays a prompt\n\nMay I continue with the next step?\n\n› ' : item.status === 'working' ? 'Checking the current implementation…\nReading source files\nPreparing the next update\n\nOutput activity is separate from attention.\n' : item.status === 'unknown' ? 'Last terminal output is shown below.\nAttention detection is unavailable for this source.\n\n$ git status\nOn branch mobile-exploration\nWorking tree has changes\n\n› ' : '$ git status\nOn branch mobile-exploration\nNo pending command.\n\n$ '}`;
}

// A new native generation gets a separate draft, even if its title/address matches.
export function draftKey(item) { return item ? `${item.computer}:${item.source}:${item.id}:${item.generation}` : ''; }
