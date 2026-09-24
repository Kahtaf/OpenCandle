#!/usr/bin/env node
// Optional built-browser coverage lane.
//
// Raw V8 JS coverage collected by tests/helpers/browser-coverage.ts is remapped
// from the built Vite assets (with their local source maps) back to original
// production sources, then reported per-lane under coverage/browser/. The
// Node/relay denominator is never shrunk: scripts/coverage-merge.mjs can
// optionally add these raw hits over that map with --browser.
//
// Usage:
//   node scripts/coverage-browser.mjs [--raw <dir>] [--dist <dir>] [--out <dir>] [--repo-root <path>] [--origin <url>]

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createCoverageMap } from "@vitest/istanbul-lib-coverage";
import { create, createContext } from "@vitest/istanbul-lib-report";
import { convert } from "ast-v8-to-istanbul";
import { parseAstAsync } from "vite";

import { isExcluded, surfaceForPath, toPosix } from "./coverage-report.mjs";

export const DEFAULT_RAW_DIR = join("coverage", "browser", "raw");
export const DEFAULT_DIST_DIR = join("gui", "web", "dist");
export const DEFAULT_OUT_DIR = join("coverage", "browser");

/**
 * Map a script URL to its built asset path only when it is same-origin and a
 * compiled `/assets/*.js` chunk. Anything else (CSS, other origins, vendor
 * URLs) is not a built GUI asset and is ignored.
 */
export function mapScriptUrl(scriptUrl, { origin, distDir }) {
  if (typeof scriptUrl !== "string" || typeof origin !== "string") {
    return null;
  }
  let parsed;
  try {
    parsed = new URL(scriptUrl);
  } catch {
    return null;
  }
  if (parsed.origin !== origin) {
    return null;
  }
  if (!parsed.pathname.startsWith("/assets/") || !parsed.pathname.endsWith(".js")) {
    return null;
  }
  return resolve(distDir, parsed.pathname.slice(1));
}

// macOS tmpdirs are /var symlinks to /private/var, and source-map sources can
// resolve through either, so canonicalize before path comparison.
function canonicalPath(path) {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
}

/** Keep only configured production sources; drop node_modules/generated/build. */
export function filterProductionCoverage(mapData, { repoRoot = process.cwd() } = {}) {
  const root = canonicalPath(repoRoot);
  const filtered = {};
  for (const [path, file] of Object.entries(mapData)) {
    const rel = toPosix(relative(root, canonicalPath(path)));
    if (rel.startsWith("..") || isAbsolute(rel) || isExcluded(rel) || !surfaceForPath(rel)) {
      continue;
    }
    filtered[path] = file;
  }
  return filtered;
}

function loadRawCaptures(rawDir) {
  if (!existsSync(rawDir)) {
    return [];
  }
  return readdirSync(rawDir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const file = join(rawDir, name);
      let raw;
      try {
        raw = JSON.parse(readFileSync(file, "utf8"));
      } catch (error) {
        throw new Error(`raw browser capture is not valid JSON: ${file} (${error.message})`);
      }
      if (!raw || !Array.isArray(raw.entries)) {
        throw new Error(`raw browser capture has no entries: ${file}`);
      }
      return {
        file,
        origin: typeof raw.origin === "string" ? raw.origin : null,
        browserVersion: typeof raw.browserVersion === "string" ? raw.browserVersion : null,
        userAgent: typeof raw.userAgent === "string" ? raw.userAgent : null,
        entries: raw.entries,
      };
    });
}

/** Read the installed versions of the tools that produced this lane. */
function readToolVersions(repoRoot) {
  const packages = {
    vitest: "vitest",
    "@vitest/coverage-v8": "@vitest/coverage-v8",
    "ast-v8-to-istanbul": "ast-v8-to-istanbul",
    "@vitest/istanbul-lib-coverage": "@vitest/istanbul-lib-coverage",
    "@vitest/istanbul-lib-report": "@vitest/istanbul-lib-report",
    vite: "vite",
    "playwright-core": "playwright-core",
  };
  const versions = {};
  for (const [name, dir] of Object.entries(packages)) {
    const file = join(repoRoot, "node_modules", dir, "package.json");
    if (existsSync(file)) {
      versions[name] = JSON.parse(readFileSync(file, "utf8")).version;
    }
  }
  return versions;
}

async function remapEntry(entry, { origin, distDir, repoRoot }) {
  if (!entry || typeof entry.url !== "string" || !Array.isArray(entry.functions)) {
    return null; // not a script with coverage, so not part of this lane
  }
  const builtPath = mapScriptUrl(entry.url, { origin, distDir });
  if (!builtPath) {
    return null; // same-origin asset chunk only; other scripts are out of scope
  }
  if (!existsSync(builtPath)) {
    throw new Error(`captured asset is missing from the local build: ${builtPath}`);
  }
  const localCode = readFileSync(builtPath, "utf8");
  if (typeof entry.source !== "string" || entry.source.length === 0) {
    throw new Error(`captured asset has no source: ${entry.url}`);
  }
  if (entry.source !== localCode) {
    throw new Error(`captured source does not match the local built asset: ${builtPath}`);
  }
  const mapPath = `${builtPath}.map`;
  if (!existsSync(mapPath)) {
    throw new Error(`captured asset has no local source map: ${mapPath}`);
  }
  const sourceMap = JSON.parse(readFileSync(mapPath, "utf8"));
  const ast = await parseAstAsync(localCode);
  const converted = await convert({
    code: localCode,
    ast,
    coverage: { functions: entry.functions, url: pathToFileURL(builtPath).href },
    sourceMap,
  });
  return { builtPath, map: createCoverageMap(filterProductionCoverage(converted, { repoRoot })) };
}

