# Agent state plan

Status: implemented on `design/agent-state-model`

This plan strengthens Deskpilot's human-directed agent supervision without changing its
tmux substrate or turning it into an agent-to-agent orchestration runtime.

## What already exists

Deskpilot already has most of the visible feature:

- `AgentState` persists `working`, `blocked`, and `done` per tmux session.
- Claude Code hooks normalize `UserPromptSubmit`, `PermissionRequest`, and `Stop` into
  those states through `shell/agent-hook.sh` and `POST /api/event`.
- A blocked report can carry a tool, detail, request ID, and a narrowly scoped one-tap
  approval.
- The session index sorts blocked sessions first and working sessions second.
- Every paired machine is polled for its blocked count, so the machine strip can show
  that another host needs attention.
- Sessions without hooks have a conservative output-stillness notification fallback.

The work is therefore a contract and correctness project, not a new status feature.

## Problems to solve

1. **`idle` conflates unrelated conditions.** It currently means no report, an ordinary
   shell, an unsupported agent, or an agent that is genuinely idle. The lifecycle state
   and terminal activity should be separate facts.
2. **Async reports can arrive out of order.** The last HTTP request received wins, even
   if an older hook process was delayed and posts after a newer state.
3. **Reports have no source or agent-run identity.** State is keyed only by tmux session
   name. A reused name, restarted agent, or second adapter cannot be distinguished from
   the previous reporter.
4. **State can become stale.** A missed `Stop` can leave `working` indefinitely. A
   permission accepted at the terminal can remain `blocked` until another hook happens.
5. **The fallback and explicit state disagree.** Output stillness can send a "waiting"
   notification but does not explain its lower confidence in the session model. It must
   never manufacture an authoritative `blocked` or `done` state.
6. **Cross-machine attention lacks detail.** The machine strip exposes only a count. The
   user must switch machines to learn which sessions are blocked and why.
7. **The adapter seam is claimed but not specified.** Another agent can call the endpoint,
   but there is no versioned payload contract or adapter guide to implement against.

## State model

Keep the user-facing lifecycle vocabulary:

| State | Meaning | Needs the user? |
|---|---|---|
| `working` | The agent accepted work and has not reported a terminal outcome. | No |
| `blocked` | The agent explicitly reports that progress requires a human decision or input. | Yes |
| `done` | The current turn ended and the session is ready for another prompt. | No |
| `unknown` | No current authoritative lifecycle report exists. | No |

Terminal activity is a separate observation:

| Activity | Meaning |
|---|---|
| `active` | The visible pane has changed substantively within the activity window. |
| `quiet` | It has not changed within the activity window. |

`quiet` does not imply `blocked`, `done`, or even that an agent is present. Long-running
commands can be quiet, and ordinary shells are often quiet. The UI may display an age or
subtle activity indicator, but only explicit `blocked` contributes to "needs you."

Each authoritative report should carry:

```json
{
  "version": 1,
  "session": "deskpilot",
  "state": "blocked",
  "source": "claude-code-hook",
  "sourceSession": "native-agent-session-id",
  "observedAt": 1789152000000,
  "agent": "claude-code",
  "reason": {
    "kind": "permission",
    "tool": "Bash",
    "detail": "deno test",
    "requestId": "random-request-id",
    "canApprove": true
  }
}
```

`sourceSession`, `agent`, and `reason` fields are optional. `version`, `session`, `state`,
`source`, and `observedAt` are required for the new contract. The server records its own
receipt time separately and rejects reports older than the latest accepted report for the
same `(session, source, sourceSession)` identity. Payload lengths remain bounded.

Approval remains a separate capability. A `blocked` report describes state; it does not
grant permission to act. The server derives `canApprove` from its own allowlist, requires
the current request ID, expires it, and consumes it before sending Enter as it does today.

## Source authority and reconciliation

Use these rules in order:

1. A current explicit adapter report is authoritative for lifecycle state.
2. A newer report from the same agent run supersedes an older one.
3. A new `sourceSession` supersedes persisted state from the previous agent run in that
   tmux session.
4. An approval sent through Deskpilot immediately clears that pending request and moves
   the lifecycle to `working`; a later explicit hook report remains authoritative.
5. Removing or renaming a tmux session removes or carries its state exactly as today.
6. Terminal output updates activity only. It never overwrites an explicit lifecycle
   state with `blocked` or `done`.
