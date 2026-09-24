import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCoverageMap } from "@vitest/istanbul-lib-coverage";
import { chromium } from "playwright-core";
import { build } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  filterProductionCoverage,
  mapScriptUrl,
  runBrowserCoverage,
} from "../../scripts/coverage-browser.mjs";
import { startBrowserCoverage, stopBrowserCoverage } from "../helpers/browser-coverage.js";

const tempRoots: string[] = [];

function makeTempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
  delete process.env.OPENCANDLE_BROWSER_COVERAGE;
  delete process.env.OPENCANDLE_BROWSER_COVERAGE_DIR;
});

function fileData(path: string) {
  return {
    path,
    statementMap: {
      0: { start: { line: 1, column: 0 }, end: { line: 1, column: 5 } },
    },
    fnMap: {},
    branchMap: {},
    s: { 0: 1 },
    f: {},
    b: {},
  };
}

describe("browser coverage url mapping", () => {
  it("maps only same-origin /assets/*.js to the built dist asset", () => {
    const options = { origin: "http://127.0.0.1:14567", distDir: "/repo/gui/web/dist" };
    expect(mapScriptUrl("http://127.0.0.1:14567/assets/app-abc.js", options)).toBe(
      "/repo/gui/web/dist/assets/app-abc.js",
    );
    expect(mapScriptUrl("http://127.0.0.1:9999/assets/app.js", options)).toBeNull();
    expect(mapScriptUrl("http://127.0.0.1:14567/assets/app.css", options)).toBeNull();
    expect(mapScriptUrl("http://127.0.0.1:14567/other/app.js", options)).toBeNull();
    expect(mapScriptUrl("not a url", options)).toBeNull();
  });
});

describe("browser coverage production filter", () => {
  it("keeps only configured production surfaces and drops node_modules/generated/build output", () => {
    const filtered = filterProductionCoverage(
      {
        "/repo/gui/web/src/App.jsx": fileData("/repo/gui/web/src/App.jsx"),
        "/repo/node_modules/pkg/index.js": fileData("/repo/node_modules/pkg/index.js"),
        "/repo/gui/web/dist/assets/app.js": fileData("/repo/gui/web/dist/assets/app.js"),
        "/repo/website/src/page.ts": fileData("/repo/website/src/page.ts"),
      },
      { repoRoot: "/repo" },
    );
    expect(Object.keys(filtered)).toEqual(["/repo/gui/web/src/App.jsx"]);
  });
});