/** Remap all raw captures and write the browser lane's raw+summary+lcov reports. */
export async function runBrowserCoverage({
  rawDir = DEFAULT_RAW_DIR,
  distDir = DEFAULT_DIST_DIR,
  outDir = DEFAULT_OUT_DIR,
  repoRoot = process.cwd(),
  origin: requestedOrigin = null,
} = {}) {
  const root = canonicalPath(repoRoot);
  const rawAbs = isAbsolute(rawDir) ? rawDir : resolve(root, rawDir);
  const distAbs = isAbsolute(distDir) ? distDir : resolve(root, distDir);
  const outAbs = isAbsolute(outDir) ? outDir : resolve(root, outDir);

  const captures = loadRawCaptures(rawAbs);
  if (captures.length === 0) {
    throw new Error(`no raw browser coverage captures in ${rawAbs}`);
  }

  const merged = createCoverageMap({});
  const mappedAssets = new Set();
  let mappedScripts = 0;
  let skippedScripts = 0;
  for (const capture of captures) {
    const origin = capture.origin ?? requestedOrigin;
    if (!origin) {
      throw new Error(`raw browser capture has no origin: ${capture.file}`);
    }
    for (const entry of capture.entries) {
      const remapped = await remapEntry(entry, { origin, distDir: distAbs, repoRoot: root });
      if (!remapped) {
        skippedScripts += 1;
        continue;
      }
      mappedScripts += 1;
      mappedAssets.add(remapped.builtPath);
      merged.merge(remapped.map);
    }
  }
  if (mappedScripts === 0) {
    throw new Error(`no built assets with a local source map under ${distAbs}`);
  }
  const productionFiles = merged.files().length;
  if (productionFiles === 0) {
    throw new Error("no instrumented production entries after source-map remapping");
  }

  mkdirSync(outAbs, { recursive: true });
  writeFileSync(
    join(outAbs, "coverage-final.json"),
    `${JSON.stringify(merged.toJSON())}\n`,
    "utf8",
  );
  const context = createContext({ coverageMap: merged, dir: outAbs });
  create("json-summary", { file: "coverage-summary.json" }).execute(context);
  create("lcov", { file: "lcov.info", projectRoot: root }).execute(context);

  // Provenance for the browser report: runtime, toolchain, browser, and the
  // exact built assets (with hashes) that the source maps remapped.
  const metadata = {
    generatedAt: new Date().toISOString(),
    runtime: {
      node: process.versions.node,
      v8: process.versions.v8,
      platform: process.platform,
      arch: process.arch,
    },
    browser: {
      versions: [...new Set(captures.map((capture) => capture.browserVersion).filter(Boolean))],
      userAgents: [...new Set(captures.map((capture) => capture.userAgent).filter(Boolean))],
    },
    tools: readToolVersions(root),
    build: {
      distDir: toPosix(relative(root, distAbs)),
      assets: [...mappedAssets].sort().map((assetPath) => ({
        file: toPosix(relative(root, assetPath)),
        sha256: createHash("sha256").update(readFileSync(assetPath)).digest("hex"),
      })),
    },
    lane: { captures: captures.length, mappedScripts, skippedScripts, productionFiles },
  };
  writeFileSync(join(outAbs, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

  return {
    captures: captures.length,
    mappedScripts,
    skippedScripts,
    productionFiles,
    metadata,
    totals: merged.getCoverageSummary().toJSON(),
  };
}

/** Parse command-line options for the browser lane CLI. */
export function parseArgs(argv) {
  const options = {
    rawDir: DEFAULT_RAW_DIR,
    distDir: DEFAULT_DIST_DIR,
    outDir: DEFAULT_OUT_DIR,
    repoRoot: process.cwd(),
    origin: null,
  };
  const next = () => {
    index += 1;
    return argv[index];
  };
  let index = 0;
  while (index < argv.length) {
    switch (argv[index]) {
      case "--raw":
        options.rawDir = next();
        break;
      case "--dist":
        options.distDir = next();
        break;
      case "--out":
        options.outDir = next();
        break;
      case "--repo-root":
        options.repoRoot = next();
        break;
      case "--origin":
        options.origin = next();
        break;
      default:
        throw new Error(`unknown option: ${argv[index]}`);
    }
    index += 1;
  }
  return options;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
  try {
    const stats = await runBrowserCoverage(options);
    console.log(
      `browser coverage: ${stats.mappedScripts} mapped script(s), ${stats.skippedScripts} out-of-scope script(s), ` +
        `${stats.productionFiles} production file(s); lines ${stats.totals.lines.covered}/${stats.totals.lines.total}`,
    );
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}

const invokedPath = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;
if (invokedPath || process.argv[1]?.endsWith("coverage-browser.mjs")) {
  await main();
}
