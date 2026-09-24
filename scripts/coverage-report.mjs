#!/usr/bin/env node
// Per-surface coverage report and baseline regression check.
//
// Vitest only collects coverage in the process that runs the tests. This
// script therefore reports the in-process (Node) unit run and labels every
// surface whose real execution route is a browser, a child process, or a
// WebContainer. Unmeasured surfaces are named, never silently folded into a
// zero percent that would read as a real gap.
//
// Usage:
//   node scripts/coverage-report.mjs                     # report + regression check
//   node scripts/coverage-report.mjs --check             # explicit same as above
//   node scripts/coverage-report.mjs --update-baseline   # measured baseline write (only path that writes)
//   node scripts/coverage-report.mjs --json              # also print machine-readable report
//
// Options: --coverage <path> --baseline <path> --repo-root <path> --tolerance <points>

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const BASELINE_SCHEMA_VERSION = 1;

// Ratio changes smaller than this percentage-point epsilon are treated as
// IEEE-754 division noise, never as a real change. It is deliberately tiny:
// this is an initial baseline gate, so any genuine coverage loss (even a
// hundredth of a point) must fail and require a reviewed baseline update.
export const DEFAULT_TOLERANCE_POINTS = 1e-6;

export const METRICS = ["lines", "functions", "branches", "statements"];

// Production surfaces are grouped by where the source actually lives. The
// `limitation` string is printed whenever a surface has no in-process
// execution, so a missing measurement can never be mistaken for full coverage.
export const SURFACES = [
  {
    id: "core",
    label: "Agent core (src/)",
    include: ["src/**"],
    limitation: null,
  },
  {
    id: "gui-server",
    label: "Local GUI server (gui/server/)",
    include: ["gui/server/**"],
    limitation: null,
  },
  {
    id: "gui-shared",
    label: "GUI shared contracts (gui/shared/)",
    include: ["gui/shared/**"],
    limitation: null,
  },
  {
    id: "gui-web",
    label: "Local GUI web app (gui/web/src/)",
    include: ["gui/web/src/**"],
    // Measured only from actual hits: the in-process Node run executes part of
    // this surface and the merged browser lane (scripts/coverage-browser.mjs)
    // augments it; some runtime paths stay an explicit gap even when merged.
    limitation:
      "browser runtime; partially executed by the in-process Node run, augmented by the browser lane when merged",
  },
  {
    id: "gui-hosted",
    label: "Hosted GUI + browser runtime (gui/hosted/src, gui/hosted/runtime/)",
    include: ["gui/hosted/src/**", "gui/hosted/runtime/**"],
    limitation:
      "browser/WebContainer runtime; in-process tests plus the browser lane when merged measure only a subset",
  },
  {
    id: "ui-package",
    label: "Shared UI package (packages/ui/src/)",
    include: ["packages/ui/src/**"],
    limitation:
      "React components; partially executed by the in-process Node run and augmented by the browser lane when merged",
  },
  {
    id: "provider-relay",
    label: "Provider relay worker (workers/provider-relay/src/)",
    include: ["workers/provider-relay/src/**"],
    // Measured: the relay workspace lane is merged into this report by
    // scripts/coverage-merge.mjs, so it is no longer a measurement gap.
    limitation: null,
  },
];

// Generated declarations and build artifacts are excluded with a reason. These
// are not code a contributor edits, so measuring them would only change the
// denominator. Difficult-but-real code is never excluded.
export const EXCLUSIONS = [
  {
    id: "generated-declarations",
    match: (path) => path.endsWith(".d.ts"),
    reason: "generated TypeScript declaration, not handwritten source",
  },
  {
    id: "generated-source",
    match: (path) => /\.generated\.[cm]?[jt]sx?$/.test(path),
    reason: "generated source produced by a build/generation step",
  },
  {
    id: "worker-config",
    match: (path) => path.endsWith("worker-configuration.d.ts"),
    reason: "generated Cloudflare worker environment declaration",
  },
  {
    id: "vendored",
    match: (path) => path.startsWith("node_modules/") || path.includes("/node_modules/"),
    reason: "vendored dependency",
  },
  {
    id: "built-output",
    match: (path) => path.startsWith("dist/") || path.includes("/dist/"),
    reason: "built artifact",
  },
  {
    id: "test-files",
    match: (path) => /(^|\/)[^/]+\.(test|spec)\.[cm]?[jt]sx?$/.test(path),
    reason: "test file, not production source",
  },
  {
    id: "tooling-config",
    match: (path) => /(^|\/)[^/]+\.config\.[cm]?[jt]s$/.test(path),
    reason: "tooling configuration, not shipped runtime source",
  },
];

