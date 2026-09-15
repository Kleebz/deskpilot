# Production readiness progress

Updated: 2026-09-14

This tracks implementation of `deskpilot-production-handoff.md`. The intended
scope is a self-hosted, single-user deployment over Tailscale and HTTPS.

## Completed implementation

- Credential mutations use a same-directory `0600` temporary file, file sync,
  atomic rename, and directory sync. Enrollment, rename, and revocation return
  an API error when durable persistence cannot be acknowledged. Pre-replacement
  failures leave memory and disk unchanged. Existing corrupt or unreadable state
  stops startup and remains in place for recovery; only a missing file means
  first run.
- Active terminal connections and push subscriptions carry the authenticated
  device id. Revocation removes subscriptions first, durably revokes the
  credential, then closes all of that device's sockets and control clients
  without touching tmux. Registration and revocation share a serialization gate,
  and dead-subscription cleanup re-reads under that gate so a stale fanout
  cannot restore removed state. Subprocess and push network I/O run outside the
  gate; revocation cancels in-flight commands and sends associated with the
  requesting or receiving device, and a four-job ceiling bounds concurrent
  delivery work. Legacy master-token subscriptions have a null owner and remain
  explicitly shared.
- CI and tag release validation run typecheck, unit tests, shell syntax,
  compiled headless checks, real-tmux terminal recovery, and browser
  layout/scanner/recovery. The release workflow performs all checks on the
  tagged commit before packaging and publishing.
- Each machine uses its own scoped PushManager registration, allowing
  independent VAPID keys on one app origin. Server registration status is
  checked separately, machine and session identity travel in
  payload/tag/navigation, and remote-machine approvals open the request for
  authenticated review.
- JSON reads are capped at 512 KiB of actual bytes. Terminal messages, command
  queues, connection counts, and outbound socket buffers are bounded. Push
  endpoints require HTTPS (localhost is allowed for tests), keys are
  structurally validated, sends have an eight-second deadline and four-wide
  fanout, response bodies are cancelled, subprocesses have deadlines, and
  watcher polls cannot overlap.
- Source updates install locked dependencies, build, and typecheck in a
  disposable worktree. They atomically activate the complete UI, require an
  authenticated readiness response, and roll back the commit and UI on startup
  failure. The installer now stops if neither `sha256sum` nor OpenSSL can verify
  an archive. Recovery data and steps are documented in README.md.

## Validation evidence

- `deno check server/server.ts tests/revocation.ts`
- 50 credential, request-boundary, control, push, lifecycle, resume, and session
  unit tests
- production web build and compiled binary build
- real-tmux recovery, including 200 streamed records delivered exactly once
- compiled-binary headless suite, including self-revocation, active socket
  teardown, a WebSocket registration/revocation race, peer continuity, reconnect
  refusal, tmux survival, in-flight push cancellation, and subscription
  ownership reloaded after a server restart
- Chromium layout at five mobile viewports/orientations, scanner preview,
  application recovery, and cached cold launch with an alternate machine
  selected
- shell syntax and repository whitespace validation

The focused Astra security/concurrency review passed with no remaining release
blocker. It confirmed durable credential behavior, revocation of active and
in-flight access, bounded notification work, race coverage, and release
validation ordering. Release blockers 1, 2, and 3 are satisfied.

## External release checks

These require disposable machines or physical phones and are not represented by
a passing local unit test: fresh-machine install, upgrade/rollback against a
real user service, iOS and Android cold launch, sleep/wake, VPN loss/recovery,
and notification delivery through their production push providers. Keep the
release unpublished until those checks and the focused review are complete.
