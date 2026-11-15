import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
const webRoot = fileURLToPath(new URL("./", import.meta.url));
const sourceHash = createHash("sha256");
function hashDirectory(path) {
  for (
    const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name)
    )
  ) {
    const file = resolve(path, entry.name);
    if (entry.isDirectory()) hashDirectory(file);
    else {sourceHash.update(file.slice(webRoot.length)).update(
        readFileSync(file),
      );}
  }
}
hashDirectory(resolve(webRoot, "src"));
hashDirectory(resolve(webRoot, "public"));
sourceHash.update(readFileSync(resolve(webRoot, "vite.config.js")));
const uiBuild = sourceHash.digest("hex").slice(0, 12);

// public/sw.js is copied verbatim, so without this stamp its bytes would not
// change when Vite emitted a new application bundle. Browsers would then keep
// the old worker and its old shell indefinitely. Derive the cache version from
// Vite's complete asset manifest and write it into the copied worker.
function stampServiceWorker() {
  let failed = false, dist = resolve(webRoot, "dist");
  return {
    configResolved(config) {
      dist = resolve(config.root, config.build.outDir);
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "ui-build.json",
        source: JSON.stringify({ build: uiBuild }),
      });
    },
    buildStart() {
      failed = false;
    },
    buildEnd(error) {
      failed = !!error;
    },
    name: "stamp-deskpilot-service-worker",
    apply: "build",
    async closeBundle() {
      if (failed) return;

      const manifest = await readFile(`${dist}/.vite/manifest.json`, "utf8");
      const path = `${dist}/sw.js`;
      const worker = await readFile(path, "utf8");
      if (!worker.includes("__DESKPILOT_SHELL_VERSION__")) {
        throw new Error("service-worker cache version placeholder is missing");
      }
      const hash = createHash("sha256").update(manifest).update(worker);
      for (
        const file of [
          "ui-build.json",
          "index.html",
          "offline.html",
          "manifest.webmanifest",
          "icon.svg",
          "icon-192.png",
          "icon-512.png",
          "icon-maskable-512.png",
          "apple-touch-icon.png",
        ]
      ) hash.update(await readFile(`${dist}/${file}`));
      const version = hash.digest("hex").slice(0, 12);
      await writeFile(
        path,
        worker.replace("__DESKPILOT_SHELL_VERSION__", version).replace(
          "__DESKPILOT_UI_BUILD__",
          uiBuild,
        ),
      );
    },
  };
}

export default defineConfig({
  plugins: [svelte(), stampServiceWorker()],
  define: { __DESKPILOT_UI_BUILD__: JSON.stringify(uiBuild) },
  build: { outDir: "dist", emptyOutDir: true, manifest: true },
  // `npm run dev` proxies the API to the running service, so HMR over the LAN
  // edits against real sessions instead of mocks.
  server: {
    proxy: { "/api": "http://127.0.0.1:8790" },
  },
});
