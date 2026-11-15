import { normalWork } from "../work-model.js";
import { restoreOrganization } from "./organization-client.js";
export const sourceRef = (item) => ({
  kind: item.source === "Herdr"
    ? "herdr"
    : item.source === "Codex"
    ? "conversation"
    : "session",
  id: item.id,
  generation: item.generation,
});
export const sourceKey = (host, ref) =>
  ref?.id && ref.generation
    ? JSON.stringify([host, ref.kind, ref.id, ref.generation])
    : "";
export const sameSource = (a, b) =>
  !!a && !!b && a.kind === b.kind && a.id === b.id &&
  a.generation === b.generation;
const status = (value) =>
  ["blocked", "error"].includes(value)
    ? "needs"
    : value === "working"
    ? "working"
    : ["idle", "ready", "done"].includes(value)
    ? "idle"
    : "unknown";
export function liveItems(
  host,
  sessions = [],
  chats = [],
  native = [],
  agents = [],
) {
  const bridges = new Map(
    native.filter((t) => t.session).map((t) => [t.session, t]),
  );
  const ordinary = normalWork(sessions, chats, bridges).map((item) => {
    const conversation = item.kind === "conversation";
    return {
      id: conversation
        ? item.id
        : item.terminalId || `unidentified:${item.session}`,
      computer: host,
      source: conversation ? "Codex" : "Terminal",
      generation: conversation ? `thread:${item.id}` : item.generation || "",
      name: item.title || item.session,
      cwd: item.path || "",
      status: conversation && item.state !== "working"
        ? "unknown"
        : status(item.state),
      workspace: item.workspace,
      connected: !!item.session,
      session: item.session,
      raw: item,
      organizable: conversation || !!(item.terminalId && item.generation),
    };
  });
  const terminals = native.map((item) => ({
    id: item.id,
    computer: host,
    source: "Herdr",
    generation: "native",
    name: item.title,
    cwd: item.path,
    status: status(item.state),
    connected: !!(sessions.find(s=>s.herdrId===item.id)?.session||item.session),
    session: sessions.find(s=>s.herdrId===item.id)?.session||item.session,
    spaceId: item.space?.id,
    space: item.space?.title,
    tabId: item.tab?.id,
    tab: item.tab?.title,
    pane: (item.paneOrder || 0) + 1,
    raw: item,
    organizable: false,
  }));
  // A lost provider listing must not turn a tagged bridge into an ordinary shell.
  for (
    const session of sessions.filter((s) =>
      s.herdrId && !native.some((n) => n.id === s.herdrId)
    )
  ) {
    terminals.push({
      id: session.herdrId,
      computer: host,
      source: "Herdr",
      generation: "native",
      name: session.session,
      cwd: session.path,
      status: "unknown",
      connected: true,
      session: session.session,
      raw: {
        id: session.herdrId,
        session: session.session,
        title: session.session,
      },
      organizable: false,
    });
  }
  const viewOnly = agents.map((item) => ({
    id: item.id,
    computer: host,
    source: "Desktop only",
    generation: "process",
    name: item.agent || item.id,
    cwd: item.path,
    status: status(item.state),
    viewOnly: true,
    raw: item,
    organizable: false,
  }));
  return [...ordinary, ...terminals, ...viewOnly];
}
export function liveSpaceState(
  hosts,
  current,
  items,
  documents,
  route,
  preferences = {},
) {
  let state = {
    computer: current,
    computers: hosts,
    items,
    selected: route.selected,
    selectedRef: route.ref,
    workSpaces: [],
    workAssignments: {},
    recent: [],
    workQuery: route.query || "",
    workNeeds: route.filter === "blocked",
    workAcross: !!route.across,
    workExpanded: preferences.expanded || {},
    workShowHidden: !!preferences.showHidden,
  };
  for (const host of hosts) {
    if (documents[host.id]) {
      state = restoreOrganization(state, host.id, documents[host.id]);
    }
  }
  return state;
}
export function routeItem(route, items) {
  return items.find((item) =>
    item.computer === route.host &&
    (route.ref
      ? sameSource(sourceRef(item), route.ref)
      : item.session === route.session)
  );
}
