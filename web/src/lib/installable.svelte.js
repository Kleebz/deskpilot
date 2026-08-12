// beforeinstallprompt fires once, early in page load, and is gone if nothing
// is listening. Arming it inside a component was a bug: Install.svelte lives
// under the token gate, so on a fresh origin the event fired while the app was
// still asking for a token and was lost for the rest of the session.
//
// This module is imported from main.js, so the listener exists before anything
// renders.

export const installable = $state({
  prompt: null,      // the deferred event, if the browser offered one
  installed: false,
  standalone: matchMedia("(display-mode: standalone)").matches ||
              window.navigator.standalone === true,
});

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installable.prompt = e;
});

window.addEventListener("appinstalled", () => {
  installable.installed = true;
  installable.prompt = null;
});

matchMedia("(display-mode: standalone)").addEventListener?.("change", (e) => {
  installable.standalone = e.matches;
});

export async function doInstall() {
  const e = installable.prompt;
  if (!e) return false;
  e.prompt();
  const { outcome } = await e.userChoice;
  installable.prompt = null;
  if (outcome === "accepted") installable.installed = true;
  return outcome === "accepted";
}
