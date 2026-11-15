export const draftKey = (item) =>
  item ? `${item.computer}:${item.source}:${item.id}:${item.generation}` : "";
export const statusLabel = {
  needs: "Needs you",
  working: "Working",
  idle: "Idle",
  unknown: "Attention unknown",
};
export const hiddenWork = (state, item) =>
  item.source === "Codex" &&
  !!state.workHiddenSources?.[item.computer]?.some((s) =>
    s.kind === "conversation" && s.id === item.id &&
    s.generation === String(item.generation)
  );

// This is presentation metadata only. A title or folder never establishes
// membership, source identity, attachment ownership, or terminal lifetime.
export function spacesFor(
  state,
  host = state.computer,
  includeHidden = !!state.workShowHidden,
) {
  const all = state.items.filter((i) =>
    i.computer === host && !i.closed && !i.viewOnly
  );
  const items = all.filter((i) => !hiddenWork(state, i));
  const spaces = [];
  for (const item of items.filter((i) => i.source === "Herdr")) {
    const id = `native:${item.spaceId || "unplaced"}`;
    let space = spaces.find((s) => s.id === id);
    if (!space) {
      spaces.push(
        space = {
          id,
          name: item.space || "Other terminals",
          native: true,
          tabs: [],
        },
      );
    }
    const tabId = `native:${item.tabId || "unplaced"}`;
    let tab = space.tabs.find((t) => t.id === tabId);
    if (!tab) {
      space.tabs.push(
        tab = { id: tabId, name: item.tab || "Terminals", items: [] },
      );
    }
    tab.items.push(item);
    tab.items.sort((a, b) => (a.pane || 0) - (b.pane || 0));
  }
  for (const local of state.workSpaces || []) {
    if (local.computer !== host) continue;
    spaces.push({
      id: local.id,
      name: local.name,
      native: false,
      tabs: local.tabs.map((tab) => ({
        ...tab,
        items: items.filter((item) =>
          item.source !== "Herdr" &&
          state.workAssignments?.[draftKey(item)] === tab.id
        ),
      })),
    });
  }
  const assigned = new Set(
    spaces.flatMap((s) => s.tabs.flatMap((t) => t.items.map(draftKey))),
  );
  const unassigned = items.filter((i) =>
    i.source !== "Herdr" && i.source !== "Codex" && !assigned.has(draftKey(i))
  );
  if (unassigned.length) {
    spaces.push({
      id: `unassigned:${host}`,
      name: "Unassigned",
      native: false,
      unassigned: true,
      tabs: unassigned.map((item) => ({
        id: `work:${draftKey(item)}`,
        name: item.name,
        items: [item],
      })),
    });
  }
  const available = items.filter((i) =>
    i.source === "Codex" && !assigned.has(draftKey(i))
  );
  if (available.length) {
    spaces.push({
      id: `available:${host}`,
      name: "Available conversations",
      native: false,
      available: true,
      tabs: available.map((item) => ({
        id: `work:${draftKey(item)}`,
        name: item.name,
        items: [item],
      })),
    });
  }
  const hidden = all.filter((i) => hiddenWork(state, i));
  if (includeHidden && hidden.length) {
    spaces.push({
      id: `hidden:${host}`,
      name: "Hidden conversations",
      native: false,
      hidden: true,
      tabs: hidden.map((item) => ({
        id: `work:${draftKey(item)}`,
        name: item.name,
        items: [item],
      })),
    });
  }
  return spaces;
}

export function taskFor(state, item) {
  if (!item) return null;
  for (const space of spacesFor(state, item.computer, true)) {
    const tab = space.tabs.find((t) =>
      t.items.some((i) => draftKey(i) === draftKey(item))
    );
    if (tab) return { space, tab };
  }
  return null;
}

export function taskSequence(state, item) {
  return taskFor(state, item)?.tab.items.map((i) => i.id) || [];
}

export function findWork(state, query, needsOnly = false, across = false) {
  const q = query.trim().toLowerCase();
  return state.items.filter((item) => {
    if (
      item.closed || !across && item.computer !== state.computer ||
      hiddenWork(state, item) && !state.workShowHidden ||
      needsOnly &&
        (item.status !== "needs" ||
          state.computers.find((h) => h.id === item.computer)?.health !==
            "online")
    ) return false;
    const context = taskFor(state, item);
    return !q ||
      [
        item.name,
        item.cwd,
        item.source,
        item.id,
        context?.space.name,
        context?.tab.name,
        state.computers.find((h) => h.id === item.computer)?.name,
      ].some((v) => String(v || "").toLowerCase().includes(q));
  });
}
