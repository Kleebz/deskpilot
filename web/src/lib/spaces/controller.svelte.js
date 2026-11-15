import { computerOrganization } from "../organization.js";
import { sameSource, sourceRef } from "./live-model.js";

export class SpacesController {
  documents = $state({});
  health = $state({});
  errors = $state({});
  action = $state(null);
  busy = $state(false);
  constructor(options) {
    this.options = options;
    this.requests = {};
  }
  host() {
    return this.options.host();
  }
  async load(host = this.host(), force = false) {
    if (!force && ["ready", "loading"].includes(this.health[host.origin])) {
      return;
    }
    const request = (this.requests[host.origin] || 0) + 1;
    this.requests[host.origin] = request;
    this.health[host.origin] = "loading";
    try {
      const doc = await computerOrganization({ ...host }).read();
      if (this.requests[host.origin] !== request) return;
      this.documents[host.origin] = doc;
      this.errors[host.origin] = "";
      this.health[host.origin] = "ready";
      return doc;
    } catch (e) {
      if (this.requests[host.origin] === request) {
        this.health[host.origin] = "error";
        this.errors[host.origin] = e.status === 404
          ? "Update this computer to save spaces and tabs."
          : e.message;
      }
      return null;
    }
  }
  close() {
    this.action = null;
  }
  edit(type, data = {}, host = this.host()) {
    const doc = this.documents[host.origin];
    if (!doc || this.health[host.origin] !== "ready") {
      this.options.status(
        "Organization is unavailable. Refresh this computer before making changes.",
        true,
      );
      return;
    }
    this.action = {
      type,
      host: { ...host },
      base: $state.snapshot(doc),
      name: "",
      taskName: "",
      error: "",
      ...data,
    };
  }
  newSpace() {
    this.edit("new-space");
  }
  newTask(space) {
    if (!space || space.unassigned || space.available || space.hidden) {
      return this.newSpace();
    }
    if (space.native) {
      return this.options.native({
        kind: "space",
        spaceId: space.id.replace(/^native:/, ""),
        mode: "new-tab",
      });
    }
    this.edit("new-task", { spaceId: space.id });
  }
  manage(space) {
    if (space.native) {
      return this.options.native({
        kind: "space",
        spaceId: space.id.replace(/^native:/, ""),
      });
    }
    this.edit("manage", { spaceId: space.id, name: space.name });
  }
  manageTab(space, tab) {
    if (space.native) {
      return this.options.native({
        kind: "tab",
        spaceId: space.id.replace(/^native:/, ""),
        tabId: tab.id.replace(/^native:/, ""),
      });
    }
    this.edit("manage-tab", {
      spaceId: space.id,
      taskId: tab.id,
      name: tab.name,
    });
  }
  async changeTab(kind) {
    const a = this.action;
    if (!a || a.type !== "manage-tab") return;
    const ok = await this.save(a, (d) => {
      const space = d.spaces.find((s) => s.id === a.spaceId),
        index = space?.tabs.findIndex((t) => t.id === a.taskId) ?? -1;
      if (index < 0) throw Error("This tab closed. Refresh organization.");
      if (kind === "rename") space.tabs[index].name = a.name.trim();
      if (kind === "earlier" && index > 0) {
        [space.tabs[index - 1], space.tabs[index]] = [
          space.tabs[index],
          space.tabs[index - 1],
        ];
      }
      if (kind === "later" && index < space.tabs.length - 1) {
        [space.tabs[index], space.tabs[index + 1]] = [
          space.tabs[index + 1],
          space.tabs[index],
        ];
      }
      if (kind === "remove") {
        space.tabs.splice(index, 1);
        d.assignments = d.assignments.filter((x) => x.task !== a.taskId);
      }
    });
    if (ok) {
      if (kind === "remove") this.action = null;
      else a.base = $state.snapshot(this.documents[a.host.origin]);
    }
  }
  openTask(space, tab) {
    if (tab.items.length) {
      const current = this.options.selected();
      return this.options.open(
        tab.items.find((i) => sameSource(sourceRef(i), current)) ||
          tab.items[0],
      );
    }
    this.edit("empty", { spaceId: space.id, taskId: tab.id, name: tab.name });
  }
  move(item) {
    if (!item?.organizable || !item.generation) {
      this.options.status(
        item?.source === "Herdr"
          ? "This terminal follows its native Herdr space and tab."
          : "Refresh to confirm this terminal’s identity before organizing it.",
        true,
      );
      return;
    }
    const doc = this.documents[item.computer],
      assignment = doc?.assignments.find((a) =>
        sameSource(a.source, sourceRef(item))
      );
    this.edit("move", {
      item: $state.snapshot(item),
      taskId: assignment?.task || "",
    });
  }
  visibility(item, hide) {
    if (item?.source !== "Codex") return;
    const host = this.options.hostFor?.(item.computer) || this.host();
    if (host.origin !== item.computer) return;
    this.edit("visibility", { item: $state.snapshot(item), hide }, host);
  }
  async saveVisibility() {
    const a = this.action;
    if (a?.type !== "visibility" || a.item.source !== "Codex") return;
    const ref = sourceRef(a.item);
    if (
      await this.save(a, (d) => {
        d.hidden = (d.hidden || []).filter((s) => !sameSource(s, ref));
        if (a.hide) d.hidden.push(ref);
      })
    ) this.action = null;
  }
  async save(action, change) {
    if (this.busy || !action) return false;
    const next = structuredClone($state.snapshot(action.base));
    try {
      change(next);
    } catch (e) {
      action.error = e.message;
      return false;
    }
    this.busy = true;
    action.error = "";
    try {
      const saved = await computerOrganization({ ...action.host }).save(next);
      this.documents[action.host.origin] = saved;
      this.health[action.host.origin] = "ready";
      this.errors[action.host.origin] = "";
      return this.action === action;
    } catch (e) {
      action.error = e.message;
      return false;
    } finally {
      this.busy = false;
    }
  }
  async refreshAction() {
    const action = this.action;
    if (!action) return;
    const host = {
      ...(this.options.hostFor?.(action.host.origin) ||
        (this.host().origin === action.host.origin
          ? this.host()
          : action.host)),
    };
    const doc = await this.load(host, true);
    if (doc && this.action === action) {
      action.host = host;
      action.base = doc;
      action.error = "";
    }
  }
  async createSpace() {
    const a = this.action;
    if (!a?.name.trim() || !a.taskName.trim()) return;
    const space = {
      id: "local:" + crypto.randomUUID(),
      name: a.name.trim(),
      tabs: [{ id: "task:" + crypto.randomUUID(), name: a.taskName.trim() }],
    };
    if (await this.save(a, (d) => d.spaces.push(space))) this.action = null;
  }
  async createTask() {
    const a = this.action;
    if (!a?.name.trim()) return;
    const tab = { id: "task:" + crypto.randomUUID(), name: a.name.trim() };
    if (
      await this.save(a, (d) => {
        const space = d.spaces.find((s) => s.id === a.spaceId);
        if (!space) throw Error("This space closed.");
        space.tabs.push(tab);
      })
    ) {
      this.action = {
        ...a,
        type: "empty",
        taskId: tab.id,
        name: tab.name,
        base: $state.snapshot(this.documents[a.host.origin]),
      };
    }
  }
  startTerminal() {
    const a = this.action;
    if (!a) return;
    this.action = null;
    this.options.create({
      host: a.host.origin,
      spaceId: a.spaceId,
      taskId: a.taskId,
    });
  }
  addExisting() {
    if (this.action) this.action.type = "existing";
  }
  async assign(item = this.action?.item) {
    const a = this.action;
    if (
      !a || !item?.organizable || !item.generation ||
      item.computer !== a.host.origin
    ) return;
    const ref = sourceRef(item);
    if (
      await this.save(a, (d) => {
        if (
          a.taskId &&
          !d.spaces.some((s) => s.tabs.some((t) => t.id === a.taskId))
        ) throw Error("This tab closed. Choose another tab.");
        d.assignments = d.assignments.filter((x) => !sameSource(x.source, ref));
        if (a.taskId) {
          d.assignments.push({ source: ref, task: a.taskId });
          d.hidden = (d.hidden || []).filter((s) => !sameSource(s, ref));
        }
      })
    ) {
      const opening = a.type === "existing";
      this.action = null;
      if (opening) this.options.open(item);
    }
  }
  async changeSpace(change) {
    const a = this.action;
    if (
      await this.save(
        a,
        (d) => change(d, d.spaces.find((s) => s.id === a.spaceId)),
      )
    ) {
      if (this.action === a) {
        a.base = $state.snapshot(this.documents[a.host.origin]);
        a.error = "";
      }
    }
  }
  async removeSpace() {
    const a = this.action;
    if (
      await this.save(a, (d) => {
        const ids = new Set(
          d.spaces.find((s) => s.id === a.spaceId)?.tabs.map((t) => t.id),
        );
        d.spaces = d.spaces.filter((s) => s.id !== a.spaceId);
        d.assignments = d.assignments.filter((x) => !ids.has(x.task));
      })
    ) this.action = null;
  }
  async assignCreated(item, target) {
    const host = this.host();
    if (!item?.organizable || host.origin !== target.host) return false;
    const doc = this.documents[host.origin];
    if (!doc) return false;
    const ref = sourceRef(item), next = structuredClone($state.snapshot(doc));
    if (
      !next.spaces.some((s) =>
        s.id === target.spaceId && s.tabs.some((t) => t.id === target.taskId)
      )
    ) {
      throw Error(
        "The destination tab closed; the terminal remains Unassigned.",
      );
    }
    next.assignments = next.assignments.filter((x) =>
      !sameSource(x.source, ref)
    );
    next.assignments.push({ source: ref, task: target.taskId });
    this.documents[host.origin] = await computerOrganization({ ...host }).save(
      next,
    );
    return true;
  }
}