describe("browser coverage helper gating", () => {
  it("no-ops start/stop when OPENCANDLE_BROWSER_COVERAGE is not 1", async () => {
    const startJSCoverage = vi.fn().mockResolvedValue(undefined);
    const stopJSCoverage = vi.fn().mockResolvedValue([]);
    await startBrowserCoverage({ coverage: { startJSCoverage } } as never);
    const result = await stopBrowserCoverage(
      { coverage: { stopJSCoverage }, url: () => "http://127.0.0.1:1/" } as never,
      "noop",
    );
    expect(startJSCoverage).not.toHaveBeenCalled();
    expect(stopJSCoverage).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("records browser version, user agent, and origin in the raw capture when enabled", async () => {
    const rawDir = join(makeTempRoot("opencandle-browser-provenance-"), "raw");
    process.env.OPENCANDLE_BROWSER_COVERAGE = "1";
    process.env.OPENCANDLE_BROWSER_COVERAGE_DIR = rawDir;
    const stopJSCoverage = vi
      .fn()
      .mockResolvedValue([
        { url: "http://127.0.0.1:1/assets/a.js", source: "globalThis.x = 1;", functions: [] },
      ]);
    const page = {
      coverage: { stopJSCoverage },
      url: () => "http://127.0.0.1:1/",
      context: () => ({ browser: () => ({ version: () => "153.0.8010.53" }) }),
      evaluate: () => Promise.resolve("Mozilla/5.0 (provenance)"),
    };

    const file = await stopBrowserCoverage(page as never, "provenance");
    const raw = JSON.parse(readFileSync(file as string, "utf8"));
    expect(raw.origin).toBe("http://127.0.0.1:1");
    expect(raw.browserVersion).toBe("153.0.8010.53");
    expect(raw.userAgent).toBe("Mozilla/5.0 (provenance)");
  });
});

describe("browser coverage lane failures", () => {
  it("fails when there are no raw captures", async () => {
    const repo = makeTempRoot("opencandle-browser-none-");
    await expect(
      runBrowserCoverage({
        rawDir: join(repo, "coverage/browser/raw"),
        distDir: join(repo, "gui/web/dist"),
        outDir: join(repo, "coverage/browser"),
        repoRoot: repo,
      }),
    ).rejects.toThrow(/no raw/i);
  });

  it("fails when a captured asset has no local source map", async () => {
    const repo = makeTempRoot("opencandle-browser-nomap-");
    const rawDir = join(repo, "coverage/browser/raw");
    mkdirSync(join(repo, "gui/web/dist/assets"), { recursive: true });
    writeFileSync(join(repo, "gui/web/dist/assets/app.js"), "globalThis.x = 1;\n");
    mkdirSync(rawDir, { recursive: true });
    writeFileSync(
      join(rawDir, "capture.json"),
      JSON.stringify({
        origin: "http://127.0.0.1:14567",
        entries: [
          {
            url: "http://127.0.0.1:14567/assets/app.js",
            source: "globalThis.x = 1;\n",
            functions: [],
          },
        ],
      }),
    );
    await expect(
      runBrowserCoverage({
        rawDir,
        distDir: join(repo, "gui/web/dist"),
        outDir: join(repo, "coverage/browser"),
        repoRoot: repo,
      }),
    ).rejects.toThrow(/source map/i);
  });

  it("fails when the captured script source differs from the local built asset", async () => {
    const repo = makeTempRoot("opencandle-browser-mismatch-");
    const rawDir = join(repo, "coverage/browser/raw");
    mkdirSync(join(repo, "gui/web/dist/assets"), { recursive: true });
    writeFileSync(join(repo, "gui/web/dist/assets/app.js"), "globalThis.x = 1;\n");
    mkdirSync(rawDir, { recursive: true });
    writeFileSync(
      join(rawDir, "capture.json"),
      JSON.stringify({
        origin: "http://127.0.0.1:14567",
        entries: [
          {
            url: "http://127.0.0.1:14567/assets/app.js",
            source: "globalThis.x = 2;\n",
            functions: [],
          },
        ],
      }),
    );
    await expect(
      runBrowserCoverage({
        rawDir,
        distDir: join(repo, "gui/web/dist"),
        outDir: join(repo, "coverage/browser"),
        repoRoot: repo,
      }),
    ).rejects.toThrow(/does not match/i);
  });

  it("fails when a captured asset is missing from the local build", async () => {
    const repo = makeTempRoot("opencandle-browser-missing-asset-");
    const rawDir = join(repo, "coverage/browser/raw");
    mkdirSync(rawDir, { recursive: true });
    writeFileSync(
      join(rawDir, "capture.json"),
      JSON.stringify({
        origin: "http://127.0.0.1:14567",
        entries: [
          {
            url: "http://127.0.0.1:14567/assets/gone.js",
            source: "globalThis.x = 1;\n",
            functions: [],
          },
        ],
      }),
    );
    await expect(
      runBrowserCoverage({
        rawDir,
        distDir: join(repo, "gui/web/dist"),
        outDir: join(repo, "coverage/browser"),
        repoRoot: repo,
      }),
    ).rejects.toThrow(/local build/i);
  });
});

function chromiumExecutable(): string | null {
  const bundled = chromium.executablePath();
  if (existsSync(bundled)) {
    return bundled;
  }
  const macChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  return existsSync(macChrome) ? macChrome : null;
}

const executable = chromiumExecutable();

async function buildFixture(repoRoot: string): Promise<{ dist: string; source: string }> {
  const source = join(repoRoot, "gui/web/src/fixture.js");
  const dist = join(repoRoot, "gui/web/dist");
  mkdirSync(join(repoRoot, "gui/web/src"), { recursive: true });
  writeFileSync(
    source,
    [
      "export function pick(flag) {",
      "  if (flag) {",
      '    return "taken";',
      "  }",
      '  return "not-taken";',
      "}",
      "globalThis.__result = pick(true);",
      "",
    ].join("\n"),
  );
  await build({
    root: repoRoot,
    logLevel: "error",
    build: {
      outDir: dist,
      emptyOutDir: true,
      sourcemap: true,
      minify: false,
      rollupOptions: {
        input: source,
        output: { entryFileNames: "assets/[name].js", format: "es" },
      },
    },
  });
  return { dist, source };
}

async function serveDist(dist: string) {
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (pathname === "/") {
      response.setHeader("content-type", "text/html");
      response.end(
        '<!doctype html><html><body><script type="module" src="/assets/fixture.js"></script></body></html>',
      );
      return;
    }
    const file = join(dist, pathname);
    if (existsSync(file)) {
      response.setHeader(
        "content-type",
        pathname.endsWith(".js") ? "text/javascript" : "application/json",
      );
      response.end(readFileSync(file));
      return;
    }
    response.statusCode = 404;
    response.end("missing");
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const { port } = server.address() as AddressInfo;
  return { origin: `http://127.0.0.1:${port}`, close: () => server.close() };
}

describe.skipIf(!executable)("browser coverage real-Chromium fixture", () => {
  it("maps built asset V8 coverage back to original source line identity and hits", async () => {
    const repo = makeTempRoot("opencandle-browser-");
    const { dist } = await buildFixture(repo);
    const server = await serveDist(dist);
    const rawDir = join(repo, "coverage/browser/raw");
    const outDir = join(repo, "coverage/browser");
    process.env.OPENCANDLE_BROWSER_COVERAGE = "1";
    process.env.OPENCANDLE_BROWSER_COVERAGE_DIR = rawDir;

    const browser = await chromium.launch({
      executablePath: executable ?? undefined,
      headless: true,
    });
    try {
      const page = await browser.newPage();
      await startBrowserCoverage(page);
      await page.goto(server.origin, { waitUntil: "load" });
      await page.waitForFunction(() => (globalThis as { __result?: string }).__result === "taken");
      const rawFile = await stopBrowserCoverage(page, "fixture");
      expect(rawFile && existsSync(rawFile)).toBe(true);
      await page.close();

      const stats = await runBrowserCoverage({
        rawDir,
        distDir: dist,
        outDir,
        repoRoot: repo,
        origin: server.origin,
      });
      expect(stats.mappedScripts).toBeGreaterThan(0);
      expect(stats.productionFiles).toBeGreaterThan(0);
      expect(existsSync(join(outDir, "coverage-summary.json"))).toBe(true);
      expect(existsSync(join(outDir, "lcov.info"))).toBe(true);

      const metadata = JSON.parse(readFileSync(join(outDir, "metadata.json"), "utf8"));
      expect(metadata.runtime.node).toBe(process.versions.node);
      expect(metadata.runtime.v8).toBe(process.versions.v8);
      expect(
        metadata.build.assets.some((asset: { file: string }) =>
          asset.file.endsWith("assets/fixture.js"),
        ),
      ).toBe(true);
      expect(metadata.build.assets[0].sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(metadata.browser.versions.length).toBeGreaterThan(0);

      const merged = createCoverageMap(
        JSON.parse(readFileSync(join(outDir, "coverage-final.json"), "utf8")),
      );
      const key = merged.files().find((file) => file.endsWith("gui/web/src/fixture.js"));
      expect(key, "original source must be the coverage key").toBeTruthy();
      const lines = merged.fileCoverageFor(key as string).getLineCoverage();
      // Original source: line 3 is the taken branch, line 5 the untaken return.
      expect(lines[3], "executed branch line").toBeGreaterThan(0);
      expect(lines[5], "unexecuted branch line").toBe(0);

      // A repo root that cannot own the mapped source yields no production entries.
      await expect(
        runBrowserCoverage({
          rawDir,
          distDir: dist,
          outDir,
          repoRoot: join(repo, "elsewhere"),
          origin: server.origin,
        }),
      ).rejects.toThrow(/no instrumented production/i);
    } finally {
      await browser.close();
      server.close();
    }
  }, 120_000);
});
