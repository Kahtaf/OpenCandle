import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const isolationHeaders = {
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://gamma-api.polymarket.com https://*.webcontainer-api.io wss://*.webcontainer-api.io; frame-src https://stackblitz.com https://*.webcontainer-api.io; worker-src 'self' blob:; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};
const runtimeVersion = createHash("sha256")
  .update(readFileSync(resolve(import.meta.dirname, "public/runtime/runtime-bundle.mjs")))
  .digest("hex")
  .slice(0, 16);

export default defineConfig({
  define: {
    __OPENCANDLE_RUNTIME_VERSION__: JSON.stringify(runtimeVersion),
  },
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
