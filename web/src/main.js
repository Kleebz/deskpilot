import { mount } from "svelte";

// Registering a service worker makes the app installable and lets its static UI
// cold-start when the machine that originally served it is off. Live machine
// data remains network-only; see public/sw.js.
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
