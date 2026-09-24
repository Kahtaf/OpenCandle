// Pure, testable inventory logic for the Phase 1 test-contract inventory.
//
// The CLI half (scripts/test-inventory.mjs) owns process spawning and file
// writes; everything in this module is deterministic so the parser, identity,
// route-completeness, and gate-routing rules can be tested against a small
// independent fixture sample instead of this repository's live test tree.

import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const INVENTORY_SCHEMA_VERSION = 1;
export const INVENTORY_KIND = "opencandle-test-inventory";
export const INVENTORY_PHASE = "phase-1-inventory-unreviewed";
export const DEFAULT_BOUNDARY = "unknown";
export const REVIEWED_DISPOSITION = "pending-review";

/**
 * Route registry. Every executable suite surface must appear here so route
 * completeness is checkable and so each case can carry its gate routing.
 *
 * `collectionMode: "runtime"` means the suite registers tests dynamically (or
 * behind an env gate) and vitest's static parser cannot see them; collecting
 * those requires `--staticParse=false` and never executes a test body.
 */
export const VITEST_ROUTES = [
  {
    id: "unit",
    label: "Root Vitest project: unit",
    collector: "vitest",
    collectionMode: "runtime",
    project: "unit",
    config: "vitest.config.ts",
    cwd: null,
    boundaryHint: "unit",
    inDefaultGates: true,
    gateCommands: ["npm test", "npm run gates", "npm run gates:full", "npm run release:check"],
    description: "Default unit suite mirrored from src/.",
  },
  {
    id: "site",
    label: "Root Vitest project: site",
    collector: "vitest",
    collectionMode: "runtime",
    project: "site",
    config: "vitest.config.ts",
    cwd: null,
    boundaryHint: "unit",
    inDefaultGates: false,
    gateCommands: ["npm run test:site", "npm run gates:full", "npm run release:check"],
    description: "Public docs site build-contract tests.",
  },
  {
    id: "agent-tools",
    label: "Root Vitest project: agent-tools",
    collector: "vitest",
    collectionMode: "runtime",
    project: "agent-tools",
    config: "vitest.config.ts",
    cwd: null,
    boundaryHint: "unit",
    inDefaultGates: true,
    gateCommands: ["npm run test:agent-tools", "npm run gates", "npm run gates:full"],
    description: "Repo-maintainer and agent helper tests.",
  },
  {
    id: "evals",
    label: "Root Vitest project: evals",
    collector: "vitest",
    collectionMode: "runtime",
    project: "evals",
    config: "vitest.config.ts",
    cwd: null,
    boundaryHint: "live-service",
    inDefaultGates: false,
    gateCommands: ["npm run eval -- cases", "npm run eval -- release"],
    description:
      "Agent/session eval cases. Tier and known-fail flags gate which cases register; collection must not run the eval bodies.",
  },
  {
    id: "gui-browser",
    label: "Root Vitest project: gui-browser",
    collector: "vitest",
    collectionMode: "runtime",
    project: "gui-browser",
    config: "vitest.config.ts",
    cwd: null,
    boundaryHint: "browser",
    inDefaultGates: false,
    env: { OPENCANDLE_GUI_BROWSER: "1" },
    gateCommands: ["npm run test:gui:browser"],
    description: "Local GUI browser smoke suite, gated by OPENCANDLE_GUI_BROWSER=1.",
  },
  {
    id: "gui-release",
    label: "Root Vitest project: gui-release",
    collector: "vitest",
    collectionMode: "runtime",
    project: "gui-release",
    config: "vitest.config.ts",
    cwd: null,
    boundaryHint: "browser",
    inDefaultGates: false,
    env: { OPENCANDLE_GUI_RELEASE_SMOKE: "1" },
    gateCommands: ["npm run test:gui:release-smoke", "npm run gates:full", "npm run release:check"],
    description: "GUI release-gate smoke suite, gated by OPENCANDLE_GUI_RELEASE_SMOKE=1.",
  },
  {
    id: "relay",
    label: "Provider relay Vitest config",
    collector: "vitest",
    collectionMode: "runtime",
    project: null,
    config: "workers/provider-relay/vitest.config.ts",
    cwd: "workers/provider-relay",
    boundaryHint: "unit",
    inDefaultGates: true,
    gateCommands: ["npm run relay:test", "npm run gates", "npm run gates:full"],
    description: "Separate workspace vitest config for the provider relay worker.",
  },
];

