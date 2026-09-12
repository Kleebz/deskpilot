# Mobile UX verification

Implementation lives on `ui/mobile-ux`, rebased onto `main` at `1f552bb`, in
`/tmp/deskpilot-mobile-ux`. No merge or deployment is part of this change.
`Term.svelte` matches the composer fix on `main`. The mobile suite also checks that
a terminal tap retains composer focus and that xterm cannot accept mobile IME input.

The selected machine's sessions are home. Terminal selection and composer/paste drafts
use machine origin plus session name; workspace numbers only describe desktop placement.
Polling does not recreate the forms or list. Navigation records list scroll positions,
uses browser history, and restores focus after cancellation. Responses are bound to their
original machine; pairing and creation completion cannot navigate an unmounted view.

Machine labels are local aliases in the installed app, separate from the hostname returned
by capability negotiation. Screens keeps the redesign's explicit workspace selector and
adds back the old rail's native horizontal scroll-snap only within that view. The active
screen follows either input, is remembered per machine, and supplies the placement default
for a session created there.

Run from the isolated worktree:

```sh
npm --prefix web run build
deno test --allow-read --allow-write --allow-env tests/
deno run -A tests/layout.ts
deno run -A tests/scanner.ts
```

The browser checks start disposable HTTP/WebSocket fixtures on ports 8892–8894 and use
temporary Chromium profiles (debug ports 9342 and 9334). Run the two browser checks
sequentially. They never invoke tmux or mutate a real machine. The scanner retains its
explicit `--url` and `--token` options for separately supplied test servers.

Coverage includes attention ordering, detached sessions, two sessions on the same screen,
creation and placement defaults, polling drafts, Back navigation, restored focus and scroll,
pairing success/failure/already-paired/cancellation, late replies, machine switching,
headless controls, offline/authentication/loading/empty states, management separation,
and a reduced viewport representing the mobile keyboard.

Layout checks cover 320, 360, 390, and 430px portrait plus 932×430 landscape. They measure
viewport width, page overflow, touch target heights, composer width, and terminal space.
Representative screenshots are written to `/tmp/deskpilot-mobile-review`.

The keyboard check simulates a reduced visual viewport; it does not replace physical iOS
or Android keyboard testing. The camera test verifies a simulated preview, not a physical
camera's recognition or OS permission prompt. Terminal fixtures verify session identity
and rendering; they do not exercise live tmux input.
