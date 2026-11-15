# Validation record

## Final interface implementation candidate — 2026-11-10

The accepted sidebar/drawer layout is implemented in the real Svelte app, built into
an isolated candidate directory. The live web/dist and backend have not been changed
for this candidate. The physical Android gate requested at the isolated tailnet sample
is pending the user's result; activation is prepared as one atomic UI exchange.

- **52 workflows / 25 layouts** pass, with 44px controls and no measured overflow.
- The actual xterm grid is **272px / 63%** at 390 × 430 with tools closed.
- Desktop widths 959/960/1024/1280/1440, phone widths and landscape preserve the same
  terminal/composer and socket while changing navigation presentation.
- Computer overlay, pairing cancellation, local tab rename/reorder/removal, search,
  attention scope, Hide/Restore, exact-source drafts, scrolling and recovery pass.
- **Eight actual service-worker checks** verify old-build upgrade, pairings/drafts/
  organization, one installed-update notice, explicit safe reload, partial-installation
  failure and offline cached launch. **133 unit tests** pass.
- Desktop conversation chooser, Previews, camera simulation, organization API, private
  tmux identity/replacement and terminal recovery checks pass. Source/candidate hashes
  match. Build and typechecks pass; the existing xterm bundle advisory remains.

[Candidate verification](artifacts/final-implementation/verification.json) ·
[Desktop](artifacts/final-implementation/desktop.png) ·
[Reduced terminal](artifacts/final-implementation/keyboard.png) ·
[Attention drawer](artifacts/final-implementation/attention.png).

## Final interface review package

The next consolidated release is specified in [FINAL-SPEC.md](final-review/FINAL-SPEC.md).
Its clickable local review at http://127.0.0.1:5178/final-review/ uses isolated sample
data, with desktop sidebar and phone drawer presentations of one hierarchy. It includes
backlog visibility, Computer tools, error states and a visible UI-update path.

Review verification passes **12 interactions / 20 measured layouts**. Exact iframe
widths include 320/360/390/430px, landscape, the 959/960px breakpoint, and desktop sizes.
The reduced sample output area is **276px / 64%** at 390 × 430. This measures the proposed
shell; production xterm/transport and physical Android behavior remain implementation
release gates. The live app has not changed for this review.

[Results](final-review/REVIEW-RESULTS.md) · [Desktop](artifacts/final-review/desktop.png) ·
[Phone](artifacts/final-review/phone.png) · [Drawer](artifacts/final-review/drawer.png) ·
[Keyboard viewport](artifacts/final-review/keyboard.png) · [Measurements](artifacts/final-review/verification.json).

## Terminal history scrolling fix — 2026-11-09

Full-screen Herdr attachments have no local terminal scrollback and request mouse-wheel
reporting. The old touch path scrolled only the empty local buffer; snapshots also lost
the application's tracking/encoding flags. The fix restores those flags and routes touch
through the application's mouse protocol, with page-key fallback for full-screen apps
without mouse support. Ordinary history stays local. Input remains bound to the exact
current terminal, remote momentum stops on release, and the composer keeps its focus.

**42 real-app workflows / 20 layouts** and **133 unit tests** pass. Private tmux recovery
checks verify tracking/SGR restoration, disabled modes after reconnect, cursor and screen
state, and all 200 streamed records exactly once. Browser checks exercise normal-history
movement, wheel-up/down responses, page-key fallback, and horizontal swipes sending no
history input. The service update preserved **2 mobile terminal views / 9 native sources**;
the live phone origin and health checks pass.

[Application history fixture](artifacts/terminal-scroll/native-history.png) ·
[Measurements](artifacts/terminal-scroll/verification.json) ·
[Activation](artifacts/terminal-scroll/activation.json).

## Available conversations and Hide/Restore — 2026-11-09

The real app separates unorganized Codex sources into collapsed Available conversations.
Search still finds them. Hide from Deskpilot persists an exact conversation ID/generation
in computer-owned organization metadata; Show hidden exposes Restore. Original work,
mobile views and drafts remain intact. Native Herdr layout and ordinary terminals retain
their existing organization. No age/inactivity rule hides work automatically.