export const STATIC_ROUTES = [
  {
    id: "e2e",
    label: "Standalone tests/e2e tsx runners",
    collector: "tsx",
    collectionMode: "static",
    project: null,
    config: null,
    cwd: null,
    boundaryHint: "live-service",
    inDefaultGates: false,
    gateCommands: [
      "npm run test:e2e",
      "npm run test:e2e:cli",
      "npm run test:e2e:credential",
      "npm run test:e2e:providers",
      "npm run test:e2e:harness-dcf",
    ],
    description:
      "Plain `npx tsx` e2e scripts with their own pass/fail reporters, outside every vitest project.",
    staticPatterns: ["tests/e2e/*.ts"],
    staticExclude: ["tests/e2e/gui-browser.test.ts", "tests/e2e/gui-release-smoke.test.ts"],
  },
  {
    id: "hosted",
    label: "Hosted browser scripts",
    collector: "node",
    collectionMode: "static",
    project: null,
    config: null,
    cwd: null,
    boundaryHint: "browser",
    inDefaultGates: false,
    gateCommands: ["npm run test:gui:hosted", "npm run relay:smoke:browser", "npm run gates:full"],
    description:
      "Hosted GUI browser/WebContainer e2e script (`test:browser`) and the provider-relay browser live-smoke harness; neither is a vitest surface.",
    staticPatterns: [
      "gui/hosted/tests/*.e2e.mjs",
      "workers/provider-relay/scripts/browser-live-smoke*.ts",
      "workers/provider-relay/scripts/browser-live-smoke-page.js",
    ],
  },
  {
    id: "eval-manifests",
    label: "Eval suites and manifests not collected by vitest",
    collector: "manifest",
    collectionMode: "static",
    project: null,
    config: null,
    cwd: null,
    boundaryHint: "live-service",
    inDefaultGates: false,
    gateCommands: [
      "npm run eval -- product",
      "npm run eval -- competitive",
      "npm run eval -- router-live",
    ],
    description:
      "Product, competitive, and live-router eval definitions driven by their own tsx runners.",
    staticPatterns: [
      "tests/evals/product/cases.ts",
      "tests/evals/competitive-finance.ts",
      "tests/evals/router-live-contract.ts",
    ],
  },
];

export const ALL_ROUTES = [...VITEST_ROUTES, ...STATIC_ROUTES];

/**
 * Ambient env flags that change which tests register. They are stripped from
 * the inherited process env before every collection spawn so an inventory run
 * is reproducible regardless of the caller's shell; only the route/variant
 * env is allowed to set them.
 */
export const CONTROLLED_ENV_KEYS = [
  "EVAL_TIER",
  "OPENCANDLE_LIVE_MULTI_TURN_EVAL",
  "OPENCANDLE_RUN_KNOWN_FAIL_EVALS",
  "OPENCANDLE_EVAL_KNOWN_FAIL_E2",
  "OPENCANDLE_GUI_BROWSER",
  "OPENCANDLE_GUI_RELEASE_SMOKE",
];

/** Build the child env for a collection spawn with controlled flags cleared first. */
export function buildCollectionEnv(baseEnv, routeEnv = {}, variantEnv = {}) {
  const env = { ...baseEnv };
  for (const key of CONTROLLED_ENV_KEYS) delete env[key];
  return { ...env, ...routeEnv, ...variantEnv };
}

