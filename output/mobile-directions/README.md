# Deskpilot mobile directions

**Accepted final interface:** [the consolidated specification](final-review/FINAL-SPEC.md) is implemented as a real-app candidate, with one responsive sidebar/drawer hierarchy. Its browser/runtime checks pass; the physical Android check is pending before one activation. The isolated clickable design review remains at http://127.0.0.1:5178/final-review/. Older studies below are history, not open choices.

Run `npm run test:final-review` with the sample server running. The review uses isolated sample data, simulated terminal/management/pairing/update actions, and no real credentials or APIs. Production xterm/transport and physical Android checks are release gates in the specification.

**Earlier Spaces prototype retained at `/spaces`.** It opens the most recent terminal, provides a searchable work drawer with attention filtering, and presents task tabs with one terminal visible at a time. Existing Herdr spaces/tabs retain native membership; ordinary terminals start Unassigned, while unorganized Codex work is collapsed under Available conversations. Both can be explicitly moved into local spaces. It works with the Herdr fixtures removed. This remains an isolated prototype. The real app in `web/` now uses Spaces with authenticated discovery, terminal transport and durable organization, plus persisted Hide/Restore for conversations. Hide/Restore is implemented in the real app; the standalone sample only shares the availability grouping.

Try: open Spaces → New space, create a task, then use a terminal’s Session actions → Move to task. The task-bar + creates another task; empty tasks offer Start terminal or Add existing work. Computer retains Desktop, Previews, settings and pairing. Test states → Simulate no Herdr installed exercises independence. The Spaces route has its own saved drafts and view; organization is shared by fake computer through the local sample server; names/folders never group sources automatically. Removing local organization returns work to Unassigned without stopping it.


The **selected combined preview** and three earlier comparisons share one isolated fixture model and common terminal, input, pairing, desktop, preview, native-management, and settings screens. The earlier combined navigation is retained here for comparison; the real app now implements Spaces.

```sh
cd output/mobile-directions
npm ci
npm run dev
```

Open **http://127.0.0.1:5178/spaces** for the current trial, or **http://127.0.0.1:5178/combined** for the previous **Focus + Attention** preview. It uses Sessions, Attention, and Computer, restores saved work, and crosses computers only through an explicit review. The root launcher puts the current Spaces trial first; the original studies remain below for reference:

| Route | Starting point | Session navigation |
| --- | --- | --- |
| `/spaces` | Recent terminal; Spaces drawer for browsing | Explicit task membership; native panes stay in their original tab |
| `/combined` | Sessions and recent work, or saved view | Local session/native-tab sequence; explicit Attention review across computers |
| `/focus` | Recent work and reported attention on the selected computer | Ordinary terminals and attached Codex views on that computer; Herdr stays in its native tab |
| `/inbox` | Reported attention across computers; Library has all work | “Review across computers” freezes the visible attention sequence; ordinary opens use the local sequence |
| `/explorer` | Computers, with search across computers | Computer → Sessions or Herdr → space → tab → pane; ordinary sequences stay on the computer |

For a physical phone on the same LAN, run `npm run dev -- --host 0.0.0.0` and open `http://<computer-LAN-IP>:5178/` in Android Chrome. This exposes only these fixtures. Secure-context features such as clipboard access may be unavailable over plain LAN HTTP; selectable copy remains available. No LAN server was started during this pass.

A saved terminal or other view is restored on relaunch in each direction. “Home,” “Attention,” and “Computers” explicitly open their respective overview. Each direction has separate storage, so trying B does not disturb A.

Use **Test states** at the bottom to change connection health, attention coverage, native-management availability, close work, or reset the direction. The terminal title opens searchable switching. Previous/next buttons and horizontal terminal swipes follow the frozen visit sequence. Vertical movement scrolls output. Input tools contains keys, separate paste drafts, selectable copy, input history, and text size.

## Fixtures and isolation

Studio starts with exactly **20 independent items**: 8 ordinary terminals, 4 Codex conversations, and 8 Herdr panes in 2 spaces and 4 tabs. Duplicate titles and folders are intentional. Build server is headless, supports native core attachment, and lacks native app management. Travel laptop is offline with stale inventory. All computers expose clear health and capability information.

Transport, terminal responses, pairing, QR camera, push, desktop captures/unlock/tiling, image publication, and native management are **simulated in browser memory and isolated local storage**. The published images are code-generated SVG stand-ins. Copy output uses the browser clipboard when available. The preview shares transport-free navigation/model helpers from `web/src/lib/spaces/` and the organization schema validator. It never imports the real host keyring/API adapter, proxies `/api`, installs a service worker, or calls a production API/live management command. Pairing accepts example values only and never opens the camera. Pairing codes and passwords are not persisted. This sample does not modify production navigation or deploy anything; the real app implementation lives separately in `web/`.

Spaces organization uses only the local `/__prototype/organization/{studio|build|travel}` middleware. Its sample files are under ignored `.prototype-state/review/`, separate from real Deskpilot state. They survive browser resets and preview-server restarts. New browsers on the same preview origin read the same sample spaces. A stale revision requires an explicit refresh; drafts are not sent to this store. Existing browser-only sample organization migrates only into an empty server document, with a browser backup retained. Test contexts use independent sample namespaces.

The real server now provides registered-device GET/POST `/api/organization`, persisted as `~/.local/state/deskpilot/organization.json`, with atomic writes, restrictive permissions and revision conflicts. `web/src/lib/organization.js` binds the authenticated client to its original host. The real app and running source service now use Spaces; these sample routes remain isolated.

Browser storage keys begin `deskpilot-mobile-directions:v1:` and are direction-specific. Draft identity includes computer, source, fixture ID, and generation. Source identity and native generation remain independent of display names and mobile connection state. A reconnect never resends input. Late responses remain with their original recipient. Source closure does not select or recreate other work.

## Verification

```sh
npm run build
# With the isolated preview already running:
npm test
npm run test:spaces
```

Browser checks use an independently launched Chromium profile and true same-origin iframes at 320, 360, 390, and 430px, 932×430 landscape, and 320/390×430 reduced viewports. They verify navigation and state across all directions, measure overflow and minimum 44px target heights, and assert at least 258px (60%) terminal output at 390×430 with tools closed. Screenshots and the machine-readable report are in `artifacts/`.

The prototype check does not probe the live service. The standalone build and fixture browser suite verify this project without accessing real credentials. The real app has its own fixture/runtime checks, and `shell/check.sh` also passed against the activated service; see [VALIDATION.md](VALIDATION.md).

Read [TASKS.md](TASKS.md) for the eight comparison scripts and [PARITY.md](PARITY.md) for capability destinations and simulation boundaries. [VALIDATION.md](VALIDATION.md) records measured results and device work still needed.

Physical Android IME retention, Android system Back with a real soft keyboard, sheet discoverability, and the usefulness of same-tab native swiping remain on-device study questions. Chromium focus and reduced-viewport checks are not evidence of physical-phone usability. iOS remains a compatibility check. The prototype is a shortcut-capable webpage; PWA installation and push are simulated, not production implementations.
