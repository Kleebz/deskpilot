import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte()],
  build: { outDir: "dist", emptyOutDir: true },
  // `npm run dev` proxies the API to the running service, so HMR over the LAN
  // edits against real sessions instead of mocks.
  server: {
    proxy: { "/api": "http://127.0.0.1:8790" },
  },
});
