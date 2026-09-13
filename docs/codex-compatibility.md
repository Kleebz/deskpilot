# Codex terminal compatibility

Investigated 2026-09-11 against Codex CLI 0.154.0 and Deskpilot c2dfd63.

**Implemented:** the new-session form now offers **Codex** and **Continue Codex**,
using `codex --no-alt-screen` and `codex resume --last --no-alt-screen`.
The terminal shortcut row includes `Ctrl+A` for expanding approval details.

The production reconnect fix lives in `server/terminal.ts`. It captures state
and text in one tmux command batch, discards output already represented in the
snapshot, and publishes the snapshot before subsequent live output. It retains
`-J` for wrapped-line copy semantics, restores cursor and modes, and resumes any
incomplete ANSI escape sequence. The actual tmux flag for bracketed paste is
`bracket_paste_flag`, correcting the initial prototype's field name.

Validation includes the full phone layout suite, intercepted launch payloads
for both presets at 320/360/390/430px, ten real-Codex screen comparisons, and
`tests/terminal-recovery.ts`: normal/alternate screens, wrapped history, typing
after reconnect, terminal modes, incomplete escapes, and 200 streamed records
delivered exactly once across repeated snapshots and a reconnect.
Copying now excludes empty padding at wide-character wrap boundaries. The
recovery suite verifies the exact copied Unicode line and the cursor's pending
wrap at a full right edge. After rebuilding and reloading the local service, a
live `/api/term` smoke check verified snapshots, reconnect, and typing against
tmux; the standard preflight passed.

The sections below preserve the initial prototype findings. Lifecycle hook
installation and notification integration remain separate work; these launch
buttons do not install hooks or alter Codex permissions.

## Method and results

`tests/terminal-probe.ts` drives a real Codex process on a separate tmux server.
It imports the production `ControlClient`, streams output over a loopback
WebSocket, and renders with the installed xterm.js. The baseline reproduces
`/api/term`'s capture bootstrap and `Term.svelte`'s reset/write behavior. Viewports
are same-origin iframes, so 320px actually means 320px.

Fixtures were an idle session, a completed 45-line response long enough to
scroll, and a real pending shell-approval dialog. The requested write was
confined to the empty temporary test directory and was rejected with Escape.
A multiline paste included quotes, a dollar sign, accents, and CJK characters;
it was never submitted.

The probe compares visible browser-buffer text with `tmux capture-pane`, ignoring
trailing whitespace on each row. It saves cursor coordinates, terminal modes,
browser scrollback, and screenshots. Screenshots of the broken reconnect,
restored paste, and phone-sized approval dialog were inspected.

| Scenario | Existing transport | Experimental restoration |
| --- | --- | --- |
| 320 / 360 / 390 / 430px width | Screen matches tmux | Screen matches tmux |
| Short viewport representing an open keyboard | Matches | Matches |
| Resize to desktop width and return to phone | Matches | Matches |
| Reconnect at the same size | Screen shifted; cursor not restored | Matches |
| Type after reconnect | Stale prompt; input on wrong row | Matches |
| Navigate approval choices after reconnect | Stale/misaligned dialog | Matches |
| Multiline paste after restored reconnect | Not separately measured | Three lines preserved; matches |

The long-response baseline passed 7 of 9 comparisons. Restoration passed all 9;
a subsequent run including multiline paste passed all 10. Approval-dialog results
were also 7 of 9 before restoration and 9 of 9 afterward. Two early runs saved
their complete results but hit a Chromium-profile cleanup race afterward; the
probe now retries cleanup while Chromium helper processes finish exiting.

Both plain `codex` and `codex --no-alt-screen` were observed using the normal
terminal buffer under tmux. A launch requesting `tui.alternate_screen="always"`
also reported `alternate_on=0`, so this does **not** establish compatibility with
a genuinely active alternate screen. The documented `--no-alt-screen` flag
remains a sensible explicit launch choice.

## Cause and prototype change

Production reconnects reset xterm, write `capture-pane -e -J -S -1000`, append a
final CRLF, and replay held output. This restores text without restoring the
terminal state expected by subsequent cursor-addressed output.

In the idle fixture, tmux's cursor was at column 2, row 15, while the browser's
cursor was at column 0, row 35. The extra CRLF scrolled the top border out of the
visible screen. Typing afterward left the old prompt visible and drew new input
below it.

The optional `--restore-state` path captures physical rows without `-J` or a final
CRLF, then restores cursor position, alternate-screen state, scroll region,
cursor visibility, insert mode, application cursor-key mode, and bracketed paste.
That resolved the measured failures in the initial experiment. The production
implementation above replaces its separate state/capture requests and retains
logical-line capture. The probe's `--restore-state` option now uses the shared
production helper; its default still reproduces the original broken baseline.

## Initial prototype limits and follow-up

- The initial experiment used separate state and capture requests and physical
  rows. The production implementation and regression suite now address output
  ordering and wrapped-line copy semantics.
- This is a transport probe, not the full Svelte PWA. Touch scrolling, actual
  software-keyboard events, app chrome, and real-phone behavior need end-to-end
  validation. The size round trip used one control client and does not establish
  that contention between two simultaneously active clients has disappeared.
- At a short viewport Codex collapses approval detail behind `Ctrl+A`; at 320px
  its long dialog heading is clipped by Codex itself. Choice labels remain
  visible. Deskpilot's shortcut row now includes `Ctrl+A`.
- Lifecycle hooks and notification approvals were not installed or tested.
  Arrow-key navigation and Escape were tested; no approval was accepted.

## Original implementation plan

1. Integrate terminal snapshot restoration with streaming/reconnect and normal
   shell regression tests.
2. Add `codex --no-alt-screen` and `codex resume --last --no-alt-screen` presets.
3. Make wrapper one-shot detection agent-aware: Codex `-p` selects a profile,
   unlike Claude's print flag. Codex `exec`, `review`, authentication, completion,
   and server commands should not be wrapped as interactive TUIs.
4. Adapt lifecycle hooks and session attribution. Keep notification approval
   restrictions until Codex-specific behavior has been validated.
5. Expose shortcuts for inspecting approval details, then validate the full PWA.

The [official CLI reference](https://learn.chatgpt.com/docs/developer-commands?surface=cli)
documents inline mode and resume. [Hooks](https://learn.chatgpt.com/docs/hooks)
provide lifecycle events suitable for the existing state adapter.
[Noninteractive mode](https://learn.chatgpt.com/docs/non-interactive-mode) serves
job-oriented execution. [App Server](https://learn.chatgpt.com/docs/app-server)
would suit a future native conversation UI, but these findings do not justify
that larger change now.

## Reproduction

Start a disposable Codex session on an isolated tmux socket in an empty test
directory. Use an isolated test configuration for live responses. The probe
itself does not launch Codex, copy credentials, submit prompts, or accept
permission requests. It does resize the supplied session and type an unsent
fixture, so never target a working session.

```sh
deno run -A tests/terminal-probe.ts /absolute/test-tmux-socket test-session /tmp/baseline
deno run -A tests/terminal-probe.ts /absolute/test-tmux-socket test-session /tmp/restored --restore-state
```

For a pending approval dialog, add `--dialog`; this replaces text/paste with
Down/Up navigation. Each run writes `results.json` and one PNG per scenario.
Mismatches are reported as `DIFFERS` and in `sameScreen`, rather than process
failures, so the deliberately broken baseline can collect all its evidence.
