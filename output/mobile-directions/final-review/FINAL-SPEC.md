# Deskpilot final interface specification

Status: accepted for implementation. The real-app candidate is implemented and under
release verification; the isolated review itself does not change the live app. It consolidates the approved Spaces model and the
remaining navigation, clarity and update work into one release.

## Product decisions

Use one hierarchy everywhere: **computer → spaces → tabs → terminals**.
“Terminal” includes a shell, an agent terminal, and a supported conversation opened
through its adapter. Show the source where it matters. Use “tab” in the interface;
existing task IDs and saved organization remain valid.

The navigator is a persistent left sidebar at 960px and wider. Below 960px, a
labeled **Spaces** button at the top opens the same hierarchy as a drawer. A phone
in landscape still uses the drawer. An open mobile drawer closes when the sidebar
becomes available; selected work, drafts and expansion stay intact.

Keep one terminal visible at every width. Herdr splits remain sibling terminals
in their native tab. Previous/next controls and horizontal terminal swipes switch
between those siblings. A simultaneous multi-terminal grid is outside this release.

Remove the bottom Spaces/Needs you/Computer dock and the separate horizontal
tab and pane strips. Their destinations move into the single navigator and
the compact terminal header. This applies to both the normal and keyboard layouts.

## Navigator

Order the navigator as follows:

1. Selected computer, its connection state, and Computer tools.
2. Visible search.
3. All work / Needs you, with counts matching the chosen computer scope.
4. Search scope: This computer / All computers.
5. Spaces, their tabs, and the terminal rows beneath each tab.
6. Unassigned ordinary terminal leaves, when present, without an artificial tab layer.
7. Collapsed Available conversations, when present.
8. Show hidden / Restore and secondary creation/coverage actions.

The active space and tab initially expand. Remember explicit expansion and scroll
per computer. Always highlight the exact active terminal. A space row expands its
tabs; a tab row expands its terminal children. Selecting a terminal opens it.
Empty tabs offer Start terminal and Add existing work. Space and tab menus hold
creation, rename, ordering and management, with labeled targets.

Use terminal names in the hierarchy, with a small source/agent label. An “agent”
badge describes the program; it does not change the identity or ownership model.
Keep long names readable through wrapping in lists and ellipsis in the header.
Every name has a full accessible label.

Search returns consistent rows with computer, space/tab breadcrumb, source and
Open/Connect state. It includes available conversations. Hidden conversations
appear only after Show hidden is enabled; the toggle remains available while
enabled even if its count reaches zero. Searching across computers does not
switch the active computer until the requested source opens successfully.

Needs you is a filter in this navigator. It has no separate inbox, review mode or
cross-computer swipe sequence in the final interface. Show coverage details:
unsupported detection and unknown/unreachable state never imply all-clear.

## Terminal header and input

On a phone, use two compact rows, each at least 44px high:

- Spaces button, terminal name with space/tab context, and terminal actions.
- Computer control, source/connection context, previous and next terminal.

On a desktop, the persistent sidebar supplies Spaces and Computer navigation.
The main header shows the selected terminal, its context, source/connection and
previous/next/actions. Do not add another navigator above the terminal.

Keep the existing colorful terminal outline, system sans-serif navigation,
monospace output, compact/readable text-size choice, and reduced-motion behavior.
Show connection health separately from work activity and attention coverage.

Keep the composer mounted while opening navigation, changing viewport width or
switching terminals. Keep one output connection for the selected terminal.
Input tools contains labeled access to keys, paste without Enter, selectable copy
and text size. Preserve separate prompt/paste drafts and input history.

Vertical terminal gestures retain the corrected history behavior: local scrollback
for ordinary output, application mouse wheels for programs requesting them, and
PageUp/PageDown fallback for full-screen programs without mouse support. Horizontal
gestures switch only within the current tab. Scrolling and switching never submit
the composer. New output must not force ordinary scrollback to the bottom while
the user is reading earlier output.

