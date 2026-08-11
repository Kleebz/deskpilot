// Whether the page is actually being looked at.
//
// Mobile browsers suspend or heavily throttle timers when a tab is backgrounded
// or the screen turns off. Without this, coming back to the app shows whatever
// was true when you left — which after unlocking your desktop from the phone
// means it still claims to be locked until you reload by hand.
//
// Two jobs: stop polling while nobody is looking (battery, cellular data), and
// refresh immediately when they look again.

export const vis = $state({
  visible: !document.hidden,
  wokeAt: Date.now(),
  // bumped whenever the usable height changes, so panes can re-pin their scroll
  resizedAt: 0,
});

function update() {
  const now = !document.hidden;
  if (now && !vis.visible) vis.wokeAt = Date.now();  // changing this re-triggers effects
  vis.visible = now;
}

document.addEventListener("visibilitychange", update);
// iOS in particular does not always fire visibilitychange when returning from
// the app switcher; focus and pageshow cover the gaps.
window.addEventListener("focus", update);
window.addEventListener("pageshow", update);

// --- soft keyboard ----------------------------------------------------------
//
// `interactive-widget=resizes-content` in the viewport meta makes Android
// shrink the layout when the keyboard opens, which keeps the composer on
// screen. iOS Safari ignores it and slides the visual viewport over the page
// instead, so the composer ends up underneath and the page has to be scrolled.
//
// Publishing the visual viewport height as a CSS variable covers both: the
// rail sizes to what is actually visible rather than to the whole window.
let lastH = 0;
function syncViewport() {
  const vv = window.visualViewport;
  const h = Math.round(vv ? vv.height : window.innerHeight);
  document.documentElement.style.setProperty("--app-h", `${h}px`);
  if (h !== lastH) { lastH = h; vis.resizedAt = performance.now(); }
  // iOS also scrolls the page itself when focusing an input near the bottom;
  // undo that so the header does not slide away.
  if (vv && window.scrollY !== 0) window.scrollTo(0, 0);
}

if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", syncViewport);
  window.visualViewport.addEventListener("scroll", syncViewport);
}
// visualViewport does not fire in every case that changes the usable height —
// notably when the window itself resizes. Listening to both is the difference
// between the variable tracking reality and being set once at load.
window.addEventListener("resize", syncViewport);

// Belt and braces: events are not guaranteed. visualViewport can update its
// height without dispatching, and window.resize does not fire in every
// embedding. Observing the document element catches the layout change itself,
// which is what `interactive-widget=resizes-content` actually produces.
if (typeof ResizeObserver !== "undefined") {
  new ResizeObserver(syncViewport).observe(document.documentElement);
}
window.addEventListener("orientationchange", () => setTimeout(syncViewport, 150));
syncViewport();