Validation passes **133 unit tests (7 steps)**, the two-device organization HTTP/restart
suite including hidden metadata, and **35 real-app workflows / 20 measured layouts**.
New checks exercise collapsed availability, 320/360/390/430px expanded rows, Hide review
with a revision conflict, reload/search exclusion, Restore, and an active draft during Hide.
The shared sample still passes **38 checks / 15 layouts**. Both builds pass; Vite retains
its existing xterm bundle advisory. The service update preserved **8 native Herdr sources**;
the phone HTTPS origin serves the current UI/update manifest and health checks pass.

[Available conversations](artifacts/available-conversations/available.png) ·
[Hide review](artifacts/available-conversations/hide-review.png) ·
[Measurements](artifacts/available-conversations/verification.json).

## Real Spaces implementation — 2026-11-09

The real `web/` app now implements Spaces/task navigation through authenticated discovery,
real xterm HTTP/WebSocket transport, native Herdr attachment/management and computer-owned
organization. The `/spaces` sample below remains simulated; earlier sections record the
previous prototypes and are superseded for current app navigation.

- Production web build and Deno typecheck pass. Vite retains its existing xterm bundle advisory.
- Unit suite: **131 tests (7 steps)** pass.
- Real app fixture suite: **29 workflow checks / 15 layouts** pass with no runtime errors.
  True iframe widths 320/360/390/430, landscape and reduced viewports have no measured
  overflow or controls below 44px. Actual xterm output is **272px / 63%** at 390 × 430.
- Private tmux runtime checks verify real input, stable identity through rename/server
  restart, and stale input/paste/kill/rename/attach/WebSocket rejection after replacement.
- Two-device organization API checks verify revision conflicts, persistence and revocation.
- Desktop conversation chooser, previews, simulated camera, and terminal recovery checks pass.
- The installed source service was restarted safely with `KillMode=process`; all **8 native
  Herdr sources** remained available. Live organization capabilities and `shell/check.sh` pass.
  Activation used read-only source checks, not live terminal input or management actions.

Drafts use host/source/ID/generation. Earlier name-only views require confirmation and
saved drafts remain available through explicit review. Failed/late connections preserve
the current recipient. Organization conflicts preserve the form and require refresh.
The final visual review also removed inherited outlined/centered row styling from Spaces.

[Metrics](artifacts/live-spaces/verification.json) · [Spaces](artifacts/live-spaces/spaces.png) ·
[Reduced terminal](artifacts/live-spaces/keyboard.png) · [Attention](artifacts/live-spaces/attention.png) ·
[Activation](artifacts/live-spaces/activation.json).

Physical Android IME retention and OS Back with a real keyboard remain on-device checks.
Browser focus/touch simulations do not prove those behaviors.

## Historical prototype and migration records

## Spaces trial — 2026-11-09

The new `/spaces` route is a local-only, simulated trial of one organizational model across native Herdr, ordinary terminals and supported conversations. The production app was not changed during this trial. The previous A+B implementation and comparison routes remain available.

- Build passes without compiler warnings.
- `npm run test:spaces`: **5 model tests, 38 browser workflow checks and 15 phone/landscape layouts pass**.
- Earlier comparison preservation suite: **185 behavior checks and 70 layouts pass**.
- Isolated `shell/check.sh`: all essential checks pass with five expected environment warnings. It used a temporary home, fake credential, private tmux socket and a minimal localhost HTTP fixture. It did not inspect the installed service or use real credentials.
- No runtime errors, unhandled rejections or production API requests occurred in the exercised workflows.

Checks cover opening recent work; drawer scroll without automatic keyboard focus; search; native task membership and pane swiping; exact-source prompt/paste drafts; canceled delayed connection; creating, assigning and removing local organization without starting/stopping terminals; mixed ordinary/Codex tasks; reload; explicit computer switching; attention and coverage; unavailable Herdr; pairing cancellation; previews; desktop capture; and offline recovery.

Layouts use true 320/360/390/430px iframe viewports, reduced 320/390 × 430 and 932 × 430 landscape. All measured visible controls meet 44px targets and no document overflow was found. Task strips intentionally scroll horizontally within the viewport. At 390 × 430 the terminal frame is **292px (67.9%)** with a **270px composer**; this is simulated text rather than xterm. Task/pane strips and the bottom toolbar hide in reduced viewports; the title drawer and previous/next remain available.

[Measurements](artifacts/spaces/verification.json) · [Terminal and tasks](artifacts/spaces/native-task.png) · [Drawer](artifacts/spaces/drawer.png) · [Reduced terminal](artifacts/spaces/keyboard.png) · [Without Herdr](artifacts/spaces/without-herdr.png) · [Attention filter](artifacts/spaces/attention.png).