Do not auto-open search or the keyboard when opening Spaces. While the keyboard
is visible, the same header remains usable and there is no bottom dock. Selecting
a sibling through previous/next or swipe retains composer focus. An explicit
drawer selection can close the drawer without automatically opening the keyboard.

## Available and hidden work

Native Herdr spaces/tabs/panes remain native. Ordinary terminals start Unassigned.
Unorganized Codex sources start in collapsed Available conversations with a count.
An explicitly organized conversation appears in its chosen tab.

Keep the implemented Hide from Deskpilot / Show hidden / Restore behavior.
Hiding changes only computer-owned visibility metadata, preserving original work,
mobile attachment and drafts. Assigning a hidden conversation to a tab restores
its visibility. Do not hide or expire sources automatically based on age or idleness.
Do not deduplicate native panes and conversations using names or folders.

## Computer and secondary screens

Computer opens from the navigator and the mobile header. It provides switching,
Desktop, Previews, Settings and Pair computer. Switching explicitly restores that
computer’s previous view and draft; ordinary terminal swipes never switch computers.

| Capability | Final destination and retained behavior |
| --- | --- |
| Start terminal | Navigator → New terminal, or empty tab → Start terminal. Preserve name, directory, editable command/presets, desktop placement and unfinished form. |
| Organize local work | Space/tab menus and Terminal actions → Move to tab. Preserve IDs, mixed-source membership and revision conflicts. Removing organization leaves programs running. |
| Native Herdr management | Space/tab/terminal contextual menus. Preserve create, rename, reorder, split, stop and reviewed subtree closure. Require native app availability for management; core attachment still works independently. Cross-space tab transfer remains unavailable. |
| Terminal lifecycle | Terminal actions → Disconnect mobile view for adapters; End session for ordinary work. Native Stop terminal/Close tab/Close space reviews affected original programs and rejects stale reviews. |
| Desktop | Computer → Desktop. Preserve workspace selector/swiping, window placement, tiling, explicit captures/enlargement, supported unlock and contextual terminal/conversation links. |
| Previews | Computer → Previews, with contextual access from terminal actions. Preserve publishing access, independent history/metadata, fit/actual size, refresh and removal. Names do not imply ownership. |
| Pairing | Computer → Pair computer; Settings → Computers & pairing. One-time code/QR enrollment. Cancel returns to the invoking subsection and control. |
| Devices | Settings → Authorized devices. Preserve rename/revoke and credential recovery. Do not clear pairings during UI upgrades. |
| Notifications and usage | Computer-scoped Settings pages. Preserve push repair/test and loading/empty/unavailable usage states. |
| Diagnostics | Settings → Connections. Separate reachability, authorization, provider discovery and terminal attachment. |
| Browser installation/preferences | Settings → App & installation. Clearly browser-scoped. Preserve installation and text-size preferences. |

Secondary forms use the same sheet/dialog pattern and context labels. One active
form is visible at a time, with a recorded parent. Back returns through forms
and sheets to the actual origin; it does not reset to a generic Settings root.
Destructive actions always name their exact computer/source and scope.

## Failures and updates

Use “Cannot reach [computer]” for a failed network request; suggest checking
Tailscale and waking the computer. The browser cannot prove which of those failed.
Use “Pairing required” for authorization failure. Provider unavailable, unknown
attention and closed/changed source each have their own wording and recovery.
Retained discovery is labeled with its last successful observation.

Keep the current terminal and editable drafts on failure, with sending disabled
when unavailable. Retry is explicit after bounded reconnect attempts. Never replay
input, automatically select another terminal or recreate closed work. Late replies
stay bound to the original host/source/form.

