// Organization is metadata owned by this computer. It never creates, stops,
// attaches, or renames a terminal and never rewrites a native Herdr document.
export type WorkSource = {
  kind: "session" | "conversation";
  id: string;
  generation: string;
};
export type Organization = {
  version: 1;
  revision: number;
  spaces: { id: string; name: string; tabs: { id: string; name: string }[] }[];
  assignments: { source: WorkSource; task: string }[];
  hidden?: WorkSource[];
};
export const ORGANIZATION_MAX_BYTES = 1024 * 1024;
export class OrganizationError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}
const empty = (): Organization => ({
  version: 1,
  revision: 0,
  spaces: [],
  assignments: [],
});
const id = (v: unknown): v is string =>
  typeof v === "string" && /^[A-Za-z0-9:_-]{1,96}$/.test(v);
const text = (v: unknown, max: number): v is string =>
  typeof v === "string" && !!v.trim() && v.length <= max &&
  !/[\x00-\x1f\x7f]/.test(v);
function fields(v: any, allowed: string[]) {
  if (
    !v || typeof v !== "object" || Array.isArray(v) ||
    Object.keys(v).some((k) => !allowed.includes(k))
  ) throw new OrganizationError("Invalid organization fields");
}
export function validateOrganization(value: any): Organization {
  fields(value, ["version", "revision", "spaces", "assignments", "hidden"]);
  if (
    value.version !== 1 || !Number.isSafeInteger(value.revision) ||
    value.revision < 0 || !Array.isArray(value.spaces) ||
    value.spaces.length > 64 || !Array.isArray(value.assignments) ||
    value.assignments.length > 2048
  ) throw new OrganizationError("Invalid organization document");
  const spaceIds = new Set(), taskIds = new Set();
  const spaces = value.spaces.map((space: any) => {
    fields(space, ["id", "name", "tabs"]);
    if (
      !id(space.id) || /^(native|unassigned):/.test(space.id) ||
      spaceIds.has(space.id) || !text(space.name, 100) ||
      !Array.isArray(space.tabs) || space.tabs.length > 64
    ) throw new OrganizationError("Invalid space");
    spaceIds.add(space.id);
    const tabs = space.tabs.map((tab: any) => {
      fields(tab, ["id", "name"]);
      if (
        !id(tab.id) || /^(native|work):/.test(tab.id) || taskIds.has(tab.id) ||
        !text(tab.name, 100)
      ) {
        throw new OrganizationError("Invalid task");
      }
      taskIds.add(tab.id);
      return { id: tab.id, name: tab.name.trim() };
    });
    return { id: space.id, name: space.name.trim(), tabs };
  });
  if (taskIds.size > 512) throw new OrganizationError("Too many tasks");
  const sources = new Set();
  const assignments = value.assignments.map((assignment: any) => {
    fields(assignment, ["source", "task"]);
    fields(assignment.source, ["kind", "id", "generation"]);
    const source = assignment.source;
    if (
      !["session", "conversation"].includes(source.kind) ||
      !text(source.id, 512) || !text(source.generation, 160) ||
      !taskIds.has(assignment.task)
    ) throw new OrganizationError("Invalid task assignment");
    const key = JSON.stringify([source.kind, source.id, source.generation]);
    if (sources.has(key)) {
      throw new OrganizationError("A source can belong to only one task");
    }
    sources.add(key);
    return {
      source: {
        kind: source.kind,
        id: source.id,
        generation: source.generation,
      },
      task: assignment.task,
    };
  });
  if (
    value.hidden !== undefined &&
    (!Array.isArray(value.hidden) || value.hidden.length > 2048)
  ) {
    throw new OrganizationError("Invalid hidden conversations");
  }
  const hiddenKeys = new Set();
  const hidden = (value.hidden || []).map((source: any) => {
    fields(source, ["kind", "id", "generation"]);
    if (
      source.kind !== "conversation" || !text(source.id, 512) ||
      !text(source.generation, 160)
    ) {
      throw new OrganizationError("Invalid hidden conversation");
    }
    const key = JSON.stringify([source.kind, source.id, source.generation]);
    if (hiddenKeys.has(key)) {
      throw new OrganizationError("Duplicate hidden conversation");
    }
    hiddenKeys.add(key);
    return { kind: source.kind, id: source.id, generation: source.generation };
  });
  return {
    version: 1,
    revision: value.revision,
    spaces,
    assignments,
    ...(hidden.length ? { hidden } : {}),
  };
}

export class Organizations {
  constructor(private path: string) {}
  read(): Organization {
    try {
      const bytes = Deno.readFileSync(this.path);
      if (bytes.length > ORGANIZATION_MAX_BYTES) {
        throw new Error("Organization file exceeds its limit");
      }
      return validateOrganization(JSON.parse(new TextDecoder().decode(bytes)));
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) return empty();
      throw new OrganizationError(
        "Saved organization is unavailable; it has not been reset",
        503,
      );
    }
  }
  save(value: unknown): Organization {
    const candidate = validateOrganization(value);
    const previous = this.read();
    if (candidate.revision !== previous.revision) {
      throw new OrganizationError(
        "Organization changed on this computer. Refresh before saving again",
        409,
      );
    }
    if (candidate.revision >= Number.MAX_SAFE_INTEGER) {
      throw new OrganizationError("Organization revision limit reached", 503);
    }
    candidate.revision++;
    const bytes = new TextEncoder().encode(JSON.stringify(candidate) + "\n");
    if (bytes.length > ORGANIZATION_MAX_BYTES) {
      throw new OrganizationError("Organization is too large", 413);
    }
    const slash = this.path.lastIndexOf("/"),
      dir = slash < 0 ? "." : this.path.slice(0, slash) || "/";
    let temp = "", committed = false;
    try {
      temp = Deno.makeTempFileSync({
        dir,
        prefix: ".organization-",
        suffix: ".tmp",
      });
      Deno.chmodSync(temp, 0o600);
      const file = Deno.openSync(temp, { write: true, truncate: true });
      try {
        let offset = 0;
        while (offset < bytes.length) {
          const n = file.writeSync(bytes.subarray(offset));
          if (!n) throw new Error("Short write");
          offset += n;
        }
        file.syncSync();
      } finally {
        file.close();
      }
      Deno.renameSync(temp, this.path);
      temp = "";
      committed = true;
      const parent = Deno.openSync(dir, { read: true });
      try {
        parent.syncSync();
      } finally {
        parent.close();
      }
      return candidate;
    } catch {
      throw new OrganizationError(
        committed
          ? "Organization may have been saved; refresh to check before retrying"
          : "Organization could not be saved; previous organization is preserved",
        503,
      );
    } finally {
      if (temp) {
        try {
          Deno.removeSync(temp);
        } catch { /* preserve original error */ }
      }
    }
  }
}
