---
name: deskpilot-preview
description: Capture and publish one visual progress preview to Deskpilot when the user asks to see the current task, UI, screenshot, or render on their phone. Use for an explicit preview request; ordinary prompts, coding changes, and completed turns do not trigger publication.
---

# Deskpilot preview

Show the current work on the user's phone by capturing and publishing one relevant
image. This workflow works in an ordinary terminal; it does not require tmux or change
terminal startup. It does not connect the terminal for remote input.

Only capture and publish when the user requests a preview. Do not add per-prompt hooks,
timers, file watchers, or automatic milestone publication. One request produces one
preview unless the user asks for more.

Use the working session's task context to choose the subject. Capture the actual UI,
render, or visual result with the project's existing tools. A headless browser image or
a CAD renderer is usually more useful than terminal text. Do not substitute a generated
illustration, mockup, or unrelated screenshot for the current result. If the requested
subject is unclear or cannot be captured with the available tools, explain the specific
gap rather than publishing an unrelated image.

For an actual desktop capture, use Deskpilot's guarded `desk.sh shot-window` helper.
It lives under the checkout's `scripts/` directory or `/usr/share/deskpilot/scripts/`.
Its lock checks must remain in effect; do not bypass them with raw `grim`. Project
renders and headless browser captures can be used without capturing the desktop.

Save the image to a temporary location, or use an existing current render if suitable.
Deskpilot accepts PNG/JPEG up to 8 MiB, 8192 pixels per side, and 32 megapixels. Publish
the selected image with the installed command:

```bash
deskpilot preview /path/to/preview.png --caption "What the current image shows"
```

The task label defaults to the tmux session or project directory name. Use
`--task "Task name"` if a different label is needed. Report success only after the
command succeeds, and tell the user which task to open in Deskpilot's Previews view.
If publishing fails, preserve the image and report the error; do not claim the phone
received it. Do not change authentication, terminal configuration, or the running task
to work around a failed preview.
