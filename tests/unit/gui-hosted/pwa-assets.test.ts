import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");

describe("hosted PWA assets", () => {
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

  it("ships the cross-origin isolation and cache headers required by WebContainer", () => {
    const headers = readFileSync(resolve(root, "gui/hosted/public/_headers"), "utf8");
    expect(headers).toContain("Cross-Origin-Embedder-Policy: require-corp");
    expect(headers).toContain("Cross-Origin-Opener-Policy: same-origin");
    expect(headers).toContain("Content-Security-Policy:");
    expect(headers).toContain("default-src 'self'");
    expect(headers).toContain("'wasm-unsafe-eval'");
    expect(headers).not.toContain("script-src 'self' 'unsafe-eval'");
    expect(headers).toContain("connect-src 'self'");
    expect(headers).toContain("https://gamma-api.polymarket.com");
    expect(headers).toContain("https://*.webcontainer-api.io");
    expect(headers).toContain("object-src 'none'");
    expect(headers).toContain("frame-ancestors 'none'");
    expect(headers).toContain("/runtime/*");
    expect(headers).toContain("Cache-Control: public, max-age=31536000, immutable");
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

  it("marks diagnostic provider evidence as untrusted before model synthesis", () => {
    const server = readFileSync(resolve(root, "gui/hosted/runtime/server.ts"), "utf8");
    expect(server).toContain('untrustedContentHeader("Polymarket diagnostic evidence")');
    expect(server).toContain("renderUntrustedText(item.title");
    expect(server).toContain("renderUntrustedText(item.outcome");
  });
});
