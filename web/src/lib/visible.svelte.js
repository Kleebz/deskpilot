// Whether the page is actually being looked at.
//
// Mobile browsers suspend or heavily throttle timers when a tab is backgrounded
// or the screen turns off. Without this, coming back to the app shows whatever
// was true when you left — which after unlocking your desktop from the phone
// means it still claims to be locked until you reload by hand.
//
// Two jobs: stop polling while nobody is looking (battery, cellular data), and
// refresh immediately when they look again.

export const vis = $state({ visible: !document.hidden, wokeAt: Date.now() });

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