/** Env matrices that make otherwise-hidden eval cases register. */
export const EVAL_ENV_VARIANTS = [
  { id: "default", env: {}, description: "Default always-tier cases." },
  { id: "usually", env: { EVAL_TIER: "usually" }, description: "Usually-tier cases." },
  {
    id: "known-fail-e2",
    env: { EVAL_TIER: "usually", OPENCANDLE_EVAL_KNOWN_FAIL_E2: "1" },
    description: "Tracked known-fail E2 saved-market-state cases.",
  },
  {
    id: "known-fail-e1",
    env: {
      EVAL_TIER: "usually",
      OPENCANDLE_LIVE_MULTI_TURN_EVAL: "1",
      OPENCANDLE_RUN_KNOWN_FAIL_EVALS: "1",
    },
    description: "Tracked known-fail E1 live multi-turn case.",
  },
];

export const MOCK_SIGNAL_PATTERNS = [
  { name: "vi.mock", pattern: /\bvi\.mock\s*\(/ },
  { name: "vi.fn", pattern: /\bvi\.fn\s*\(/ },
  { name: "vi.spyOn", pattern: /\bvi\.spyOn\s*\(/ },
  { name: "mockResolvedValue", pattern: /\bmockResolvedValue\s*\(/ },
  { name: "mockRejectedValue", pattern: /\bmockRejectedValue\s*\(/ },
  { name: "mockImplementation", pattern: /\bmockImplementation\s*\(/ },
  { name: "mockReturnValue", pattern: /\bmockReturnValue\s*\(/ },
  { name: "globalThis.fetch", pattern: /\bglobalThis\.fetch\s*=/ },
  { name: "fetch-mock", pattern: /\bfetch\s*=\s*vi\.fn\s*\(/ },
  { name: "nock", pattern: /\bnock\s*\(/ },
  { name: "msw", pattern: /\b(?:setupServer|setupWorker)\s*\(/ },
  { name: "sinon", pattern: /\bsinon\./ },
];

const SECRET_PATTERNS = [
  { name: "openai-style-key", pattern: /sk-[A-Za-z0-9_-]{20,}/ },
  { name: "google-api-key", pattern: /AIza[0-9A-Za-z_-]{30,}/ },
  { name: "github-token", pattern: /ghp_[A-Za-z0-9]{30,}/ },
  { name: "slack-token", pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: "private-key-block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

export function routeById(id) {
  return ALL_ROUTES.find((route) => route.id === id) ?? null;
}

/** Repo-relative, forward-slash path even when the collector reports absolute paths. */
export function relativeRepoPath(repoRoot, file) {
  if (typeof file !== "string" || file.length === 0) return "";
  const normalized = file.split("\\").join("/");
  if (!isAbsolute(normalized)) return normalized.replace(/^\.\//, "");
  return relative(repoRoot, normalized).split("\\").join("/");
}

export function caseIdentityBase(routeId, file, name) {
  return `${routeId}::${file}::${name}`;
}

/**
 * Assign stable unique ids to records, preserving duplicate case names.
 * The first occurrence keeps the base id; later occurrences get `::#n`.
 */
export function assignStableCaseIds(records) {
  const counts = new Map();
  for (const record of records) {
    const base = record.identityBase;
    const seen = counts.get(base) ?? 0;
    counts.set(base, seen + 1);
    record.id = seen === 0 ? base : `${base}::#${seen + 1}`;
    record.duplicateOf = seen === 0 ? null : base;
  }
  return records;
}

export function detectMockSignals(source) {
  if (typeof source !== "string") {
    return { level: "source-unavailable", signals: [] };
  }
  const signals = MOCK_SIGNAL_PATTERNS.filter((entry) => entry.pattern.test(source)).map(
    (entry) => entry.name,
  );
  return {
    level: signals.length > 0 ? "signals-detected" : "none-detected",
    signals,
  };
}

/**
 * Boundary classification is intentionally "unknown" until a human records a
 * reviewed override. The route hint is triage metadata, never proof of review.
 */
export function classifyBoundary(record, reviewedOverrides = {}) {
  const override = reviewedOverrides[record.id];
  if (override) {
    return { boundary: override, boundarySource: "reviewed", needsHumanReview: false };
  }
  return { boundary: DEFAULT_BOUNDARY, boundarySource: "unreviewed", needsHumanReview: true };
}

function mocksHeuristicForFile(file, readFile, cache) {
  if (cache.has(file)) return cache.get(file);
  let source = null;
  try {
    source = readFile(file);
  } catch {
    source = null;
  }
  const result = detectMockSignals(source);
  cache.set(file, result);
  return result;
}

function recordForCollectionCase(raw, context) {
  const { route, repoRoot, variantId, env, readFile, mockCache, reviewedOverrides } = context;
  const file = relativeRepoPath(repoRoot, raw.file);
  const name = typeof raw.name === "string" ? raw.name : String(raw.name ?? "");
  const identityBase = caseIdentityBase(route.id, file, name);
  const provisional = { id: identityBase, identityBase };
  const boundary = classifyBoundary(provisional, reviewedOverrides);
  const reviewed = boundary.boundarySource === "reviewed";
  return {
    identityBase,
    file,
    name,
    suiteRoute: route.id,
    collector: route.collector,
    project: raw.projectName ?? route.project ?? null,
    collectionMode: route.collectionMode,
    location: raw.location ?? null,
    ...boundary,
    reviewedDisposition: reviewed ? "reviewed" : REVIEWED_DISPOSITION,
    mocksHeuristic: mocksHeuristicForFile(file, readFile, mockCache),
    gateRouting: route.gateCommands,
    inDefaultGates: route.inDefaultGates,
    skipFlags: [],
    knownFail: false,
    activationVariants: [variantId],
    envKeys: Object.keys(env ?? {}),
  };
}

function staticRecordForFile(entry, context) {
  const { route, readFile, mockCache } = context;
  const file = relativeRepoPath(context.repoRoot, entry.file);
  const id = `${route.id}::${file}`;
  return {
    id,
    file,
    suiteRoute: route.id,
    collector: route.collector,
    project: null,
    collectionMode: "static",
    boundary: DEFAULT_BOUNDARY,
    boundaryHint: route.boundaryHint,
    boundarySource: "unreviewed",
    needsHumanReview: true,
    reviewedDisposition: REVIEWED_DISPOSITION,
    mocksHeuristic: mocksHeuristicForFile(file, readFile, mockCache),
    gateRouting: route.gateCommands,
    inDefaultGates: route.inDefaultGates,
    caseIdentity: "file-level",
    note: "Not runtime-collected in Phase 1; case identities need this suite's own runner.",
  };
}

function defaultReadFile(file) {
  throw new Error(`no readFile provided for ${file}`);
}

/**
 * Build the inventory document from already-collected data.
 *
 * `collections` entries: { routeId, variantId, env, cases, error? }.
 * `staticFiles` entries: { routeId, file }.
 */
export function buildInventory({
  collections = [],
  staticFiles = [],
  repoRoot,
  generatedAt = new Date().toISOString(),
  readFile = defaultReadFile,
  reviewedOverrides = {},
} = {}) {
  const mockCache = new Map();
  const context = { repoRoot, readFile, mockCache, reviewedOverrides };
  const routeStats = new Map();
  const caseGroups = new Map();
  const caseOrder = [];

  for (const collection of collections) {
    const route = routeById(collection.routeId);
    const variantId = collection.variantId ?? "default";
    const env = collection.env ?? {};
    const stats = routeStats.get(collection.routeId) ?? { errors: [] };
    routeStats.set(collection.routeId, stats);
    if (collection.error) stats.errors.push(String(collection.error));
    if (!route) continue;

    const occurrences = new Map();
    for (const raw of collection.cases ?? []) {
      const file = relativeRepoPath(repoRoot, raw.file);
      const name = typeof raw.name === "string" ? raw.name : String(raw.name ?? "");
      const base = caseIdentityBase(route.id, file, name);
      const index = occurrences.get(base) ?? 0;
      occurrences.set(base, index + 1);
      const groupKey = `${base}::#${index}`;
      let group = caseGroups.get(groupKey);
      if (!group) {
        group = {
          identityBase: base,
          occurrenceIndex: index,
          routeId: route.id,
          raw,
          variantIds: new Set(),
          bestVariantId: null,
          bestEnvKeys: null,
        };
        caseGroups.set(groupKey, group);
        caseOrder.push(groupKey);
      }
      group.variantIds.add(variantId);
      const variantEnvKeys = Object.keys(env);
      if (group.bestEnvKeys === null || variantEnvKeys.length < group.bestEnvKeys.length) {
        group.bestEnvKeys = variantEnvKeys;
        group.bestVariantId = variantId;
      }
    }
  }

  const cases = [];
  for (const groupKey of caseOrder) {
    const group = caseGroups.get(groupKey);
    const route = routeById(group.routeId);
    const variantId = group.bestVariantId ?? "default";
    const record = recordForCollectionCase(group.raw, {
      ...context,
      route,
      variantId,
      env: Object.fromEntries((group.bestEnvKeys ?? []).map((key) => [key, true])),
    });
    record.identityBase = group.identityBase;
    record.skipFlags = [...(group.bestEnvKeys ?? [])];
    record.knownFail = variantId.startsWith("known-fail");
    record.activationVariants = [...group.variantIds];
    delete record.envKeys;
    cases.push(record);
  }
  assignStableCaseIds(cases);

  const staticInventory = staticFiles.map((entry) => {
    const route = routeById(entry.routeId);
    if (!route) {
      return {
        id: `${entry.routeId}::${relativeRepoPath(repoRoot, entry.file)}`,
        file: relativeRepoPath(repoRoot, entry.file),
        suiteRoute: entry.routeId,
        collector: "unknown",
        collectionMode: "static",
        boundary: DEFAULT_BOUNDARY,
        boundarySource: "unreviewed",
        needsHumanReview: true,
        reviewedDisposition: REVIEWED_DISPOSITION,
        gateRouting: [],
        inDefaultGates: false,
        caseIdentity: "file-level",
        mocksHeuristic: { level: "source-unavailable", signals: [] },
      };
    }
    return staticRecordForFile(entry, { ...context, route });
  });

  const routes = ALL_ROUTES.map((route) => {
    const stats = routeStats.get(route.id) ?? { errors: [] };
    const routeCases = cases.filter((entry) => entry.suiteRoute === route.id);
    const files = new Set(routeCases.map((entry) => entry.file));
    return {
      id: route.id,
      label: route.label,
      collector: route.collector,
      collectionMode: route.collectionMode,
      project: route.project ?? null,
      config: route.config ?? null,
      cwd: route.cwd ?? null,
      boundaryHint: route.boundaryHint,
      inDefaultGates: route.inDefaultGates,
      gateCommands: route.gateCommands,
      caseCount: routeCases.length,
      fileCount: files.size,
      errors: stats.errors,
    };
  });

  const reviewedCases = cases.filter((entry) => entry.reviewedDisposition === "reviewed").length;

  return {
    schemaVersion: INVENTORY_SCHEMA_VERSION,
    kind: INVENTORY_KIND,
    phase: INVENTORY_PHASE,
    generatedAt,
    generator: "scripts/test-inventory.mjs",
    routes,
    totals: {
      collectedCases: cases.length,
      collectedFiles: new Set(cases.map((entry) => entry.file)).size,
      staticEntries: staticInventory.length,
      routes: routes.length,
    },
    reviewStatus: {
      reviewedCases,
      pendingReviewCases: cases.length - reviewedCases,
      note: "Phase 1 is inventory only. boundary stays unknown and reviewedDisposition stays pending-review until a human records a per-case classification; boundaryHint on the route is a triage aid, not a review.",
    },
    cases,
    staticInventory,
    limitations: [
      "Eval, GUI browser, and GUI release suites register tests dynamically or behind env gates, so they are runtime-collected with --staticParse=false. Collection imports modules but never executes a test body.",
      "Skipped tests are not reported by `vitest list`; skip flags are derived from the eval env variant that made a case register.",
      "Standalone tests/e2e, hosted browser scripts, and non-vitest eval manifests are recorded at file level and labeled static; their individual case identities require each suite's own runner.",
      "Mocks are a text heuristic over each test file and are not a reviewed determination that a test is safe to delete, move, or trust.",
    ],
  };
}

export function validateInventory(inventory) {
  const errors = [];
  const warnings = [];
  if (!inventory || typeof inventory !== "object") {
    return { ok: false, errors: ["inventory-not-an-object"], warnings };
  }
  if (inventory.kind !== INVENTORY_KIND) errors.push("invalid-kind");
  if (inventory.schemaVersion !== INVENTORY_SCHEMA_VERSION) {
    errors.push("unsupported-schema-version");
  }
  if (!Array.isArray(inventory.routes) || !Array.isArray(inventory.cases)) {
    errors.push("missing-routes-or-cases");
    return { ok: errors.length === 0, errors, warnings };
  }

  const knownRouteIds = new Set(ALL_ROUTES.map((route) => route.id));
  const seenRoutes = new Set(inventory.routes.map((route) => route.id));
  for (const id of knownRouteIds) {
    if (!seenRoutes.has(id)) errors.push(`missing-route:${id}`);
  }
  for (const route of inventory.routes) {
    if (!knownRouteIds.has(route.id)) errors.push(`unknown-route:${route.id}`);
    if (Array.isArray(route.errors) && route.errors.length > 0) {
      errors.push(`collection-error:${route.id}`);
    }
  }

  const seenCaseIds = new Set();
  for (const entry of inventory.cases) {
    if (!entry || typeof entry !== "object") {
      errors.push("invalid-case-entry");
      continue;
    }
    if (!entry.id || !entry.file || !entry.name) errors.push(`incomplete-case:${entry.id ?? "?"}`);
    if (seenCaseIds.has(entry.id)) errors.push(`duplicate-case-id:${entry.id}`);
    seenCaseIds.add(entry.id);
    if (!knownRouteIds.has(entry.suiteRoute)) {
      errors.push(`unknown-case-route:${entry.suiteRoute}`);
    }
    if (entry.boundary === "unknown" && entry.needsHumanReview !== true) {
      errors.push(`unknown-boundary-not-flagged:${entry.id}`);
    }
  }

  for (const entry of inventory.staticInventory ?? []) {
    if (!knownRouteIds.has(entry.suiteRoute)) {
      errors.push(`unknown-static-route:${entry.suiteRoute}`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function validateOutputTarget(target, { repoRoot, force = false } = {}) {
  const resolved = isAbsolute(target) ? target : resolve(repoRoot, target);
  const allowedDir = resolve(repoRoot, "validation-output");
  if (resolved !== allowedDir && !resolved.startsWith(`${allowedDir}${sep}`)) {
    return { ok: false, reason: "outside-validation-output", path: resolved };
  }
  if (resolved === allowedDir) {
    return { ok: false, reason: "target-is-directory", path: resolved };
  }
  if (!resolved.endsWith(".json")) {
    return { ok: false, reason: "target-not-json", path: resolved };
  }
  if (!force) {
    // Refuse to clobber a path we did not previously generate.
    try {
      const existing = readFileIfExists(resolved);
      if (existing != null && !existing.includes(INVENTORY_KIND)) {
        return { ok: false, reason: "refusing-to-overwrite-non-inventory", path: resolved };
      }
    } catch {
      // unreadable existing file is treated as unsafe to overwrite
      return { ok: false, reason: "unreadable-existing-target", path: resolved };
    }
  }
  return { ok: true, path: resolved };
}

function readFileIfExists(path) {
  // Kept as a small indirection so the validator never needs write access.
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error("symlink");
    if (stat.isDirectory()) return null;
    return readFileSync(path, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
}

export function assertNoSecretLikeValues(text) {
  const findings = [];
  for (const { name, pattern } of SECRET_PATTERNS) {
    if (pattern.test(text)) findings.push(name);
  }
  return { ok: findings.length === 0, findings };
}
