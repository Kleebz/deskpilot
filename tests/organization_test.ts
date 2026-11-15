import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  OrganizationError,
  Organizations,
  validateOrganization,
} from "../server/organization.ts";
import {
  organizationClient,
  organizationDocument,
  restoreOrganization,
} from "../web/src/lib/spaces/organization-client.js";

const layout = () => ({
  version: 1 as const,
  revision: 0,
  spaces: [{
    id: "space:a",
    name: "Product",
    tabs: [{ id: "task:a", name: "Mobile" }],
  }],
  assignments: [{
    source: { kind: "session" as const, id: "shell", generation: "created:1" },
    task: "task:a",
  }],
});
Deno.test("organization survives a store restart and independent readers reject stale revisions", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const path = dir + "/organization.json",
      first = new Organizations(path),
      other = new Organizations(path);
    const saved = first.save(layout());
    assertEquals(saved.revision, 1);
    assertEquals(other.read(), saved);
    assertEquals(Deno.statSync(path).mode! & 0o777, 0o600);
    const changed = {
      ...saved,
      spaces: [{ ...saved.spaces[0], name: "Renamed" }],
    };
    assertEquals(other.save(changed).revision, 2);
    const error = assertThrows(() => first.save(saved), OrganizationError);
    assertEquals(error.status, 409);
    assertEquals(new Organizations(path).read().spaces[0].name, "Renamed");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
Deno.test("corrupt organization is preserved rather than treated as an empty first run", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const path = dir + "/organization.json";
    await Deno.writeTextFile(path, "broken");
    assertEquals(
      assertThrows(() => new Organizations(path).read(), OrganizationError)
        .status,
      503,
    );
    assertThrows(
      () => new Organizations(path).save(layout()),
      OrganizationError,
    );
    assertEquals(await Deno.readTextFile(path), "broken");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
Deno.test("organization rejects ambiguous membership, unknown tasks, native ownership and secret fields", () => {
  const original = layout();
  for (
    const value of [
      { ...original, token: "never persist" },
      { ...original, spaces: [{ ...original.spaces[0], id: "native:owned" }] },
      {
        ...original,
        spaces: [{ ...original.spaces[0], computer: "another host" }],
      },
      {
        ...original,
        assignments: [{ ...original.assignments[0], task: "missing" }],
      },
      {
        ...original,
        assignments: [original.assignments[0], original.assignments[0]],
      },
      {
        ...original,
        assignments: [{
          source: { kind: "herdr", id: "native", generation: "1" },
          task: "task:a",
        }],
      },
      {
        ...original,
        spaces: [{
          ...original.spaces[0],
          tabs: [original.spaces[0].tabs[0], original.spaces[0].tabs[0]],
        }],
      },
    ]
  ) assertThrows(() => validateOrganization(value), OrganizationError);
  const distinct = {
    ...original,
    assignments: [...original.assignments, {
      source: { kind: "conversation", id: "shell", generation: "created:1" },
      task: "task:a",
    }, {
      source: { kind: "session", id: "shell", generation: "created:2" },
      task: "task:a",
    }],
  };
  assertEquals(validateOrganization(distinct).assignments.length, 3);
});
Deno.test("organization projection retains undiscovered work and isolates computers and generations", () => {
  const state: any = {
    items: [],
    workSpaces: [],
    workAssignments: {},
    drafts: { original: "keep" },
  };
  const restored = restoreOrganization(state, "desktop", layout());
  assertEquals(organizationDocument(restored, "desktop", 0), layout());
  restored.items = [{
    computer: "desktop",
    source: "Terminal",
    id: "shell",
    generation: "created:2",
  }];
  assertEquals(
    organizationDocument(restored, "desktop", 0).assignments,
    layout().assignments,
  );
  assertEquals(organizationDocument(restored, "other", 0).spaces, []);
  assertEquals(restored.drafts, { original: "keep" });
  const origins = {
    ...state,
    computers: [{ id: "https://desktop" }, { id: "https://desktop:443" }],
    workAssignments: {
      "https://desktop:Terminal:own:1": "task:a",
      "https://desktop:443:Terminal:other:1": "task:a",
    },
  };
  const scoped = restoreOrganization(origins, "https://desktop", {
    version: 1,
    revision: 0,
    spaces: [],
    assignments: [],
  });
  assertEquals(scoped.workAssignments, {
    "https://desktop:443:Terminal:other:1": "task:a",
  });
  restored.items = [{
    computer: "desktop",
    source: "Terminal",
    id: "shell",
    generation: "created:1",
  }];
  restored.workAssignments["desktop:Terminal:shell:created:1"] = "";
  assertEquals(organizationDocument(restored, "desktop", 0).assignments, []);
  restored.items = [{ computer: "desktop", source: "Terminal", id: "unknown" }];
  restored.workAssignments["desktop:Terminal:unknown:undefined"] = "task:a";
  assertThrows(() => organizationDocument(restored, "desktop", 0));
});
Deno.test("organization client binds late operations to the original host and never retries a conflict", async () => {
  const host = { origin: "https://first" }, calls: any[] = [];
  const client = organizationClient(
    host,
    (method: any, doc: any, target: any) => {
      calls.push({ method, doc, target });
      return Promise.reject(
        Object.assign(new Error("conflict"), { status: 409 }),
      );
    },
  );
  host.origin = "https://second";
  try {
    await client.save(layout());
  } catch { /* deliberately surfaced */ }
  assertEquals(calls.length, 1);
  assertEquals(calls[0].target.origin, "https://first");
});

Deno.test("hidden conversations persist independently of discovery and reject unsafe metadata", async () => {
  const source = {
    kind: "conversation" as const,
    id: "thread:one",
    generation: "thread:one",
  };
  const doc = { ...layout(), hidden: [source] };
  const dir = await Deno.makeTempDir();
  try {
    const store = new Organizations(dir + "/organization.json");
    const saved = store.save(doc);
    assertEquals(new Organizations(dir + "/organization.json").read().hidden, [
      source,
    ]);
    const state = restoreOrganization(
      { items: [], workSpaces: [], workAssignments: {} },
      "host",
      saved,
    );
    assertEquals(organizationDocument(state, "host", saved.revision).hidden, [
      source,
    ]);
    assertEquals(organizationDocument(state, "other", 0).hidden, undefined);
    assertThrows(() => store.save(doc), OrganizationError);
    for (
      const hidden of [[source, source], [{ ...source, kind: "herdr" }], [{
        ...source,
        token: "secret",
      }], Array(2049).fill(source)]
    ) {
      assertThrows(
        () => validateOrganization({ ...doc, hidden }),
        OrganizationError,
      );
    }
    assertEquals(store.save({ ...saved, hidden: [] }).hidden, undefined);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
