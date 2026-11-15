export const needsAttention = item => ['blocked', 'error'].includes(item.state);
export const matchesWorkFilter = (item, filter) => filter === 'all' || (filter === 'blocked' ? needsAttention(item) : item.state === 'working');
export const workStateLabel = item => ({ blocked: 'Needs you', error: 'Error', working: 'Working', done: 'Ready', ready: 'Ready', idle: 'Ready' })[item.state] ?? 'Status unknown';

// Shared attachments are identified by adapter metadata, never title or cwd.
export function normalWork(sessions, conversations, herdrSessions = new Map()) {
  const ordinary = sessions.filter(s => !s.herdrId && !herdrSessions.has(s.session));
  const claimed = new Set();
  const items = conversations.map(chat => {
    const session = ordinary.find(s => s.codexThreadId === chat.id || s.session === chat.session);
    if (session) claimed.add(session.session);
    return { kind: 'conversation', key: chat.id, ...chat, session: session?.session ?? chat.session };
  });
  for (const session of ordinary) {
    if (claimed.has(session.session)) continue;
    items.push(session.codexThreadId
      ? { ...session, kind: 'conversation', key: session.codexThreadId, id: session.codexThreadId, title: session.conversationTitle || 'Codex conversation', state: 'unknown' }
      : { ...session, kind: 'session', key: session.session });
  }
  const rank = item => needsAttention(item) ? 0 : item.state === 'working' ? 1 : 2;
  return items.sort((a, b) => rank(a) - rank(b));
}

export function attentionUnavailable(items) {
  // Codex discovery currently reports busy/idle, but cannot report an input
  // request. Ready must not imply that we checked whether it needs attention.
  return items.filter(item => !needsAttention(item) && (item.kind === 'conversation' || !['working', 'ready', 'done', 'idle'].includes(item.state))).length;
}