Physical Android IME retention and system Back remain on-device checks. The sample organization is now persisted by fake computer in the isolated preview server, independently of drafts. A second independent browser context reads the same groups/membership without the original draft; concurrent edits surface conflicts and explicit refresh preserves the other browser’s change. Production navigation migration remains outside this cleanup.

### Cleanup verification

Task-bar + creates a task, and empty tasks offer Start terminal/Add existing work. Attention counts follow current/across-computer scope. An offline result names its own recovery target while preserving the original computer, terminal and draft; retry does not navigate automatically. Shared workbench, drawer, toolbar, model and organization client live under `web/src/lib/spaces/`, with simulated transport and comparison routing kept in the prototype.

Real server: `deno check server/server.ts` passes. The unit suite passes **127 tests (7 steps)**, including durable organization, corrupt-store preservation, schema/ownership checks, retained undiscovered sources, host binding and conflict behavior. `deno run -A tests/organization-api.ts` verifies two registered clients, stale/concurrent writes, invalid/oversized bodies, revoked credentials and restart persistence against a disposable server. The real app’s existing `tests/combined-mobile.ts` still passes **22 checks / 13 layouts**. No installed service was restarted or deployed.

[Empty task actions](artifacts/spaces/empty-task.png).


Verified 2026-11-02 in an isolated local Chromium profile against the standalone Vite preview.

- `npm run build`: passes with no compiler warnings.
- `npm test`: **185 behavior checks and 70 layout measurements pass**.
- Runtime errors and unhandled promise rejections: none in the exercised workflows.
- Production API requests: none. Page resources remain on the isolated prototype origin; storage uses only the prototype namespace.
- Primary fixture: 20 distinct Studio items, with duplicate titles/folders, detached work, unknown coverage, and explicit source identity.

The browser suite covers the eight task groups in [TASKS.md](TASKS.md) for all three earlier directions, plus the selected combined route. Combined checks cover Sessions/search, scoped drafts and resume, the reduced terminal, coverage, explicit cross-computer review and Back, and Computer tools. It exercises real horizontal and vertical touch events, stable native-tab sequences, frozen cross-computer review, prompt/paste identity, cancellation during delayed connection, stale native-close rejection, creation and unfinished-form restoration, exact-source rename/placement, adapter disconnect, device rename/revoke/re-pair, notifications and usage failure states, desktop capture guards, independent previews, headless capability handling, per-computer view restoration, history-free relaunch, and closed-source restoration.

## Selected combined app

The real app in `web/` now implements Sessions, Attention and Computer through its existing authenticated API and terminal transport. The `/combined` preview remains sample data; its chosen navigation is no longer presented as another undecided alternative.

- Real app build and prototype build: pass. The real app retains Vite's existing large-bundle advisory.
- Unit tests: **122 passed (7 steps)**.
- `tests/combined-mobile.ts`: **22 workflow checks and 13 measured layouts pass**, with no browser runtime errors.
- Preservation scripts: `tests/layout.ts`, `tests/conversations-mobile.ts`, `tests/herdr-mobile.ts`, `tests/previews-mobile.ts` and `tests/scanner.ts` pass against disposable fixtures. The scanner uses Chromium's simulated camera and produces visible video frames.
- `shell/check.sh`: all essential checks pass against a disposable server, temporary home and private tmux socket. Five expected environment warnings remain. The installed service and real credentials were not used.

The real terminal's actual `.xterm-screen` is **272px tall at 390 × 430 (63.3%)**, with a **274px composer**. Measured widths are 320/360/390/430, plus reduced and landscape views. No measured visible interactive target is shorter than 44px, and no document overflow or escaped controls were found. Focus and paste drafts survive source switching, reload and explicit computer switching. Delayed review attachment cannot navigate after cancellation; failed attachment retains the original terminal and draft.

Real app fixture artifacts: [metrics](artifacts/real-combined-verification.json), [Sessions](artifacts/real-combined-sessions.png), [reduced terminal](artifacts/real-combined-terminal-reduced.png), [Attention](artifacts/real-combined-attention.png), [Computer](artifacts/real-combined-computer.png).

Selected sample preview: [Sessions](artifacts/combined-sessions.png), [reduced terminal](artifacts/combined-keyboard.png), [Attention](artifacts/combined-attention.png), [Computer](artifacts/combined-computer.png).

## Measured sample layouts

