import { assertEquals } from "jsr:@std/assert@^1.0.0";
import {
  readResume,
  RESUME_KEY,
  resumeRoute,
  writeResume,
} from "../web/src/lib/resume.js";

const host = "https://desktop.example";
const other = "https://removed.example";
function storage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

Deno.test("resume preserves scoped drafts and location but strips actions and secrets", () => {
  const store = storage();
  const key = JSON.stringify([host, "api"]);
  writeResume(store, {
    route: {
      host,
      view: "terminal",
      session: "api",
      returnTo: { host, view: "screens" },
      password: "secret",
    },
    drafts: {
      [key]: { input: "unfinished", clip: "pasted block", token: "secret" },
      [JSON.stringify([other, "api"])]: { input: "removed" },
    },
    creationDrafts: {
      [host]: { name: "new", dir: "/work", command: "bash", workspace: 4 },
    },
    screens: [[host, 4], [other, 8]],
    positions: [[JSON.stringify([host, "sessions", ""]), 560]],
    order: ["api", "shell"],
    pairingDraft: { code: "secret" },
    password: "secret",
    actionBusy: true,
  }, [host]);
  const result = readResume(store, [host]);
  assertEquals(result?.route, {
    host,
    view: "terminal",
    session: "api",
    returnTo: { host, view: "screens" },
  });
  assertEquals(result?.drafts, {
    [key]: { input: "unfinished", clip: "pasted block" },
  });
  assertEquals(result?.screens, [[host, 4]]);
  assertEquals(result?.positions, [[
    JSON.stringify([host, "sessions", ""]),
    560,
  ]]);
  assertEquals(result?.creationDrafts[host].command, "bash");
  assertEquals(store.getItem(RESUME_KEY)?.includes("secret"), false);
});

Deno.test("resume rejects obsolete, corrupt and removed-machine routes", () => {
  const store = storage();
  assertEquals(readResume(store, [host]), null);
  store.setItem(RESUME_KEY, "{bad");
  assertEquals(readResume(store, [host]), null);
  store.setItem(RESUME_KEY, JSON.stringify({ version: 42 }));
  assertEquals(readResume(store, [host]), null);
  assertEquals(
    resumeRoute({ host: other, view: "terminal", session: "api" }, [host]),
    null,
  );
  assertEquals(resumeRoute({ host, view: "terminal" }, [host]), null);
  assertEquals(resumeRoute({ host, view: "add" }, [host]), null);
});

Deno.test("storage failures do not prevent using the app", () => {
  const denied = {
    getItem: () => {
      throw Error("denied");
    },
    setItem: () => {
      throw Error("full");
    },
  };
  assertEquals(readResume(denied, [host]), null);
  writeResume(denied, { route: { host, view: "sessions" } }, [host]);
});

Deno.test("preview navigation resumes without saving image data or filenames", () => {
  const store = storage();
  writeResume(store, {
    route: {
      host,
      view: "previews",
      image: "private bytes",
      filename: "/private/file.png",
    },
  }, [host]);
  assertEquals(readResume(store, [host])?.route, { host, view: "previews" });
  assertEquals(store.getItem(RESUME_KEY)?.includes("private"), false);
});

Deno.test("combined navigation restores search, settings, recent work and review identities without credentials", () => {
  const store = storage();
  writeResume(store, {
    route: {
      host,
      view: "terminal",
      session: "api",
      reviewIndex: 0,
      review: [{
        host,
        kind: "herdr",
        id: "core/term/generation",
        session: "api",
        title: "Same title",
        token: "secret",
      }],
      returnTo: { host, view: "attention" },
    },
    recent: { [host]: [{ kind: "session", id: "api", token: "secret" }] },
    visits: {
      [host]: {
        host,
        view: "sessions",
        query: "same title",
        filter: "working",
      },
      [other]: { host: other, view: "sessions" },
    },
  }, [host]);
  const result = readResume(store, [host]);
  assertEquals(result?.route?.returnTo?.view, "attention");
  assertEquals(result?.route?.review?.[0], {
    host,
    kind: "herdr",
    id: "core/term/generation",
    session: "api",
    title: "Same title",
  });
  assertEquals(result?.visits[host].query, "same title");
  assertEquals(result?.recent[host], [{ kind: "session", id: "api" }]);
  assertEquals(store.getItem(RESUME_KEY)?.includes("secret"), false);
  assertEquals(result?.visits[other], undefined);
});
Deno.test("Computer dismissal after relaunch preserves the terminal attention origin and settings subsection", () => {
  const route = resumeRoute({
    host,
    view: "computer",
    returnTo: {
      host,
      view: "terminal",
      session: "api",
      returnTo: { host, view: "attention" },
    },
  }, [host]);
  assertEquals(route?.returnTo?.returnTo?.view, "attention");
  assertEquals(
    resumeRoute({ host, view: "management", settings: "machines" }, [host])
      ?.settings,
    "machines",
  );
});
