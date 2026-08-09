import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

export function configuredRelayOrigin(value) {
  const candidate = String(value ?? "").trim();
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    const isLocalHttp =
      url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost");
    return isLocalHttp ? url.origin : "";
  } catch {
    return "";
  }
}

const relayOrigin = configuredRelayOrigin(process.env.VITE_PROVIDER_RELAY_URL);
const relayConnectSource = relayOrigin ? ` ${relayOrigin}` : "";
const isolationHeaders = {
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Content-Security-Policy":
    `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'${relayConnectSource} https://ticker-line.com https://api.coingecko.com https://www.alphavantage.co https://gamma-api.polymarket.com https://*.webcontainer-api.io wss://*.webcontainer-api.io; frame-src https://stackblitz.com https://*.webcontainer-api.io; worker-src 'self' blob:; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
};
export default defineConfig(() => {
  const runtimeVersion = createHash("sha256")
    .update(readFileSync(resolve(import.meta.dirname, "public/runtime/runtime-files.json")))
    .update(readFileSync(resolve(import.meta.dirname, "public/runtime/runtime-bundle.mjs")))
    .update(readFileSync(resolve(import.meta.dirname, "public/runtime/sql-wasm.cjs")))
    .update(readFileSync(resolve(import.meta.dirname, "public/runtime/sql-wasm.wasm")))
    .digest("hex")
    .slice(0, 16);

  return {
    define: {
      __OPENCANDLE_RUNTIME_VERSION__: JSON.stringify(runtimeVersion),
    },
    server: { headers: isolationHeaders },
    preview: { headers: isolationHeaders },
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
  };
});
