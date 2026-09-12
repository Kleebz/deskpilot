# Agent lifecycle reports

Deskpilot keeps terminal activity separate from agent lifecycle. Output changing means a
terminal is active; it does not prove that an agent is working. Output becoming quiet does
not prove that an agent is blocked or done.

An agent adapter may explicitly report one of three lifecycle states:

- `working`: a turn began and has not reached an outcome;
- `blocked`: progress requires a human decision or input;
- `done`: the turn ended and the session is ready for another prompt.

Only `blocked` means the user is needed. A session with no current report is `unknown`.

## Report format

POST JSON to `http://127.0.0.1:8790/api/event` using the bearer token from
`~/.config/deskpilot/token`:

```json
{
  "version": 1,
  "session": "project-name",
  "state": "blocked",
  "source": "my-agent-hook",
  "sourceSession": "the-agent-conversation-id",
  "observedAt": 1789152000000,
  "agent": "my-agent",
  "reason": {
    "kind": "permission",
    "tool": "Bash",
    "detail": "deno test",
    "requestId": "a-unique-request-id"
  }
}
```

`version`, `session`, `state`, `source`, and `observedAt` are required. `observedAt` is
Unix time in milliseconds, captured when the hook starts rather than immediately before
the HTTP request; Deskpilot uses it to ignore a delayed asynchronous hook that arrives
after a newer event. Reports more than one minute in the future are rejected.

`sourceSession` should be the agent's native conversation or run ID when one is available.
It prevents state from a previous agent run being confused with a later run in the same
tmux session. `agent` is a display-neutral identifier. `reason` is useful for blocked
states and omitted otherwise. Strings are length-bounded by the server.

Adapters run inside the target tmux pane and should resolve the session through
`$TMUX_PANE`:

```bash
session=$(tmux display-message -p -t "$TMUX_PANE" '#S')
```

They should read the token at invocation time rather than copying it into an agent's
world-readable settings file. They must also fail open: an unavailable Deskpilot server
must never hold up the agent whose state it was trying to report. The shipped
`shell/agent-hook.sh` is the reference adapter.

## Approval boundary

A blocked report does not authorize Deskpilot to approve anything. The server decides
whether a named tool is eligible, binds approval to the current request ID, expires it,
and consumes it before sending a key. Adapters cannot widen that allowlist.

Older, unversioned event payloads remain accepted so hooks installed by a previous
Deskpilot release continue to work during an update.