Add a visible “New UI ready — Reload” notice once a replacement service worker
has installed successfully. Save drafts before an explicit reload. Do not reload
automatically while composing. Check for updates on launch and return to the app;
an update failure leaves the current app usable. Settings shows the frontend build
and backend version separately, with a Check for updates action. A cached offline
UI is identified as such; it is not evidence that a computer is online.

Keep existing device authentication, saved host addresses, organization revisions
and source generations. No shared-key compatibility is reintroduced.

## Implementation in one batch

| Area | Planned change |
| --- | --- |
| App shell | Introduce a responsive sidebar/content layout and shared navigator presentation. Preserve the mounted terminal/composer across width changes and overlays. |
| SpaceBrowser and model | Use explicit space/tab expansion and consistent terminal leaves; name local tasks “tabs”; keep source identities and ownership. Add node menus without duplicate primary navigation. |
| SpaceTabs and bottom dock | Remove their production presentation after equivalent destinations and switching are available in the navigator/header. Keep historical prototypes separate. |
| Computer, forms and management | Reuse existing functional screens; standardize parent restoration, computer/source labels and visible failure/empty states. |
| Terminal/input | Preserve the proven xterm transport, fitting, scrolling and exact-source routing. Change surrounding layout and labels only unless a regression requires a targeted fix. |
| Installation/update | Add frontend build identity, installed-update notice, explicit safe reload and settings diagnostics. Preserve existing cache and credential boundaries. |
| Documentation/tests | Update current-app documentation and assertions together. Keep historical A/B/C studies as history, not current options. |

Build and validate the entire candidate away from the currently served web/dist
before activation. Compare it against the same existing fixtures and preserve all
unrelated working changes. Capture the previous build for rollback. Activate the
matching frontend/backend once, after reviewing this package and passing the gates
below. Verify the HTTPS phone origin, installed update path, credentials and
existing terminal/native identities after activation.

## Release gates and completion

- True iframe widths 320, 360, 390 and 430; 932 × 430 landscape; 390 × 430 reduced
  viewport; 959/960px breakpoint; desktop widths 1024/1280/1440.
- Every interactive target at least 44px high; no page/header overflow; names and
  search results remain usable with duplicate and long names among 20+ sources.
- At 390 × 430, actual xterm output at least 258px high with tools closed.
- Switching width, opening drawers and changing list filters never reconnects or
  replaces the active terminal. Only explicit source changes change its connection.
- Search, attention scope, tree expansion, drawer scroll and per-host restoration
  survive navigation/reload. No-Herdr and unavailable-management cases remain useful.
- Native/local creation, grouping, Hide/Restore and conflicting organization edits
  remain functional, source-bound and reversible where intended.
- Touch history moves in normal and full-screen modes. Horizontal swipes retain
  draft recipient/focus and return directly to their original list or Desktop.
- Back/Cancel handles copy, tools, pairing and native review; stale/destructive
  reviews remain rejected. Failed sends preserve original text and newer typing.
- Existing desktop conversation chooser, preview publishing/viewing, scanner,
  device/authentication, organization API and private-tmux recovery checks pass.
- Test a real service-worker upgrade from the previously built UI: one update
  notice, explicit reload, new UI build, same pairing/organization/drafts.
- Physical Android Chrome/PWA pass: open keyboard, read history, switch siblings,
  open/close Spaces, use OS Back, background/return, receive update and reload.
  Browser touch/viewport simulation does not replace this device pass.
- Production build, Deno checks/unit suite, relevant browser/runtime suites and
  shell/check.sh pass. The live URL serves the verified build after activation.

Once these checks pass, freeze the layout for ordinary use. Further work should
address reproduced bugs or missing preserved capabilities. New navigation models,
simultaneous split-terminal rendering and unrelated visual redesigns require a
separate explicit request.

## Review package verification

The clickable review uses isolated sample data and simulated actions, with no real
credentials, APIs or transport. Its layout measurements validate the proposed shell
and controls only. Production implementation, xterm sizing and physical Android
checks are release gates for the later consolidated change.
