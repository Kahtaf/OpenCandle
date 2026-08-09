import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import hostedViteConfig, { configuredRelayOrigin } from "../../../gui/hosted/vite.config.js";

const root = resolve(import.meta.dirname, "../../..");

describe("hosted PWA assets", () => {
  it("deploys as a private-preview SPA so direct application routes load the shell", () => {
    const wrangler = JSON.parse(readFileSync(resolve(root, "gui/hosted/wrangler.jsonc"), "utf8"));
    expect(wrangler).toMatchObject({
      name: "opencandle-web",
      workers_dev: false,
      preview_urls: false,
      assets: {
        directory: "./dist",
        not_found_handling: "single-page-application",
      },
    });
  });

  it("defers generated runtime asset reads until Vite invokes the config", () => {
    expect(hostedViteConfig).toBeTypeOf("function");
  });

  it("keeps production relay traffic same-origin and admits only loopback development origins", () => {
    expect(configuredRelayOrigin("https://web.opencandle.app/v1/provider-fetch")).toBe("");
    expect(configuredRelayOrigin("http://127.0.0.1:8787/v1/provider-fetch")).toBe(
      "http://127.0.0.1:8787",
    );
    expect(configuredRelayOrigin("javascript:alert(1)")).toBe("");
    expect(configuredRelayOrigin("ftp://localhost/v1/provider-fetch")).toBe("");
    expect(configuredRelayOrigin("https://relay.example/v1/provider-fetch")).toBe("");
    expect(configuredRelayOrigin("not a URL")).toBe("");
  });

  it("declares an installable standalone application with required icons", () => {
    const manifest = JSON.parse(
      readFileSync(resolve(root, "gui/hosted/public/manifest.webmanifest"), "utf8"),
    );
    expect(manifest).toMatchObject({
      name: "OpenCandle",
      id: "/",
      start_url: "/",
      scope: "/",
      display: "standalone",
    });
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sizes: "192x192", type: "image/png" }),
        expect.objectContaining({ sizes: "512x512", type: "image/png" }),
      ]),
    );
  });

  it("keeps runtime, provider, and mutable data out of the shell cache", () => {
    const worker = readFileSync(resolve(root, "gui/hosted/public/sw.js"), "utf8");
    expect(worker).toContain('event.data?.type === "ACTIVATE_UPDATE"');
    expect(worker).toContain('url.pathname.startsWith("/runtime/")');
    const installHandler = worker.split('self.addEventListener("message"')[0];
    expect(installHandler).not.toContain("skipWaiting");
    expect(worker).not.toMatch(/\/gui|\/probe|credential|state\.sqlite|checkpoint-v1/);
  });

  it("lets the active worker repopulate the offline shell after device data is cleared", () => {
    const worker = readFileSync(resolve(root, "gui/hosted/public/sw.js"), "utf8");
    const messageHandler = worker
      .split('self.addEventListener("message"')[1]
      ?.split('self.addEventListener("activate"')[0];

    expect(messageHandler).toContain('event.data?.type === "REPOPULATE_SHELL"');
    expect(messageHandler).toContain("event.waitUntil");
    expect(messageHandler).toContain("cache.addAll(PRECACHE)");
    expect(messageHandler).toContain("event.ports[0]");
  });

  it("ships the cross-origin isolation and cache headers required by WebContainer", () => {
    const headers = readFileSync(resolve(root, "gui/hosted/public/_headers"), "utf8");
    const viteConfig = readFileSync(resolve(root, "gui/hosted/vite.config.js"), "utf8");
    expect(headers).toContain("Cross-Origin-Embedder-Policy: require-corp");
    expect(headers).toContain("Cross-Origin-Opener-Policy: same-origin");
    expect(headers).toContain("Content-Security-Policy:");
    expect(headers).toContain("default-src 'self'");
    expect(headers).toContain("'wasm-unsafe-eval'");
    expect(headers).not.toContain("script-src 'self' 'unsafe-eval'");
    expect(headers).not.toContain("challenges.cloudflare.com");
    expect(viteConfig).not.toContain("challenges.cloudflare.com");
    expect(headers).toMatch(
      /frame-src https:\/\/stackblitz\.com https:\/\/\*\.webcontainer-api\.io/,
    );
    expect(headers).toContain("connect-src 'self'");
    expect(headers).toContain("https://api.coingecko.com");
    expect(headers).toContain("https://www.alphavantage.co");
    expect(headers).toContain("https://gamma-api.polymarket.com");
    expect(headers).toMatch(/connect-src[^;]*https:\/\/ticker-line\.com/);
    expect(viteConfig).toMatch(/connect-src[^;]*https:\/\/ticker-line\.com/);
    expect(headers).toContain("https://*.webcontainer-api.io");
    expect(headers).toContain("object-src 'none'");
    expect(headers).toContain("frame-ancestors 'none'");
    expect(headers).toContain("Referrer-Policy: strict-origin-when-cross-origin");
    expect(headers).not.toContain("Referrer-Policy: no-referrer");
    expect(headers).toContain("/runtime/*");
    expect(headers).toContain("Cache-Control: public, max-age=31536000, immutable");
  });

  it("sends only the hosted origin when WebContainer authorizes its iframe", () => {
    const html = readFileSync(resolve(root, "gui/hosted/index.html"), "utf8");
    expect(html).toContain('<meta name="referrer" content="strict-origin-when-cross-origin" />');
  });

  it("versions the shell cache from asset contents and excludes host configuration", () => {
    const buildScript = readFileSync(
      resolve(root, "gui/hosted/scripts/build-service-worker.mjs"),
      "utf8",
    );
    expect(buildScript).toContain("await readFile(path)");
    expect(buildScript).toContain('path !== "/_headers"');
  });

  it("tears down the in-browser runtime when the document is replaced", () => {
    const entry = readFileSync(resolve(root, "gui/hosted/src/main.jsx"), "utf8");
    expect(entry).toContain('addEventListener("pagehide"');
    expect(entry).toContain("if (!event.persisted)");
    expect(entry).toContain("host.dispose()");
  });

  it("does not reload when the service worker first claims an uncontrolled page", () => {
    const entry = readFileSync(resolve(root, "gui/hosted/src/main.jsx"), "utf8");
    expect(entry).toContain("Boolean(navigator.serviceWorker.controller)");
    expect(entry).toContain("if (!reloadForUpdate)");
  });

  it("loads the WebContainer engine only when the hosted runtime boots", () => {
    const host = readFileSync(
      resolve(root, "gui/hosted/src/runtime/browser-runtime-host.js"),
      "utf8",
    );
    expect(host).not.toContain('import { WebContainer } from "@webcontainer/api"');
    expect(host).toContain('await import("@webcontainer/api")');
  });

  it("installs the relay transport only inside the hosted runtime", () => {
    const server = readFileSync(resolve(root, "gui/hosted/runtime/server.ts"), "utf8");
    expect(server).toContain("globalThis.fetch = createHostedProviderFetch");
    expect(server).toContain("createHostedRelayManifestLoader");
    expect(server).toContain("relayUrl: providerRelayUrl");
    expect(server).toContain("OPENCANDLE_PROVIDER_RELAY_URL");
    const localServer = readFileSync(resolve(root, "gui/server/server.ts"), "utf8");
    expect(localServer).not.toContain("createHostedProviderFetch");
    expect(localServer).not.toContain("OPENCANDLE_PROVIDER_RELAY_URL");
  });

  it("proves Yahoo quote and history through the relay in the hosted browser smoke", () => {
    const smoke = readFileSync(resolve(root, "gui/hosted/tests/hosted-pwa.e2e.mjs"), "utf8");
    expect(smoke).toContain("OPENCANDLE_PROVIDER_RELAY_E2E");
    expect(smoke).toContain("get_stock_quote");
    expect(smoke).toContain("get_stock_history");
    expect(smoke).toContain('waitForText(page, "Stock quote"');
    expect(smoke).toContain('waitForText(page, "Price history"');
    expect(smoke).toContain('waitForText(restored, "Stock quote"');
    expect(smoke).toContain('waitForText(restored, "Price history"');
  });

  it("ships only the production stdio GUI protocol in the browser runtime", () => {
    const server = readFileSync(resolve(root, "gui/hosted/runtime/server.ts"), "utf8");
    expect(server).not.toContain("createServer");
    expect(server).not.toContain('operation === "health"');
    expect(server).not.toContain('operation === "probe"');
    expect(server).not.toContain('operation === "session"');
    expect(server).toContain('operation === "gui"');
    expect(server).toContain('operation === "gui-stream"');
    expect(server).toContain("Chat runs require the streaming hosted GUI operation");
    expect(server).toMatch(
      /operation === "gui-stream"[\s\S]+refreshHostedRelayProviders\(runtime\)[\s\S]+runtime\.chatRun/,
    );
  });
});