// Must match coverage.include in vitest.config.ts so the on-disk inventory and
// the instrumented file set cannot drift.
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

/** Convert an OS path to repo-relative posix form. */
export function toPosix(path) {
  return path.split("\\").join("/");
}

/** Return the surface record that owns a repo-relative path, or null. */
export function surfaceForPath(relPath) {
  const path = toPosix(relPath);
  for (const surface of SURFACES) {
    for (const pattern of surface.include) {
      const root = pattern.replace(/\/\*\*$/, "");
      if (path === root || path.startsWith(`${root}/`)) {
        return surface;
      }
    }
  }
  return null;
}

/** Return the exclusion reason for a path, or null when it is measurable source. */
export function isExcluded(relPath) {
  const path = toPosix(relPath);
  for (const exclusion of EXCLUSIONS) {
    if (exclusion.match(path)) {
      return exclusion.reason;
    }
  }
  return null;
}

function walkFiles(dir, visit) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") {
      continue;
    }
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(abs, visit);
    } else if (entry.isFile()) {
      visit(abs);
    }
  }
}

/** List every measurable source file on disk for the configured surfaces. */
export function listExpectedFiles({ repoRoot = process.cwd() } = {}) {
  const roots = [
    ...new Set(SURFACES.flatMap((surface) => surface.include.map((p) => p.replace(/\/\*\*$/, "")))),
  ];
  const files = new Set();
  for (const root of roots) {
    const abs = join(repoRoot, root);
    if (!existsSync(abs) || !statSync(abs).isDirectory()) {
      continue;
    }
    walkFiles(abs, (absFile) => {
      const rel = toPosix(relative(repoRoot, absFile));
      if (!SOURCE_EXTENSIONS.has(extname(rel))) {
        return;
      }
      if (isExcluded(rel) || !surfaceForPath(rel)) {
        return;
      }
      files.add(rel);
    });
  }
  return [...files].sort();
}

function emptyMetric() {
  return { covered: 0, total: 0, skipped: 0 };
}

function normalizeMetric(metric) {
  return {
    covered: Number(metric?.covered) || 0,
    total: Number(metric?.total) || 0,
    skipped: Number(metric?.skipped) || 0,
  };
}

function normalizeFileEntry(entry) {
  const normalized = {};
  for (const metric of METRICS) {
    normalized[metric] = normalizeMetric(entry?.[metric]);
  }
  return normalized;
}

function normalizeSummary(summary, repoRoot) {
  const map = new Map();
  for (const [key, value] of Object.entries(summary ?? {})) {
    if (key === "total" || !value || typeof value !== "object") {
      continue;
    }
    const rel = toPosix(isAbsolute(key) ? relative(repoRoot, key) : key);
    if (rel.startsWith("..")) {
      continue;
    }
    map.set(rel, normalizeFileEntry(value));
  }
  return map;
}

function sumMetrics(files) {
  const totals = {};
  for (const metric of METRICS) {
    totals[metric] = emptyMetric();
  }
  const entries = files instanceof Map ? files.values() : Object.values(files);
  for (const entry of entries) {
    for (const metric of METRICS) {
      totals[metric].covered += entry[metric].covered;
      totals[metric].total += entry[metric].total;
      totals[metric].skipped += entry[metric].skipped;
    }
  }
  return totals;
}

function metricHasHits(entry) {
  return METRICS.some((metric) => entry[metric].covered > 0);
}

/**
 * Group a Vitest json-summary report by production surface.
 *
 * `expectedFiles` is the on-disk inventory from listExpectedFiles(); any
 * expected file absent from the report is recorded as missing, so an
 * instrumented-but-unexecuted file still counts in the denominator while an
 * uninstrumented file is reported instead of silently vanishing.
 */
