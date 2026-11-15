import { mount } from "svelte";
import { startUpdates } from "./lib/updates.svelte.js";

// Registering a service worker makes the app installable and lets its static UI
// cold-start when the machine that originally served it is off. Live machine
// data remains network-only; see public/sw.js.
startUpdates();
import "./app.css";
// Imported for its side effect: arms the install listener before anything renders.
import "./lib/installable.svelte.js";
import App from "./App.svelte";

export default mount(App, { target: document.getElementById("app") });
