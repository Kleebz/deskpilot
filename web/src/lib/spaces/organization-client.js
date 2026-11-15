// Inject transport so these operations can use the authenticated application API
// or an isolated preview server. Capture the host before any asynchronous work.
export function organizationClient(host, transport) {
  const target = Object.freeze({ ...host });
  return {
    read: () => transport("GET", null, target),
    save: (document) => transport("POST", structuredClone(document), target),
  };
}

export function organizationDocument(state, computer, revision) {
  const spaces = (state.workSpaces || []).filter((s) => s.computer === computer)
    .map((s) => ({
      id: s.id,
      name: s.name,
      tabs: s.tabs.map((t) => ({ id: t.id, name: t.name })),
    }));
  const tasks = new Set(spaces.flatMap((s) => s.tabs.map((t) => t.id)));
  const current = state.items.filter((i) =>
    i.computer === computer && i.source !== "Herdr"
  );
  const key = (source) =>
    JSON.stringify([source.kind, source.id, source.generation]);
  const discovered = new Set(
    current.map((item) =>
      key({
        kind: item.source === "Codex" ? "conversation" : "session",
        id: item.id,
        generation: String(item.generation),
      })
    ),
  );
  const retained = (state.workOrganizationSources?.[computer] || []).filter(
    (a) => tasks.has(a.task) && !discovered.has(key(a.source)),
  );
  const assignments = state.items.filter((i) =>
    i.computer === computer && i.source !== "Herdr"
  ).flatMap((item) => {
    const task = state.workAssignments
      ?.[`${computer}:${item.source}:${item.id}:${item.generation}`];
    if (
      tasks.has(task) &&
      (item.id === undefined || item.generation === undefined ||
        item.generation === null || String(item.generation).trim() === "")
    ) {
      throw new Error(
        "Work identity is unavailable. Refresh before assigning it to a task",
      );
    }
    return tasks.has(task)
      ? [{
        source: {
          kind: item.source === "Codex" ? "conversation" : "session",
          id: item.id,
          generation: String(item.generation),
        },
        task,
      }]
      : [];
  });
  return {
    version: 1,
    revision,
    spaces,
    assignments: [...retained, ...assignments],
    ...(state.workHiddenSources?.[computer]?.length
      ? { hidden: state.workHiddenSources[computer].map((s) => ({ ...s })) }
      : {}),
  };
}

export function restoreOrganization(state, computer, document) {
  // Origins can share a hostname and differ only by port. Match the longest
  // known computer prefix so restoring https://desktop never clears :443.
  const computers = [
    ...new Set([
      computer,
      ...(state.computers || []).map((h) => h.id || h.origin),
      ...(state.items || []).map((i) => i.computer),
      ...(state.workSpaces || []).map((s) => s.computer),
      ...Object.keys(state.workOrganizationSources || {}),
    ].filter(Boolean)),
  ].sort((a, b) => b.length - a.length);
  const assignments = Object.fromEntries(
    Object.entries(state.workAssignments || {}).filter(([key]) =>
      computers.find((host) => key.startsWith(`${host}:`)) !== computer
    ),
  );
  for (const { source, task } of document.assignments) {
    assignments[
      `${computer}:${
        source.kind === "conversation" ? "Codex" : "Terminal"
      }:${source.id}:${source.generation}`
    ] = task;
  }
  return {
    ...state,
    workHiddenSources: {
      ...state.workHiddenSources,
      [computer]: (document.hidden || []).map((s) => ({ ...s })),
    },
    workOrganizationSources: {
      ...state.workOrganizationSources,
      [computer]: document.assignments.map((a) => ({
        source: { ...a.source },
        task: a.task,
      })),
    },
    workSpaces: [
      ...(state.workSpaces || []).filter((s) => s.computer !== computer),
      ...document.spaces.map((s) => ({ ...s, computer })),
    ],
    workAssignments: assignments,
  };
}