Every measured page/panel has no document overflow, no horizontal escape of visible interactive controls, and no interactive target under 44px high. The 70 measurements include session lists and pairing/notification panels at 320, 360, 390, and 430px; terminals at those widths, landscape and reduced viewports; and preview, browser preferences, and installation screens.

The terminal frame is **292px high at 390 × 430**, or 67.9% of the viewport, with a **270px composer**. A separate rendered measurement confirms the text viewport itself is **288px (67.0%)**, inside the 292px frame; see [output-viewport.json](artifacts/output-viewport.json). Both exceed the requested 60% space target with tools closed. Measurements use true same-origin iframe viewports, rather than resizing a desktop browser window.

| Direction | Viewport | Terminal frame | Composer width | Overflow / short targets |
| --- | --- | --- | --- | --- |
| focus | 320 × 844 | 696px | 200px | None |
| focus | 360 × 844 | 696px | 240px | None |
| focus | 390 × 844 | 696px | 270px | None |
| focus | 430 × 844 | 696px | 310px | None |
| focus | 320 × 430 | 292px | 200px | None |
| focus | 390 × 430 · focused | 292px | 270px | None |
| focus | 932 × 430 | 292px | 600px | None |
| inbox | 320 × 844 | 696px | 200px | None |
| inbox | 360 × 844 | 696px | 240px | None |
| inbox | 390 × 844 | 696px | 270px | None |
| inbox | 430 × 844 | 696px | 310px | None |
| inbox | 320 × 430 | 292px | 200px | None |
| inbox | 390 × 430 · focused | 292px | 270px | None |
| inbox | 932 × 430 | 292px | 600px | None |
| explorer | 320 × 844 | 696px | 200px | None |
| explorer | 360 × 844 | 696px | 240px | None |
| explorer | 390 × 844 | 696px | 270px | None |
| explorer | 430 × 844 | 696px | 310px | None |
| explorer | 320 × 430 | 292px | 200px | None |
| explorer | 390 × 430 · focused | 292px | 270px | None |
| explorer | 932 × 430 | 292px | 600px | None |

Full measurements and assertions: [artifacts/verification.json](artifacts/verification.json).

## Visual review

The comparison launcher, mobile overview pages, reduced terminal/composer layouts, and native hierarchy were rendered. Representative screenshots were inspected for type hierarchy, spacing, source context, readable terminal output, composer visibility, and contained scrolling. The same components and styling are used for secondary screens across all directions.

| Screen | Screenshot |
| --- | --- |
| Comparison launcher | [launcher.png](artifacts/launcher.png) |
| Focus deck home | [focus-home.png](artifacts/focus-home.png) |
| Attention inbox home | [inbox-home.png](artifacts/inbox-home.png) |
| Computer explorer home | [explorer-home.png](artifacts/explorer-home.png) |
| Reduced Focus terminal | [focus-keyboard.png](artifacts/focus-keyboard.png) |
| Reduced Inbox terminal | [inbox-keyboard.png](artifacts/inbox-keyboard.png) |
| Reduced Explorer terminal | [explorer-keyboard.png](artifacts/explorer-keyboard.png) |
| Native hierarchy in A | [focus-native.png](artifacts/focus-native.png) |
| Native hierarchy in B | [inbox-native.png](artifacts/inbox-native.png) |
| Native hierarchy in C | [explorer-native.png](artifacts/explorer-native.png) |

## Limits and device follow-up

This is fixture validation, not a user study or live terminal test. A reduced viewport does not reproduce an Android IME. Focus retention under Chromium touch gestures is verified; physical Android keyboard retention and Android system Back remain unproven. Escape exercises keyboard-first dismissal separately. Sheet discoverability and same-native-tab swiping need task-based testing on the user's actual phone on the physical phone as follow-up to the selected navigation. Safari/iOS is still a compatibility check.

Terminal execution, camera, pairing, credential changes, push, native management, desktop actions/captures, and image publication are simulated. No service worker is installed and no PWA deployment is included. Browser copy uses a real clipboard where available, with selectable text as its fallback.

The standalone sample suite never contacts the production API. Real app verification uses HTTP/WebSocket fixtures and an isolated `shell/check.sh` environment as described above. No live management tests, installed-service restart or deployment were performed.

Use the selected local preview at `http://127.0.0.1:5178/combined`. The root launcher retains A/B/C as comparison history. Shared-token connection support remains removed; paired device authentication is used by the real app.
