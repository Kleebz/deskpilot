// A title match is a discovery hint, never authority to control a window or
// select a conversation automatically. Connections still use an explicit UUID.
const terminalClass = /^(?:com\.mitchellh\.ghostty|ghostty|com\.deskpilot\.Terminal\.[A-Za-z0-9_-]+|alacritty|kitty|foot(?:-server)?|org\.wezfurlong\.wezterm|org\.gnome\.(?:Terminal|Console|Ptyxis)|gnome-terminal-server|konsole|org\.kde\.konsole|xterm|uxterm)$/i;

export function isTerminalWindow(win) {
  return terminalClass.test(win?.class ?? '');
}

export function matchConversationWindows(chats, windows) {
  const byTitle = new Map(), byWindowTitle = new Map(), matches = new Map();
  for (const chat of chats) {
    const project = chat.path?.replace(/\/+$/, '').split('/').pop();
    if (!chat.title || !project) continue;
    const key = `${chat.title} | ${project}`;
    byTitle.set(key, [...(byTitle.get(key) ?? []), chat]);
  }
  for (const win of windows) {
    if (!isTerminalWindow(win)) continue;
    // Codex puts a Braille progress spinner before the title while working.
    const key = String(win.title ?? '').trim().replace(/^[\u2800-\u28ff]\s+/u, '');
    byWindowTitle.set(key, [...(byWindowTitle.get(key) ?? []), win]);
  }
  for (const [key, candidates] of byTitle) {
    const found = byWindowTitle.get(key);
    if (candidates.length === 1 && found?.length === 1) {
      matches.set(found[0].address, candidates[0]);
    }
  }
  return matches;
}
