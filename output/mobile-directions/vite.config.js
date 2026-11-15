import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { previewOrganization } from "./organization-preview.js";
import { readFile } from "node:fs/promises";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte(), previewOrganization(), {
    name: "final-review-spec",
    async generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "final-review/FINAL-SPEC.md",
        source: await readFile(
          new URL("./final-review/FINAL-SPEC.md", import.meta.url),
          "utf8",
        ),
      });
    },
  }],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        finalReview: fileURLToPath(
          new URL("./final-review/index.html", import.meta.url),
        ),
        finalApp: fileURLToPath(
          new URL("./final-review/app.html", import.meta.url),
        ),
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5178,
    strictPort: true,
    fs: { allow: [fileURLToPath(new URL("../../", import.meta.url))] },
  },
});
