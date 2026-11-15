export const needsAttention = terminal => ['blocked', 'error'].includes(terminal.state);
export const stateLabel = state => ({ working: 'Working', blocked: 'Needs you', error: 'Error', done: 'Done' }[state] ?? 'Ready');
const priority = terminal => needsAttention(terminal) ? 0 : terminal.state === 'working' ? 1 : terminal.state === 'done' ? 2 : 3;

export function groupHerdr(terminals, { query = '', attentionOnly = false } = {}) {
  const groups = new Map();
  const search = query.trim().toLocaleLowerCase();
  for (const terminal of terminals) {
    if (attentionOnly && !needsAttention(terminal)) continue;
    if (search && ![terminal.title, terminal.path, terminal.agent, terminal.space?.title, terminal.tab?.title]
      .some(value => String(value ?? '').toLocaleLowerCase().includes(search))) continue;
    const space = terminal.space ?? { id: 'unplaced', title: 'Other terminals', path: '', order: Number.MAX_SAFE_INTEGER };
    let group = groups.get(space.id);
    if (!group) groups.set(space.id, group = { ...space, tabs: new Map(), terminals: [] });
    group.terminals.push(terminal);
    const tab = terminal.tab ?? { id: 'unplaced', title: '', order: 0 };
    if (!group.tabs.has(tab.id)) group.tabs.set(tab.id, { ...tab, terminals: [] });
    group.tabs.get(tab.id).terminals.push(terminal);
  }
  return [...groups.values()].sort((a, b) => a.order - b.order).map(group => ({
    ...group,
    tabs: [...group.tabs.values()].sort((a, b) => a.order - b.order).map(tab => ({
      ...tab, terminals: [...tab.terminals].sort((a, b) => (a.paneOrder ?? 0) - (b.paneOrder ?? 0)),
    })),
    attention: group.terminals.filter(needsAttention).length,
    state: [...group.terminals].sort((a, b) => priority(a) - priority(b))[0]?.state,
  }));
}
