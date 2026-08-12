import { mount } from "svelte";

// Registering a service worker is what makes the app installable — Chrome will
// not offer to install without one that has a fetch handler. It caches nothing;
// see public/sw.js.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Not fatal: everything works, the app just cannot be installed.
    });
  });
}
import "./app.css";
// Imported for its side effect: arms the install listener before anything renders.
import "./lib/installable.svelte.js";
import App from "./App.svelte";

export default mount(App, { target: document.getElementById("app") });
