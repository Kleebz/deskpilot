// Only UI state belongs here. Never persist terminal output, credentials,
// pairing codes, desktop passwords, or in-flight actions.
export const RESUME_KEY = 'dp_resume_v1';
const views = new Set(['sessions', 'screens', 'terminal', 'new', 'management']);
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' ? value : '';
/** @typedef {{host: string, view: string, session?: string, returnTo?: ResumeRoute}} ResumeRoute */

export function resumeRoute(value, origins, depth = 0) {
  if (!record(value) || !origins.includes(value.host) || !views.has(value.view)) return null;
  /** @type {ResumeRoute} */
  const route = { host: value.host, view: value.view };
  if (value.view === 'terminal') {
    if (!text(value.session)) return null;
    route.session = value.session;
  }
  if (depth === 0 && value.returnTo) {
    const parent = resumeRoute(value.returnTo, origins, 1);
    if (parent && ['sessions', 'screens'].includes(parent.view)) route.returnTo = parent;
  }
  return route;
}

function clean(value, origins) {
  if (!record(value) || value.version !== 1) return null;
  const route = resumeRoute(value.route, origins);
  /** @type {Record<string, {input: string, clip: string}>} */
  const drafts = {};
  /** @type {Record<string, {name: string, dir: string, command: string, workspace: number | null}>} */
  const creationDrafts = {};
  if (record(value.drafts)) for (const [key, draft] of Object.entries(value.drafts)) {
    try {
      const [host, name] = JSON.parse(key);
      if (!origins.includes(host) || !text(name) || !record(draft)) continue;
      const input = text(draft.input), clip = text(draft.clip);
      if (input || clip) drafts[JSON.stringify([host, name])] = { input, clip };
    } catch { /* malformed key */ }
  }
  if (record(value.creationDrafts)) for (const host of origins) {
    const draft = value.creationDrafts[host];
    if (!record(draft)) continue;
    creationDrafts[host] = {
      name: text(draft.name), dir: text(draft.dir), command: text(draft.command),
      workspace: Number.isInteger(draft.workspace) && draft.workspace >= 1 && draft.workspace <= 10 ? draft.workspace : null,
    };
  }
  const screens = Array.isArray(value.screens) ? value.screens.filter(entry =>
    Array.isArray(entry) && origins.includes(entry[0]) && Number.isInteger(entry[1]) && entry[1] >= 1 && entry[1] <= 10) : [];
  const positions = Array.isArray(value.positions) ? value.positions.filter(entry => {
    if (!Array.isArray(entry) || !Number.isFinite(entry[1]) || entry[1] < 0) return false;
    try { const [host, view] = JSON.parse(entry[0]); return origins.includes(host) && views.has(view); }
    catch { return false; }
  }) : [];
  const order = Array.isArray(value.order) ? [...new Set(value.order.filter(name => text(name)))] : [];
  return { version: 1, route, drafts, creationDrafts, screens, positions, order };
}

export function readResume(storage, origins) {
  try { return clean(JSON.parse(storage.getItem(RESUME_KEY)), origins); }
  catch { return null; } // Corrupt data or unavailable browser storage is nonfatal.
}

export function writeResume(storage, state, origins) {
  try { storage.setItem(RESUME_KEY, JSON.stringify(clean({ ...state, version: 1 }, origins))); }
  catch { /* Storage can be full or disabled; the live app must still work. */ }
}
