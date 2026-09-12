import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// public/sw.js is copied verbatim, so without this stamp its bytes would not
// change when Vite emitted a new application bundle. Browsers would then keep
// the old worker and its old shell indefinitely. Derive the cache version from
// Vite's complete asset manifest and write it into the copied worker.
function stampServiceWorker() {
  return {
    name: "stamp-deskpilot-service-worker",
    apply: "build",
    async closeBundle() {
      const dist = fileURLToPath(new URL("./dist/", import.meta.url));
      const manifest = await readFile(`${dist}.vite/manifest.json`, "utf8");
      const path = `${dist}sw.js`;
      const worker = await readFile(path, "utf8");
      if (!worker.includes("__DESKPILOT_SHELL_VERSION__")) {
        throw new Error("service-worker cache version placeholder is missing");
      }
      const hash = createHash("sha256").update(manifest).update(worker);
      for (const file of [
        "index.html", "offline.html", "manifest.webmanifest", "icon.svg",
        "icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png",
      ]) hash.update(await readFile(`${dist}${file}`));
      const version = hash.digest("hex").slice(0, 12);
      await writeFile(path, worker.replace("__DESKPILOT_SHELL_VERSION__", version));
    },
  };
}

export default defineConfig({
  plugins: [svelte(), stampServiceWorker()],
  build: { outDir: "dist", emptyOutDir: true, manifest: true },
  // `npm run dev` proxies the API to the running service, so HMR over the LAN
  // edits against real sessions instead of mocks.
  server: {
    proxy: { "/api": "http://127.0.0.1:8790" },
  },
});