export function summarizeCoverage({ summary, expectedFiles = [], repoRoot = process.cwd() }) {
  const entries = normalizeSummary(summary, repoRoot);
  const expectedSet = new Set(expectedFiles.map(toPosix));
  const surfaces = SURFACES.map((surface) => {
    const expectedForSurface = expectedFiles
      .map(toPosix)
      .filter((path) => surfaceForPath(path)?.id === surface.id);
    const files = {};
    const missingFiles = [];
    for (const path of expectedForSurface) {
      const entry = entries.get(path);
      if (entry) {
        files[path] = entry;
      } else {
        missingFiles.push(path);
      }
    }
    const totals = sumMetrics(files);
    const executedFileCount = Object.keys(files).filter((path) =>
      metricHasHits(files[path]),
    ).length;
    return {
      id: surface.id,
      label: surface.label,
      limitation: surface.limitation,
      include: [...surface.include],
      expectedFileCount: expectedForSurface.length,
      executedFileCount,
      measured: executedFileCount > 0,
      missingFiles,
      files,
      totals,
    };
  });

  const missingSurfaces = surfaces
    .filter((surface) => surface.expectedFileCount > 0 && Object.keys(surface.files).length === 0)
    .map((surface) => surface.id);
  const unexpectedFiles = [...entries.keys()].filter((path) => !expectedSet.has(path));

  return {
    surfaces,
    totals: sumMetrics(entries),
    missingSurfaces,
    unexpectedFiles,
    expectedFileCount: expectedSet.size,
    instrumentedFileCount: entries.size,
  };
}

/** Build a measured baseline from a summarizeCoverage() result. */
export function baselineFromSummary(current, { generatedAt = null, command = null } = {}) {
  const surfaces = {};
  for (const surface of current.surfaces) {
    const files = {};
    for (const [path, entry] of Object.entries(surface.files)) {
      // One flat [covered, total, ...] array per file, ordered by metricOrder.
      files[path] = METRICS.flatMap((metric) => [entry[metric].covered, entry[metric].total]);
    }
    surfaces[surface.id] = {
      measured: surface.measured,
      expectedFileCount: surface.expectedFileCount,
      missingFiles: [...surface.missingFiles],
      totals: Object.fromEntries(
        METRICS.map((metric) => [
          metric,
          [surface.totals[metric].covered, surface.totals[metric].total],
        ]),
      ),
      files,
    };
  }
  return {
    schemaVersion: BASELINE_SCHEMA_VERSION,
    generatedAt,
    command,
    metricOrder: [...METRICS],
    surfaces,
  };
}

function isCountPair(value) {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    Number.isInteger(value[0]) &&
    Number.isInteger(value[1]) &&
    value[0] >= 0 &&
    value[0] <= value[1]
  );
}

/**
 * Validate the exact v1 baseline schema before trusting it. An empty,
 * truncated, mis-ordered, or differently-shaped baseline must fail the check,
 * never pass as "no change".
 */
