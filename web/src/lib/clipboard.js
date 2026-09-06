// Getting text into a phone's clipboard is not one API, it is three, and which
// of them exists depends on how you reached the app.
//
// `navigator.clipboard` is defined only in a secure context. deskpilot over
// plain http on a tailnet IP is not one — only https and localhost are exempt —
// so on a machine that has not run shell/use-https.sh the modern API is simply
// absent, and a copy button written against it does nothing at all, silently.
// That is the same class of failure as everything in CLAUDE.md's trap list, so
// it is handled here rather than discovered on a phone in a car park.
//
// `document.execCommand("copy")` still works in an insecure context, which is
// the whole reason the fallback exists. Deprecated, not removed, and there is
// no announced date.
//
// The last resort is not an error, it is the text itself, selected: the phone's
// own long-press → Copy is the one path that is always available. It is also
// why the copy sheet renders plain selectable text — a native selection can
// take part of a line, which no button can offer.

const SECURE = () => !!navigator.clipboard?.writeText;

// "clipboard" | "exec" | false — the caller says something different when the
// text is merely selected, so a failure has to be distinguishable from silence.
export async function copyText(text) {
  if (!text) return false;
  if (SECURE()) {
    try {
      await navigator.clipboard.writeText(text);
      return "clipboard";
    } catch { /* denied, or not a user gesture — try the old way */ }
  }
  return execCopy(text) ? "exec" : false;
}

function execCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  // Off-screen, not hidden: an element with display:none or visibility:hidden
  // cannot hold a selection, and a selection is what execCommand copies.
  // Fixed at the top so focusing it cannot scroll the page under the sheet.
  ta.style.cssText =
    "position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;";
  ta.setAttribute("aria-hidden", "true");
  document.body.appendChild(ta);

  const sel = document.getSelection();
  const prev = sel && sel.rangeCount ? sel.getRangeAt(0) : null;

  // iOS ignores select() on a textarea it considers read-only, and ignores
  // setSelectionRange on one it does not. Doing all three is what actually
  // works across both, and costs nothing on a browser that only needed one.
  ta.contentEditable = "true";
  ta.readOnly = false;
  const range = document.createRange();
  range.selectNodeContents(ta);
  sel?.removeAllRanges();
  sel?.addRange(range);
  ta.setSelectionRange(0, text.length);
  ta.focus();

  let ok = false;
  try { ok = document.execCommand("copy"); } catch { ok = false; }

  ta.remove();
  // Put back whatever the user had selected, or copying wipes the selection
  // they were about to long-press.
  if (prev) { sel.removeAllRanges(); sel.addRange(prev); }
  return ok;
}

// Select an element's text so the phone's own copy menu can finish the job.
export function selectNode(node) {
  if (!node) return;
  const range = document.createRange();
  range.selectNodeContents(node);
  const sel = document.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

// Reading is the stricter half: secure context AND a user gesture, and Safari
// puts its own "Paste" confirmation in front of it. null means "ask the user to
// paste by hand", which every browser can do into a textarea.
export const canRead = () => !!navigator.clipboard?.readText;

export async function readText() {
  if (!canRead()) return null;
  try { return await navigator.clipboard.readText(); } catch { return null; }
}
