export type Lifecycle = "working" | "blocked" | "done";

export type LifecycleReport = {
  state: Lifecycle;
  source: string;
  sourceSession?: string;
  observedAt: number;
  agent?: string;
  tool?: string;
  detail?: string;
  requestId?: string;
  canApprove?: boolean;
};

type Stored = LifecycleReport & { since: number; receivedAt: number };
type Pending = { requestId: string; at: number; canApprove: boolean };

export type ApprovalResult = "ok" | "missing" | "forbidden" | "expired";

export class AgentStates {
  #states = new Map<string, Stored>();
  #pending = new Map<string, Pending>();
  #retiredRuns = new Map<string, Map<string, Set<string>>>();
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    readonly path: string,
    readonly validSession: (name: string) => boolean,
    readonly workingLeaseMs = 30 * 60_000,
    readonly saveDelayMs = 500,
  ) {
    try {
      const raw = JSON.parse(Deno.readTextFileSync(path)) as Record<
        string,
        Partial<Stored>
      >;
      for (const [session, value] of Object.entries(raw)) {
        if (!validSession(session) || !isLifecycle(value.state)) continue;
        const since = finite(value.since, 0);
        this.#states.set(session, {
          state: value.state,
          source: clean(value.source, 64) || "legacy",
          ...(clean(value.sourceSession, 128)
            ? { sourceSession: clean(value.sourceSession, 128) }
            : {}),
          observedAt: finite(value.observedAt, since),
          receivedAt: finite(value.receivedAt, since),
          since,
          ...(clean(value.agent, 64) ? { agent: clean(value.agent, 64) } : {}),
          ...(clean(value.tool, 64) ? { tool: clean(value.tool, 64) } : {}),
          ...(clean(value.detail, 200)
            ? { detail: clean(value.detail, 200) }
            : {}),
          // Approval capability is deliberately not restored. The matching
          // in-memory pending request disappeared with the old process.
          canApprove: false,
        });
      }
    } catch { /* first run, empty file, or unreadable state */ }
  }

  report(session: string, report: LifecycleReport, now = Date.now()): boolean {
    if (!this.validSession(session) || !validReport(report, now)) return false;
    const current = this.#states.get(session);
    const run = clean(report.sourceSession, 128);
    const retired = this.#retiredRuns.get(session)?.get(report.source);
    if (run && retired?.has(run)) return false;
    if (current && report.observedAt < current.observedAt) return false;
    if (
      current?.source === report.source && current.sourceSession && run &&
      current.sourceSession !== run
    ) {
      let bySource = this.#retiredRuns.get(session);
      if (!bySource) this.#retiredRuns.set(session, bySource = new Map());
      let runs = bySource.get(report.source);
      if (!runs) bySource.set(report.source, runs = new Set());
      runs.add(current.sourceSession);
    }

    const next: Stored = {
      state: report.state,
      source: clean(report.source, 64),
      observedAt: report.observedAt,
      receivedAt: now,
      since: now,
      ...(clean(report.sourceSession, 128)
        ? { sourceSession: clean(report.sourceSession, 128) }
        : {}),
      ...(clean(report.agent, 64) ? { agent: clean(report.agent, 64) } : {}),
      ...(report.state === "blocked" && clean(report.tool, 64)
        ? { tool: clean(report.tool, 64) }
        : {}),
      ...(report.state === "blocked" && clean(report.detail, 200)
        ? { detail: clean(report.detail, 200) }
        : {}),
      ...(report.state === "blocked" && clean(report.requestId, 64)
        ? { requestId: clean(report.requestId, 64) }
        : {}),
      canApprove: report.state === "blocked" && report.canApprove === true,
    };
    this.#states.set(session, next);
    if (next.state === "blocked" && next.requestId) {
      this.#pending.set(session, {
        requestId: next.requestId,
        at: now,
        canApprove: next.canApprove === true,
      });
    } else this.#pending.delete(session);
    this.#saveSoon();
    return true;
  }

  view(session: string, now = Date.now()) {
    const value = this.#states.get(session);
    if (!value) {
      return { state: "unknown" as const, since: 0, canApprove: false };
    }
    if (
      value.state === "working" && now - value.receivedAt > this.workingLeaseMs
    ) {
      return {
        state: "unknown" as const,
        since: value.since,
        stale: true,
        canApprove: false,
      };
    }
    const pending = this.#pending.get(session);
    const canApprove = !!pending && pending.canApprove;
    return {
      state: value.state,
      since: value.since,
      source: value.source,
      ...(value.sourceSession ? { sourceSession: value.sourceSession } : {}),
      ...(value.agent ? { agent: value.agent } : {}),
      ...(value.tool ? { tool: value.tool } : {}),
      ...(value.detail ? { detail: value.detail } : {}),
      ...(value.requestId ? { reqid: value.requestId } : {}),
      canApprove,
    };
  }

  approve(
    session: string,
    requestId: string,
    ttlMs: number,
    now = Date.now(),
  ): ApprovalResult {
    const pending = this.#pending.get(session);
    if (!pending || !requestId || pending.requestId !== requestId) {
      return "missing";
    }
    if (!pending.canApprove) return "forbidden";
    if (now - pending.at > ttlMs) {
      this.#pending.delete(session);
      return "expired";
    }
    this.#pending.delete(session);
    const current = this.#states.get(session);
    if (current) {
      this.#states.set(session, {
        state: "working",
        source: current.source,
        ...(current.sourceSession
          ? { sourceSession: current.sourceSession }
          : {}),
        ...(current.agent ? { agent: current.agent } : {}),
        observedAt: Math.max(now, current.observedAt + 1),
        receivedAt: now,
        since: now,
      });
      this.#saveSoon();
    }
    return "ok";
  }

  rename(from: string, to: string) {
    const state = this.#states.get(from);
    if (state) {
      this.#states.delete(from);
      this.#states.set(to, state);
    }
    const pending = this.#pending.get(from);
    if (pending) {
      this.#pending.delete(from);
      this.#pending.set(to, pending);
    }
    const retired = this.#retiredRuns.get(from);
    if (retired) {
      this.#retiredRuns.delete(from);
      this.#retiredRuns.set(to, retired);
    }
    if (state || pending) this.#saveSoon();
  }

  remove(session: string) {
    const changed = this.#states.delete(session);
    this.#pending.delete(session);
    this.#retiredRuns.delete(session);
    if (changed) this.#saveSoon();
  }

  prune(live: string[]) {
    const keep = new Set(live);
    for (const session of [...this.#states.keys()]) {
      if (!keep.has(session)) this.remove(session);
    }
  }

  async flush() {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    await this.#save();
  }

  #saveSoon() {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#save().catch((e) =>
        console.error(`agent state: could not write ${this.path}: ${e.message}`)
      );
    }, this.saveDelayMs);
  }

  async #save() {
    const durable = [...this.#states].map(([session, value]) => {
      const { requestId: _requestId, canApprove: _canApprove, ...state } =
        value;
      return [session, state];
    });
    await Deno.writeTextFile(
      this.path,
      JSON.stringify(Object.fromEntries(durable)),
    );
  }
}

export function isLifecycle(value: unknown): value is Lifecycle {
  return value === "working" || value === "blocked" || value === "done";
}

function validReport(report: LifecycleReport, now: number) {
  return isLifecycle(report.state) && !!clean(report.source, 64) &&
    Number.isFinite(report.observedAt) && report.observedAt > 0 &&
    report.observedAt <= now + 60_000;
}

function clean(value: unknown, length: number) {
  return String(value ?? "").slice(0, length);
}

function finite(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
