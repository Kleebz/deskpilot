import { assertEquals } from 'jsr:@std/assert@^1.0.0';
import { readResume, resumeRoute, writeResume, RESUME_KEY } from '../web/src/lib/resume.js';

const host = 'https://desktop.example';
const other = 'https://removed.example';
function storage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
}

Deno.test('resume preserves scoped drafts and location but strips actions and secrets', () => {
  const store = storage();
  const key = JSON.stringify([host, 'api']);
  writeResume(store, {
    route: { host, view: 'terminal', session: 'api', returnTo: { host, view: 'screens' }, password: 'secret' },
    drafts: { [key]: { input: 'unfinished', clip: 'pasted block', token: 'secret' }, [JSON.stringify([other, 'api'])]: { input: 'removed' } },
    creationDrafts: { [host]: { name: 'new', dir: '/work', command: 'bash', workspace: 4 } },
    screens: [[host, 4], [other, 8]], positions: [[JSON.stringify([host, 'sessions', '']), 560]],
    order: ['api', 'shell'], pairingDraft: { code: 'secret' }, password: 'secret', actionBusy: true,
  }, [host]);
  const result = readResume(store, [host]);
  assertEquals(result?.route, { host, view: 'terminal', session: 'api', returnTo: { host, view: 'screens' } });
  assertEquals(result?.drafts, { [key]: { input: 'unfinished', clip: 'pasted block' } });
  assertEquals(result?.screens, [[host, 4]]);
  assertEquals(result?.positions, [[JSON.stringify([host, 'sessions', '']), 560]]);
  assertEquals(result?.creationDrafts[host].command, 'bash');
  assertEquals(store.getItem(RESUME_KEY)?.includes('secret'), false);
});

Deno.test('resume rejects obsolete, corrupt and removed-machine routes', () => {
  const store = storage();
  assertEquals(readResume(store, [host]), null);
  store.setItem(RESUME_KEY, '{bad');
  assertEquals(readResume(store, [host]), null);
  store.setItem(RESUME_KEY, JSON.stringify({ version: 42 }));
  assertEquals(readResume(store, [host]), null);
  assertEquals(resumeRoute({ host: other, view: 'terminal', session: 'api' }, [host]), null);
  assertEquals(resumeRoute({ host, view: 'terminal' }, [host]), null);
  assertEquals(resumeRoute({ host, view: 'add' }, [host]), null);
});

Deno.test('storage failures do not prevent using the app', () => {
  const denied = { getItem: () => { throw Error('denied'); }, setItem: () => { throw Error('full'); } };
  assertEquals(readResume(denied, [host]), null);
  writeResume(denied, { route: { host, view: 'sessions' } }, [host]);
});