export function validateBaseline(baseline) {
  const errors = [];
  if (!baseline || typeof baseline !== "object" || Array.isArray(baseline)) {
    return ["baseline is not an object"];
  }
  if (baseline.schemaVersion !== BASELINE_SCHEMA_VERSION) {
    errors.push(`unsupported schemaVersion: ${baseline.schemaVersion}`);
  }
  if (
    !Array.isArray(baseline.metricOrder) ||
    baseline.metricOrder.length !== METRICS.length ||
    baseline.metricOrder.some((metric, index) => metric !== METRICS[index])
  ) {
    errors.push(`metricOrder must be exactly ${METRICS.join(", ")}`);
  }
  const surfaces = baseline.surfaces;
  if (!surfaces || typeof surfaces !== "object" || Array.isArray(surfaces)) {
    errors.push("surfaces must be an object");
    return errors;
  }
  const configured = new Set(SURFACES.map((surface) => surface.id));
  for (const id of configured) {
    if (!(id in surfaces)) {
      errors.push(`surface ${id}: missing from baseline`);
    }
  }
  for (const [id, surface] of Object.entries(surfaces)) {
    if (!configured.has(id)) {
      errors.push(`surface ${id}: unknown surface`);
      continue;
    }
    if (!surface || typeof surface !== "object") {
      errors.push(`surface ${id}: not an object`);
      continue;
    }
    if (typeof surface.measured !== "boolean") {
      errors.push(`surface ${id}: measured must be a boolean`);
    }
    if (
      !Array.isArray(surface.missingFiles) ||
      !surface.missingFiles.every((file) => typeof file === "string")
    ) {
      errors.push(`surface ${id}: missingFiles must be a string array`);
    }
    for (const metric of METRICS) {
      if (!isCountPair(surface.totals?.[metric])) {
        errors.push(
          `surface ${id}: totals.${metric} must be [covered,total] integers with covered<=total`,
        );
      }
    }
    if (!surface.files || typeof surface.files !== "object" || Array.isArray(surface.files)) {
      errors.push(`surface ${id}: files must be an object`);
      continue;
    }
    for (const [file, counts] of Object.entries(surface.files)) {
      const pairsOk =
        Array.isArray(counts) &&
        counts.length === METRICS.length * 2 &&
        METRICS.every((_, index) => isCountPair([counts[index * 2], counts[index * 2 + 1]]));
      if (!pairsOk) {
        errors.push(`surface ${id}: file ${file} has malformed counts`);
      }
    }
    if (
      !Number.isInteger(surface.expectedFileCount) ||
      surface.expectedFileCount < 0 ||
      !Array.isArray(surface.missingFiles) ||
      surface.expectedFileCount !== Object.keys(surface.files).length + surface.missingFiles.length
    ) {
      errors.push(`surface ${id}: expectedFileCount must equal files + missingFiles`);
    }
  }
  return errors;
}

// Convert a live surface into the same flat v1 shape so the comparator only
// reasons about one representation.
function comparableSurface(surface) {
  const totals = {};
  for (const metric of METRICS) {
    totals[metric] = [surface.totals[metric].covered, surface.totals[metric].total];
  }
  const files = {};
  for (const [path, entry] of Object.entries(surface.files)) {
    files[path] = METRICS.flatMap((metric) => [entry[metric].covered, entry[metric].total]);
  }
  return {
    measured: surface.measured,
    missingFiles: surface.missingFiles,
    totals,
    files,
  };
}

