# Capability parity

**Implemented: Spaces/task navigation.** Spaces search and a single work drawer cover all
sources. Task tabs contain local terminals/conversations or native Herdr panes; native
membership and management stay native. Needs you filters the same browser. Computer
retains Desktop, Previews, pairing and settings. Input tools and lifecycle actions use
the real app's terminal transport. See [VALIDATION.md](VALIDATION.md) for live checks.

**Current trial: Spaces + tasks (`/spaces`).** One drawer searches all source types and filters reported attention; native Herdr spaces/tabs preserve their own IDs, order and pane membership. Ordinary terminals begin Unassigned; unorganized Codex work starts in collapsed Available conversations. Both support explicit local spaces and task tabs. Mixed-source local tasks share a terminal sequence, with per-source/generation drafts. Herdr remains optional. Local organization is sample metadata persisted per fake computer by the isolated preview server and does not create, stop or recreate programs. Creating a task opens Start terminal/Add existing work; starting a terminal is an explicit separate action. A fresh browser sees the same membership; drafts remain browser-specific. Conflicts require an explicit refresh. Native structural management continues through the shared native management screen. Input tools, computer switching, Desktop, Previews, pairing, settings and recovery reuse the existing working secondary screens. The A/B/C tables below are retained as historical comparisons.


**Earlier direction: Focus + Attention (`/combined`).** Sessions and normal terminal navigation follow A; Attention and its explicitly started review sequence follow B. Computer contains Desktop, Previews, pairing and settings. All shared destinations below remain available. The real app now implements Spaces/task navigation in `web/`; these tables retain A/B/C as comparison history.

All secondary screens and actions below are shared Svelte components/branches. “Computer” means the selected-computer sheet (also available from the top computer picker). B additionally presents its Computers list. C exposes the same tools on the computer landing page. Every operation is simulated except browser text selection/copy and local persistence.

| Capability | A: Focus deck | B: Attention inbox | C: Computer explorer | Working behavior / boundary |
| --- | --- | --- | --- | --- |
| Relaunch | Saved view; Home opens recent work | Saved view; Attention opens requests | Saved branch; Computers opens root | Separate direction storage; view, drafts, sequence, search/filter, scroll, native selection restore |
| Ordinary terminals | Sessions | Library | Computer → Sessions | Search, duplicate IDs, desktop ordering, detached terminals, ordinary sources stay outside native hierarchy |
| Codex | Sessions / title switcher | Library / title switcher | Sessions / root search | Explicit Connect; exact source ID; long titles; coverage unknown; cancellation ignores late navigation |
| Native search | Sessions; Browse Herdr | Library; Browse Herdr | Root search or Computer → Herdr | Search includes source, folder, computer, native space and tab context |
| Native hierarchy | Sessions → Browse Herdr | Library → Browse Herdr | Computer → Herdr | Select space, tab, pane; native pane membership and order retained |
| Terminal navigation | Same computer | Local sequence; explicit review spans computers | Same computer | Frozen visit order; native sequences stay in current tab; previous/next and horizontal swipe; vertical output scrolling |
| Attention coverage | Home → Reported attention / Coverage details | Attention + Coverage gaps | Sessions → Needs you / Coverage details | Health, activity, and coverage explained separately; offline/unknown never imply all-clear |
| Prompt and drafts | Terminal composer | Same | Same | Computer/source/ID/generation identity; separate paste draft; never automatically replay input |
| Input tools | Terminal ＋ | Same | Same | Enter/Escape/Tab/control/arrows, selectable copy, input history, text size |
| Paste without Enter | Input tools → Paste | Same | Same | Separate draft and explicit simulated typing without submission |
| Copy output | Input tools → Select & copy | Same | Same | Selectable textarea and actual browser clipboard with fallback |
| Create ordinary work | Sessions → New / Desktop → Session | Library → New / Desktop → Session | Sessions → New / Desktop → Session | Name, folder, editable command, presets, placement; unsent creation form restore |
| Rename / place | Session actions | Same | Same | Display names preserve identity; desktop placement changes the fixture workspace |
| Adapter lifecycle | Session actions → Disconnect mobile view | Same | Same | Closes simulated attachment; original Codex/Herdr source remains discoverable |
| Original lifecycle | End session / Stop Herdr terminal | Same | Same | Exact affected ID/generation review; original work closes in fixtures; drafts retained |
| Native creation | Herdr → Manage → Create space/tab/split | Same | Same | Directory/command inputs and new native identities; native membership and pane order update |
| Native rename / reorder | Herdr → Manage space & tab | Same | Same | Space/tab names and relative ordering change; current swipe sequence stays fixed |
| Native subtree closure | Manage → Review close space/tab | Same | Same | Lists affected programs; digest includes source generations and membership; changed review rejected |
| Native limitations | Manage / Test states | Same | Same | Unavailable app management disables mutation while core attachment remains possible; no cross-space transfer |
| Computer switching | Computer sheet | Top picker / Computers | Top picker / Computers | Explicit picker switch restores prior computer view; session swipe never changes computers in A/C |
| Pair computer | Computer → Pair / Settings → Machines & pairing | Computers → Pair / same Settings | Computers → Pair / same Settings | Link, address+code, simulated QR; expired/already-paired/success/cancel; no camera or credential access |
| Local labels / forget | Settings → Machines & pairing | Same | Same | Rename/reset labels, reviewed local forget; does not stop work |
| Authorized devices | Computer settings → Authorized devices | Same | Same | Current browser, last-seen, rename, reviewed revoke, re-pair |
| Notifications | Computer settings → Notifications | Same | Same | Per-computer enable/disable, test, repair; denied and unsupported permission states |
| Usage | Computer settings → Usage | Same | Same | Remaining allowances, reset windows, stale/unavailable collector simulation |
| Diagnostics / credential recovery | Computer settings → Diagnostics / terminal actions | Same | Same | Online, offline, reconnecting, unauthorized, unsupported capabilities; retry/re-pair; draft preservation |
| Browser preferences | Computer settings → Browser preferences | Same | Same | Browser-scoped installation guidance, static outline and text size; no service worker registered |
| Desktop selection | Computer → Desktop | Computers → selected computer → Desktop | Computer → Desktop | Workspace selector, previous/next/swipe, per-computer route state |
| Desktop windows | Desktop → window actions | Same | Same | Open/connect exact listed source; move, tile, explicit capture/enlarge; Herdr links to app scope |
| Capture / unlock | Desktop | Same | Same | Explicit simulated captures; locked/offline guards; supported lock/unlock actions; headless explanation |
| Preview access | Computer → Previews | Computers → selected computer → Previews | Computer → Previews | Independent from terminal attachment; explicit publishing destination |
| Preview history / metadata | Previews | Same | Same | Selected image, caption, time, dimensions; refresh; publish/remove simulation |
| Preview viewing | Previews → enlarge | Same | Same | Fit or actual-size scrolling, with overflow contained inside the image viewport |
| Closed work / late response | Test states; connection and input flows | Same | Same | No silent fallback or recreation; late input responses remain with original target |
| Reduced motion | System preference / Browser preferences | Same | Same | Static colorful outline; animation denotes output activity independently of attention |

This matrix describes prototype destinations and simulated interactions, not production feature implementation or completed device usability research.
