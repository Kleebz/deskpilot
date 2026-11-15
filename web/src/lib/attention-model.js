import {
  attentionUnavailable,
  needsAttention,
  normalWork,
} from "./work-model.js";

// Full source identities are kept with the host. Names and paths are display
// metadata; an attachment never establishes ownership by a title match.
export function inventory(
  host,
  sessions = [],
  chats = [],
  native = [],
  agents = [],
) {
  const bridges = new Map(
    native.filter((t) => t.session).map((t) => [t.session, t]),
  );
  const items = [
    ...normalWork(sessions, chats, bridges),
    ...native.map((t) => ({ ...t, kind: "herdr", key: t.id })),
    ...agents.map((a) => ({ ...a, kind: "unmanaged", key: a.id })),
  ].map((item) => ({ ...item, host }));
  return { items, unknown: attentionUnavailable(items) };
}
export function reportedRequests(hosts, snapshots) {
  return hosts.flatMap(
    (
      host,
    ) => (snapshots[host.origin]?.health === "ready"
      ? snapshots[host.origin].items.filter(needsAttention)
      : []),
  )
    .sort((a, b) =>
      hosts.findIndex((h) => h.origin === a.host.origin) -
        hosts.findIndex((h) => h.origin === b.host.origin) ||
      (a.title || a.session || a.agent || "").localeCompare(
        b.title || b.session || b.agent || "",
      )
    );
}
export function reviewTarget(item) {
  return {
    host: item.host.origin,
    kind: item.kind,
    id: item.id || item.session,
    session: item.session || "",
    title: item.title || item.session || item.agent || "Terminal",
  };
}
export function matchesSearch(item, query) {
  const text = query.trim().toLowerCase();
  return !text ||
    [
      item.title,
      item.session,
      item.path,
      item.command,
      item.agent,
      item.kind,
      item.kind === "conversation"
        ? "Codex"
        : item.kind === "herdr"
        ? "Herdr"
        : "Terminal",
      item.space?.title,
      item.tab?.title,
      item.id,
    ].some((value) => String(value ?? "").toLowerCase().includes(text));
}
export function recentFirst(items, recent = []) {
  const rank = (item) =>
    recent.findIndex((r) =>
      r.kind === item.kind && r.id === (item.id || item.session)
    );
  return [...items].sort((a, b) => {
    const ar = rank(a), br = rank(b);
    if (ar >= 0 || br >= 0) {
      return (ar < 0 ? Infinity : ar) - (br < 0 ? Infinity : br);
    }
    return (a.workspace ?? Infinity) - (b.workspace ?? Infinity) ||
      (a.title || a.session || "").localeCompare(
        b.title || b.session || "",
        undefined,
        { numeric: true },
      );
  });
}