function pair(value, index = null) {
  return index === null
    ? { covered: value[0], total: value[1] }
    : { covered: value[index * 2], total: value[index * 2 + 1] };
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function compareMetric({ surface, file = null, metric, before, after, tolerancePoints, result }) {
  if (!before || before.total === 0 || !after) {
    return;
  }
  if (after.total < before.total) {
    result.regressions.push({
      surface,
      file,
      metric,
      reason: "denominator shrank",
      from: before.total,
      to: after.total,
    });
    return;
  }
  const beforePct = (before.covered / before.total) * 100;
  const afterPct = after.total === 0 ? 0 : (after.covered / after.total) * 100;
  const drop = beforePct - afterPct;
  const gain = afterPct - beforePct;
  if (drop > tolerancePoints) {
    result.regressions.push({
      surface,
      file,
      metric,
      reason: "ratio dropped",
      from: round(beforePct),
      to: round(afterPct),
      dropPoints: round(drop),
    });
  } else if (gain > tolerancePoints) {
    result.improvements.push({
      surface,
      file,
      metric,
      reason: "ratio improved",
      from: round(beforePct),
      to: round(afterPct),
      gainPoints: round(gain),
    });
  }
}

/**
 * Compare current coverage with a validated v1 baseline.
 *
 * Fails on: a malformed or empty baseline, a baseline surface absent now, an
 * expected-but-uninstrumented file, a surface that lost all execution, a
 * shrinking denominator, and any line/function/branch/statement ratio loss at
 * surface or file level. The file-level pass is required so one file's loss
 * cannot be hidden by another file's gain.
 */
export function compareToBaseline({
  current,
  baseline,
  tolerancePoints = DEFAULT_TOLERANCE_POINTS,
} = {}) {
  if (!Number.isFinite(tolerancePoints) || tolerancePoints < 0) {
    throw new Error("tolerancePoints must be a finite, non-negative number");
  }
  const result = {
    checked: Boolean(baseline),
    ok: true,
    tolerancePoints,
    baselineErrors: [],
    regressions: [],
    missing: [],
    improvements: [],
    removed: [],
    added: [],
  };
  if (!baseline) {
    return result;
  }

  result.baselineErrors = validateBaseline(baseline);
  if (result.baselineErrors.length > 0) {
    result.ok = false;
    return result;
  }

  const currentById = new Map(
    current.surfaces.map((surface) => [surface.id, comparableSurface(surface)]),
  );

  for (const [id, base] of Object.entries(baseline.surfaces)) {
    const active = currentById.get(id);
    if (!active) {
      result.missing.push({ surface: id, reason: "surface absent from current coverage report" });
      continue;
    }

    for (const file of active.missingFiles) {
      result.missing.push({
        surface: id,
        file,
        reason: "expected file absent from current coverage report",
      });
    }
    for (const file of Object.keys(base.files)) {
      if (!(file in active.files) && !active.missingFiles.includes(file)) {
        result.removed.push({ surface: id, file });
      }
    }
    for (const file of Object.keys(active.files)) {
      if (!(file in base.files)) {
        result.added.push({ surface: id, file });
      }
    }

    if (base.measured && !active.measured) {
      result.regressions.push({
        surface: id,
        metric: "coverage",
        reason: "surface became unmeasured",
        dropPoints: 100,
      });
      continue;
    }
    if (!base.measured && active.measured) {
      result.improvements.push({
        surface: id,
        metric: "coverage",
        reason: "surface became measured",
        gainPoints: 100,
      });
      continue;
    }
    if (!base.measured && !active.measured) {
      continue;
    }

    for (const metric of METRICS) {
      compareMetric({
        surface: id,
        metric,
        before: pair(base.totals[metric]),
        after: pair(active.totals[metric]),
        tolerancePoints,
        result,
      });
    }
    for (const [file, counts] of Object.entries(base.files)) {
      if (!(file in active.files)) {
        continue;
      }
      for (let index = 0; index < METRICS.length; index += 1) {
        compareMetric({
          surface: id,
          file,
          metric: METRICS[index],
          before: pair(counts, index),
          after: pair(active.files[file], index),
          tolerancePoints,
          result,
        });
      }
    }
  }

  result.ok = result.regressions.length === 0 && result.missing.length === 0;
  return result;
}

function formatMetric(metric) {
  if (!metric || metric.total === 0) {
    return "n/a";
  }
  return `${((metric.covered / metric.total) * 100).toFixed(2)}% (${metric.covered}/${metric.total})`;
}

/** Render the compact per-surface human report. */
export function formatReport(current, comparison) {
  const lines = [];
  lines.push(
    "# Coverage by production surface (merged Node + relay lanes; browser lane when merged)",
  );
  lines.push("");
  lines.push(
    "surface                  lines               functions            branches             files",
  );
  for (const surface of current.surfaces) {
    const status = surface.measured ? "" : " [unmeasured]";
    const missing = surface.missingFiles.length ? ` missing=${surface.missingFiles.length}` : "";
    lines.push(
      `${surface.id}${status}  ${formatMetric(surface.totals.lines)}  ${formatMetric(
        surface.totals.functions,
      )}  ${formatMetric(surface.totals.branches)}  ${Object.keys(surface.files).length}/${
        surface.expectedFileCount
      }${missing}`,
    );
    if (surface.limitation) {
      lines.push(`    limitation: ${surface.limitation}`);
    }
  }
  lines.push("");
  const unmeasured = current.surfaces
    .filter((surface) => surface.expectedFileCount > 0 && !surface.measured)
    .map((surface) => surface.id);
  lines.push(
    `files: ${current.instrumentedFileCount}/${current.expectedFileCount} instrumented; ` +
      `${unmeasured.length ? `unmeasured surfaces: ${unmeasured.join(", ")}` : "no unmeasured surface"}`,
  );
  if (current.missingSurfaces.length) {
    lines.push(`surfaces with no instrumented file: ${current.missingSurfaces.join(", ")}`);
  }
  if (comparison?.baselineErrors?.length) {
    lines.push("");
    lines.push("baseline rejected:");
    for (const error of comparison.baselineErrors) {
      lines.push(`  - ${error}`);
    }
  }
  if (comparison?.missing?.length) {
    lines.push("");
    lines.push("missing from current coverage:");
    for (const entry of comparison.missing) {
      lines.push(`  - ${entry.surface}${entry.file ? `: ${entry.file}` : ""} (${entry.reason})`);
    }
  }
  if (comparison?.regressions?.length) {
    lines.push("");
    lines.push("regressions against baseline:");
    for (const entry of comparison.regressions) {
      const detail =
        entry.reason === "denominator shrank"
          ? `total ${entry.from} -> ${entry.to}`
          : `${entry.from}% -> ${entry.to}% (${entry.dropPoints} points)`;
      const target = `${entry.surface}${entry.file ? `:${entry.file}` : ""}`;
      lines.push(`  - ${target} ${entry.metric}: ${entry.reason} ${detail}`);
    }
  }
  if (comparison?.improvements?.length) {
    lines.push("");
    lines.push("improvements against baseline:");
    for (const entry of comparison.improvements) {
      lines.push(`  - ${entry.surface} ${entry.metric}: ${entry.reason}`);
    }
  }
  if (comparison?.removed?.length) {
    lines.push("");
    lines.push(
      `files no longer present in the report: ${comparison.removed.length} (update the baseline if intentional)`,
    );
  }
  return lines.join("\n");
}

/** Load a measured baseline file, or return null when it does not exist. */
export function loadBaseline(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }
  return JSON.parse(readFileSync(filePath, "utf8"));
}

