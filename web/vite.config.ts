import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/** Emits dist/sw.js, stamped with a hash of the build's file names so each release gets a fresh app cache. */
function serviceWorker(): Plugin {
  return {
    name: "feedkeeper-service-worker",
    apply: "build",
    generateBundle(_options, bundle) {
      const hash = createHash("sha256");
      for (const name of Object.keys(bundle).sort()) hash.update(name);
      const source = readFileSync(fileURLToPath(new URL("./sw/sw.js", import.meta.url)), "utf8").replace("__BUILD_ID__", hash.digest("hex").slice(0, 12));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), serviceWorker()],
  build: {
    rolldownOptions: {
      output: {
        comments: { legal: true },
      },
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:3000",
      "/mcp": "http://localhost:3000",
      "/oauth": "http://localhost:3000",
      "/.well-known": "http://localhost:3000",
    },
  },
});