7. A `working` report gets a conservative freshness lease. When it expires without a
   newer report, show `unknown` plus terminal activity rather than claiming it is still
   working. The lease should be configurable and long enough for quiet builds; choose the
   default from measurements rather than the present 60-second stillness threshold.
8. A persisted `blocked` report survives a Deskpilot restart, because that is the state
   most important to retain. It is cleared by a newer report, a matching approval, agent
   run replacement, or session removal.

The existing unversioned `/api/event` payload remains accepted during migration and is
normalized internally as a legacy source. New adapters use the versioned contract. This
allows installed hooks from an older Deskpilot release to continue working during an
update.

## User experience

The session index should make the distinction visible without adding dashboard noise:

- `blocked`: show "needs you" or the tool/reason, sort first.
- `working`: show "working", sort after blocked.
- `done`: show "ready".
- `unknown`: show "terminal", making no agent lifecycle claim.

Add a cross-machine attention section to the session-first home view containing the
machine, session, and blocked reason from other reachable hosts. The selected host's
blocked sessions are already first in its normal list, so repeating them would create
duplicate rows. Selecting a cross-machine row switches to that machine and opens the
session. The machine picker retains its compact count. Unreachable machines remain an
availability concern rather than being presented as blocked agents.

Do not add agent spawning, dependency graphs, worktree ownership, agent-to-agent prompts,
or automated waits. The user remains the orchestrator.

## Delivery sequence

### 1. Extract and test the state reducer

Move state validation, ordering, persistence, pending-request reconciliation, rename, and
session-removal behavior out of the request handler into a small server module. Preserve
the current API and UI behavior during this step.

Acceptance checks:

- malformed or unknown states are rejected;
- older reports cannot replace newer reports;
- a new agent-run identity replaces stale state;
- persisted blocked state survives a server restart;
- rename and removal update both state and pending requests;
- approval consumes only the matching current request.

### 2. Introduce the versioned report contract

Add the normalized v1 request, retain the legacy request parser, and update
`shell/agent-hook.sh` to include its source, native session identity when available, and
observation time. Document the contract independently of Claude Code's hook schema.

Acceptance checks:

- old installed hooks still work against the new server;
- the updated adapter works against the new server;
- arbitrary agent-specific fields never leak above the adapter;
- a hook failure always exits successfully and cannot stall the agent.

### 3. Separate lifecycle from activity

Expose authoritative lifecycle and inferred terminal activity separately in the sessions
response. Reconcile approval and freshness as described above. Keep the watcher as the
fallback notification source, but label its result as inferred/quiet and never as a
permission request.

Acceptance checks:

- a quiet build is never labeled blocked or done;
- an unsupported agent and a plain shell are not falsely labeled idle agents;
- a missed terminal hook cannot leave `working` forever;
- approving a request removes "needs you" immediately;
- explicit state remains intact across the existing service-restart recovery test.

### 4. Complete the phone presentation

Display `ready` for done sessions, preserve blocked-first ordering, and add the detailed
cross-machine attention list. Fetch it with the existing bounded polling model; an
always-open event stream would add reconnect and background-browser complexity without
improving push delivery.

Acceptance checks:

- blocked sessions on other reachable machines are discoverable without switching
  machines one by one, while the selected machine shows them in its normal list;
- selecting an attention item opens the correct `(machine, session)` pair;
- stale responses from a previously selected machine cannot overwrite the current view;
- 320, 360, 390, and 430 px layout checks still pass;
- offline and headless hosts preserve their current behavior.

### 5. Publish the adapter seam

Add a short adapter guide with the lifecycle meanings, payload schema, ordering rules,
security expectations, and a minimal shell example. Add another first-party adapter only
when a supported agent offers lifecycle hooks with enough information to map these states
reliably. Screen-text matching remains a fallback, not an adapter strategy.

## Explicit non-goals

- Replacing tmux or supporting multiple multiplexer backends.
- Recreating Herdr's pane, worktree, plugin, or orchestration APIs.
- Treating output silence as proof that human action is required.
- Automatically approving a request based only on an adapter's assertion.
- Persisting full prompts or pane contents in the state store.
- Replacing Web Push or the existing multi-machine credential model.

## Release shape

Ship phases 1 through 3 together so the new semantics do not appear half-applied. Phase 4
can follow as a UI release after the server contract is stable. Phase 5 is documentation
and demand-driven adapters. Each phase preserves compatibility with existing tmux
sessions and previously installed Claude Code hooks.