// Keep the committed baseline reproducible and Biome-clean: inline arrays that
// fit the configured line width, otherwise wrap their scalar items.
const BASELINE_LINE_WIDTH = 100;

function formatBaselineJson(baseline) {
  return JSON.stringify(baseline, null, 2).replace(
    /(\n[ ]*"[^"]+": )\[\n([\s\S]*?)\n([ ]*)\](,?)/g,
    (_match, head, body, indent, comma) => {
      const values = body.split(",\n").map((line) => line.trim());
      const inline = `[${values.join(", ")}]`;
      // `head` starts with the newline that precedes the property line.
      if (head.length - 1 + inline.length + comma.length <= BASELINE_LINE_WIDTH) {
        return `${head}${inline}${comma}`;
      }
      const pad = `${indent}  `;
      const lines = [];
      let current = "";
      for (const value of values) {
        const candidate = current ? `${current}, ${value}` : value;
        if (current && pad.length + candidate.length > BASELINE_LINE_WIDTH) {
          lines.push(`${pad}${current},`);
          current = value;
        } else {
          current = candidate;
        }
      }
      if (current) {
        lines.push(`${pad}${current}`);
      }
      return `${head}[\n${lines.join("\n")}\n${indent}]${comma}`;
    },
  );
}

/** Write a measured baseline file. Only the explicit update path calls this. */
export function writeBaseline(filePath, baseline) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${formatBaselineJson(baseline)}\n`, "utf8");
}

/** Parse command-line options. Baseline writes require --update-baseline. */
export function parseArgs(argv) {
  const options = {
    updateBaseline: false,
    check: false,
    informational: false,
    json: false,
    coveragePath: join("coverage", "coverage-summary.json"),
    baselinePath: join("scripts", "coverage-baseline.json"),
    outputPath: null,
    metadataPath: null,
    repoRoot: process.cwd(),
    tolerancePoints: DEFAULT_TOLERANCE_POINTS,
  };
  const next = () => {
    index += 1;
    return argv[index];
  };
  let index = 0;
  while (index < argv.length) {
    const arg = argv[index];
    switch (arg) {
      case "--update-baseline":
        options.updateBaseline = true;
        break;
      case "--check":
        options.check = true;
        break;
      case "--informational":
        options.informational = true;
        break;
      case "--json":
        options.json = true;
        break;
      case "--input":
      case "--coverage":
        options.coveragePath = next();
        break;
      case "--output":
        options.outputPath = next();
        break;
      case "--metadata":
        options.metadataPath = next();
        break;
      case "--baseline":
        options.baselinePath = next();
        break;
      case "--repo-root":
        options.repoRoot = next();
        break;
      case "--tolerance": {
        const value = Number(next());
        if (!Number.isFinite(value) || value < 0) {
          throw new Error("--tolerance must be a finite, non-negative number");
        }
        options.tolerancePoints = value;
        break;
      }
      default:
        throw new Error(`unknown option: ${arg}`);
    }
    index += 1;
  }
  return options;
}

function resolveFrom(root, path) {
  return isAbsolute(path) ? path : join(root, path);
}

/** Render the browser lane's recorded runtime/build/browser provenance. */
function formatProvenance(metadata) {
  const runtime = metadata.runtime ?? {};
  const lines = [
    "",
    "## Provenance",
    "",
    `runtime: node ${runtime.node ?? "unknown"} (v8 ${runtime.v8 ?? "unknown"}, ${
      runtime.platform ?? "?"
    } ${runtime.arch ?? "?"})`,
  ];
  if (metadata.browser?.versions?.length) {
    lines.push(`browser: ${metadata.browser.versions.join(", ")}`);
  }
  if (metadata.tools && Object.keys(metadata.tools).length > 0) {
    lines.push(
      `tools: ${Object.entries(metadata.tools)
        .map(([name, version]) => `${name}@${version}`)
        .join(", ")}`,
    );
  }
  if (metadata.build?.assets?.length) {
    lines.push(
      `build assets: ${metadata.build.assets
        .map((asset) => `${asset.file}@${String(asset.sha256).slice(0, 12)}`)
        .join(", ")}`,
    );
  }
  return lines.join("\n");
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
  const coveragePath = resolveFrom(options.repoRoot, options.coveragePath);
  const baselinePath = resolveFrom(options.repoRoot, options.baselinePath);

  if (!existsSync(coveragePath)) {
    console.error(
      `coverage summary not found: ${coveragePath}\nrun \`npm run test:coverage\` (vitest --coverage) first`,
    );
    process.exit(2);
  }

  const summary = JSON.parse(readFileSync(coveragePath, "utf8"));
  const current = summarizeCoverage({
    summary,
    expectedFiles: listExpectedFiles({ repoRoot: options.repoRoot }),
    repoRoot: options.repoRoot,
  });

  if (options.informational) {
    const parts = [
      "# Informational merged report (Node + relay + browser lane) — not gated against the Node baseline",
      "",
      formatReport(current, null),
    ];
    if (options.metadataPath) {
      const metadataPath = resolveFrom(options.repoRoot, options.metadataPath);
      if (existsSync(metadataPath)) {
        parts.push(formatProvenance(JSON.parse(readFileSync(metadataPath, "utf8"))));
      } else {
        parts.push(`\n## Provenance\n\nmetadata not found: ${metadataPath}`);
      }
    }
    const text = parts.join("\n");
    console.log(text);
    if (options.outputPath) {
      const outputPath = resolveFrom(options.repoRoot, options.outputPath);
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, `${text}\n`, "utf8");
    }
    process.exit(0);
  }

  if (options.updateBaseline) {
    const baseline = baselineFromSummary(current, {
      generatedAt: new Date().toISOString(),
      command: "npm run test:coverage",
    });
    writeBaseline(baselinePath, baseline);
    console.log(formatReport(current, compareToBaseline({ current, baseline: null })));
    console.log("");
    console.log(`measured baseline written: ${toPosix(relative(options.repoRoot, baselinePath))}`);
    process.exit(0);
  }

  const baseline = loadBaseline(baselinePath);
  if (!baseline) {
    console.error(
      `coverage baseline not found: ${baselinePath}\nwrite one explicitly with --update-baseline`,
    );
    process.exit(2);
  }

  const baselineErrors = validateBaseline(baseline);
  if (baselineErrors.length > 0) {
    console.log(formatReport(current, { baselineErrors }));
    console.error("");
    console.error(`coverage baseline rejected: ${baselinePath}`);
    for (const error of baselineErrors) {
      console.error(`  - ${error}`);
    }
    process.exit(2);
  }

  const comparison = compareToBaseline({
    current,
    baseline,
    tolerancePoints: options.tolerancePoints,
  });
  console.log(formatReport(current, comparison));
  if (options.json) {
    console.log(JSON.stringify({ current, comparison }, null, 2));
  }
  if (!comparison.ok) {
    console.error("");
    console.error("coverage regression: measured coverage is worse than the baseline");
    console.error(
      "review the report above; update the baseline explicitly only for an intentional change",
    );
    process.exit(1);
  }
  process.exit(0);
}

const invokedPath = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;
if (invokedPath || process.argv[1]?.endsWith("coverage-report.mjs")) {
  main();
}
