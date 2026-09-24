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
 * Route registry. Every executable suite surface appears here exactly once, so
 * route completeness is checkable and each case carries its route identity.
 *
 * Gate membership is NOT stored here. Each route lists the package-script
 * `gateSteps` it participates in; `deriveRouteGateMembership` maps those steps
 * through `scripts/test-gate-policy.json` (the single gate-policy source of
 * truth). `manualCommands` are opt-in and never claim a gate; `liveCommands`
 * are live/canary commands explicitly outside every gate.
 *
 * `collectionMode: "runtime"` means the suite registers tests dynamically (or
 * behind an env gate) and vitest's static parser cannot see them; collecting
 * those requires `--staticParse=false` and never executes a test body.
 *
 * `nature` is "deterministic", "live", "mixed", or "unknown" for a surface not
 * yet reviewed. It is a description, not a boundary classification.
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
    nature: "deterministic",
    gateSteps: ["test"],
    manualCommands: [],
    liveCommands: [],
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
    nature: "deterministic",
    gateSteps: ["test:site"],
    manualCommands: [],
    liveCommands: [],
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
    nature: "deterministic",
    gateSteps: ["test:agent-tools"],
    manualCommands: [],
    liveCommands: [],
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
    nature: "live",
    gateSteps: [],
    manualCommands: ["eval -- cases", "eval -- release"],
    liveCommands: [],
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
    nature: "live",
    env: { OPENCANDLE_GUI_BROWSER: "1" },
    gateSteps: [],
    manualCommands: ["test:gui:browser"],
    liveCommands: [],
    description:
      "Local GUI browser suite. Now the live set only (the mocked set moved out); opt-in via OPENCANDLE_GUI_BROWSER=1 and not part of any gate.",
  },
  {
    id: "gui-integration",
    label: "Root Vitest project: gui-integration",
    collector: "vitest",
    collectionMode: "runtime",
    project: "gui-integration",
    config: "vitest.config.ts",
    cwd: null,
    boundaryHint: "browser",
    nature: "deterministic",
    env: { OPENCANDLE_GUI_INTEGRATION: "1" },
    gateSteps: ["test:gui:integration"],
    manualCommands: [],
    liveCommands: [],
    description:
      "Deterministic browser integration lane: the real GUI bundle is served from an isolated local server (temporary home, blanked credentials, OS port) while HTTP/WS/SSE are mocked inside the page, so it never calls a model or the public internet. Activation is env-gated by OPENCANDLE_GUI_INTEGRATION=1, which this route supplies for collection; required by gates:full and release:check.",
  },
  {
    id: "gui-journey",
    label: "Root Vitest project: gui-journey",
    collector: "vitest",
    collectionMode: "runtime",
    project: "gui-journey",
    config: "vitest.config.ts",
    cwd: null,
    boundaryHint: "browser",
    nature: "deterministic",
    gateSteps: ["test:gui:journey"],
    manualCommands: [],
    liveCommands: [],
    description:
      "Full-stack deterministic GUI journeys: a real Playwright browser drives the real gui/server child and session loop, with only external HTTP (model provider, Yahoo, Ticker Line, Google Fonts) replaced by local fixtures. It has no activation env gate; required by gates:full and release:check.",
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
    nature: "mixed",
    env: { OPENCANDLE_GUI_RELEASE_SMOKE: "1" },
    gateSteps: ["test:gui:release-smoke"],
    manualCommands: [],
    liveCommands: [],
    description:
      "GUI release-gate smoke suite. Real browser, credential-blanked cold home, local probe stub; gated by OPENCANDLE_GUI_RELEASE_SMOKE=1 and required by gates:full and release:check.",
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
    nature: "deterministic",
    gateSteps: ["relay:test"],
    manualCommands: [],
    liveCommands: [],
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
    nature: "live",
    gateSteps: [],
    manualCommands: [
      "test:e2e",
      "test:e2e:cli",
      "test:e2e:credential",
      "test:e2e:providers",
      "test:e2e:harness-dcf",
    ],
    liveCommands: ["test:providers:release"],
    description:
      "Plain `npx tsx` e2e scripts with their own pass/fail reporters, outside every vitest project. `test:providers:release` is the live provider-release canary (tests/e2e/provider-release-smoke.ts); it is live and not in any gate.",
    staticPatterns: ["tests/e2e/*.ts"],
    staticExclude: [
      "tests/e2e/gui-browser.test.ts",
      "tests/e2e/gui-release-smoke.test.ts",
      "tests/e2e/gui-integration.test.ts",
      "tests/e2e/gui-integration-lifecycle.test.ts",
      "tests/e2e/gui-session-journey.test.ts",
      "tests/e2e/live-canary-results.ts",
    ],
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
    nature: "mixed",
    gateSteps: ["test:gui:hosted"],
    manualCommands: [],
    liveCommands: ["relay:smoke:browser"],
    description:
      "Hosted surface split in two: the deterministic hosted PWA/WebContainer e2e (`test:gui:hosted`, in gates:full and release:check) and the provider-relay browser live-smoke (`relay:smoke:browser`), which is live and is NOT claimed by gates:full.",
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
    nature: "live",
    gateSteps: [],
    manualCommands: ["eval -- product", "eval -- competitive", "eval -- router-live"],
    liveCommands: [],
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
 * Gate membership is derived from the repo's single gate-policy file, not
 * copied into this registry. The policy is owned by the gate-policy workstream
 * (`scripts/test-gate.mjs`); this module only reads it.
 */
export const GATE_POLICY_PATH = "scripts/test-gate-policy.json";
export const GATE_NAMES = ["core", "full", "release"];
export const ROUTE_NATURES = ["deterministic", "live", "mixed", "unknown"];

export function validateGatePolicy(policy) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    throw new Error("gate policy must be an object keyed by gate name");
  }
  for (const gate of GATE_NAMES) {
    const steps = policy[gate];
    if (!Array.isArray(steps) || steps.length === 0) {
      throw new Error(`gate policy "${gate}" must be a non-empty array`);
    }
    if (steps.some((step) => typeof step !== "string" || step.trim() === "")) {
      throw new Error(`gate policy "${gate}" must contain only non-empty script names`);
    }
  }
  return policy;
}

export function loadGatePolicy(text) {
  return validateGatePolicy(JSON.parse(text));
}

export function policyStepNames(policy) {
  const names = new Set();
  for (const gate of GATE_NAMES) {
    for (const step of policy[gate] ?? []) names.add(step);
  }
  return names;
}

export function gateNamesForSteps(policy, steps = []) {
  return GATE_NAMES.filter((gate) => (policy[gate] ?? []).some((step) => steps.includes(step)));
}

function commandDisplay(command) {
  return /^(npm|node|tsx|npx)\s/.test(command) ? command : `npm run ${command}`;
}

/** Derive a route's gate membership from the policy; never store gate names in the registry. */
export function deriveRouteGateMembership(route, policy) {
  const gateSteps = route.gateSteps ?? [];
  const gates = gateNamesForSteps(policy, gateSteps);
  return {
    gateSteps,
    gates,
    inDefaultGates: gates.includes("core"),
    gateCommands: gateSteps.map((step) => `npm run ${step}`),
    manualCommands: (route.manualCommands ?? []).map(commandDisplay),
    liveCommands: (route.liveCommands ?? []).map(commandDisplay),
    nature: route.nature ?? "unknown",
  };
}

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
  "OPENCANDLE_GUI_INTEGRATION",
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
  const { route, repoRoot, variantId, env, readFile, mockCache, reviewedOverrides, memberships } =
    context;
  const file = relativeRepoPath(repoRoot, raw.file);
  const name = typeof raw.name === "string" ? raw.name : String(raw.name ?? "");
  const identityBase = caseIdentityBase(route.id, file, name);
  const provisional = { id: identityBase, identityBase };
  const boundary = classifyBoundary(provisional, reviewedOverrides);
  const reviewed = boundary.boundarySource === "reviewed";
  const membership = memberships.get(route.id);
  return {
    identityBase,
    file,
    name,
    suiteRoute: route.id,
    collector: route.collector,
    project: raw.projectName ?? route.project ?? null,
    collectionMode: route.collectionMode,
    nature: membership.nature,
    location: raw.location ?? null,
    ...boundary,
    reviewedDisposition: reviewed ? "reviewed" : REVIEWED_DISPOSITION,
    mocksHeuristic: mocksHeuristicForFile(file, readFile, mockCache),
    gateRouting: membership.gateCommands,
    gateNames: membership.gates,
    inDefaultGates: membership.inDefaultGates,
    skipFlags: [],
    knownFail: false,
    activationVariants: [variantId],
    envKeys: Object.keys(env ?? {}),
  };
}

function staticRecordForFile(entry, context) {
  const { route, readFile, mockCache, memberships } = context;
  const file = relativeRepoPath(context.repoRoot, entry.file);
  const id = `${route.id}::${file}`;
  const membership = memberships.get(route.id);
  return {
    id,
    file,
    suiteRoute: route.id,
    collector: route.collector,
    project: null,
    collectionMode: "static",
    nature: membership.nature,
    boundary: DEFAULT_BOUNDARY,
    boundaryHint: route.boundaryHint,
    boundarySource: "unreviewed",
    needsHumanReview: true,
    reviewedDisposition: REVIEWED_DISPOSITION,
    mocksHeuristic: mocksHeuristicForFile(file, readFile, mockCache),
    gateRouting: membership.gateCommands,
    gateNames: membership.gates,
    inDefaultGates: membership.inDefaultGates,
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
 * `policy` is the parsed `scripts/test-gate-policy.json`; gate membership is
 * derived from it rather than stored in the registry.
 */
export function buildInventory({
  collections = [],
  staticFiles = [],
  repoRoot,
  generatedAt = new Date().toISOString(),
  readFile = defaultReadFile,
  reviewedOverrides = {},
  policy = { core: [], full: [], release: [] },
  policyDigest = null,
} = {}) {
  const memberships = new Map(
    ALL_ROUTES.map((route) => [route.id, deriveRouteGateMembership(route, policy)]),
  );
  const mockCache = new Map();
  const context = { repoRoot, readFile, mockCache, reviewedOverrides, memberships };
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
        gateNames: [],
        inDefaultGates: false,
        nature: "unknown",
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
    const membership = memberships.get(route.id);
    return {
      id: route.id,
      label: route.label,
      collector: route.collector,
      collectionMode: route.collectionMode,
      project: route.project ?? null,
      config: route.config ?? null,
      cwd: route.cwd ?? null,
      boundaryHint: route.boundaryHint,
      nature: membership.nature,
      gateSteps: membership.gateSteps,
      gateNames: membership.gates,
      inDefaultGates: membership.inDefaultGates,
      gateCommands: membership.gateCommands,
      manualCommands: membership.manualCommands,
      liveCommands: membership.liveCommands,
      caseCount: routeCases.length,
      fileCount: files.size,
      errors: stats.errors,
    };
  });

  const reviewedCases = cases.filter((entry) => entry.reviewedDisposition === "reviewed").length;
  const machineBoundaryHints = cases.filter(
    (entry) => entry.boundarySource === "unreviewed",
  ).length;

  return {
    schemaVersion: INVENTORY_SCHEMA_VERSION,
    kind: INVENTORY_KIND,
    phase: INVENTORY_PHASE,
    generatedAt,
    generator: "scripts/test-inventory.mjs",
    gatePolicy: {
      path: GATE_POLICY_PATH,
      digest: policyDigest,
      note: "Gate membership is derived from this policy at collection time; the file is owned by the gate-policy workstream and is not edited here.",
    },
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
      machine: {
        reviewedCases: 0,
        pendingReviewCases: cases.length,
        signals: ["mocks-source-heuristic", "route-default-boundary-hint"],
        note: "Machine signals are heuristics over source text and route metadata; none of them is a review.",
      },
      human: {
        reviewedCases,
        ledgers: [],
        note: "No human review ledger is attached. boundary stays unknown and reviewedDisposition stays pending-review until a human records a per-case classification.",
      },
      pendingBoundaryHints: machineBoundaryHints,
      note: "Phase 1 is inventory only. boundaryHint on a route is a triage aid, never proof of review.",
    },
    cases,
    staticInventory,
    limitations: [
      "Vitest suites are runtime-collected with --staticParse=false because tests register dynamically or behind env gates. Collection imports modules but never executes a test body.",
      "Skipped tests are not reported by `vitest list`; skip flags are derived from the eval env variant that made a case register.",
      "Standalone tests/e2e, hosted browser scripts, and non-vitest eval manifests are recorded at file level and labeled static; their individual case identities require each suite's own runner.",
      "Mocks are a text heuristic over each test file and are not a reviewed determination that a test is safe to delete, move, or trust.",
      "gui-integration is a deterministic browser lane whose real GUI bundle is served from an isolated local server while HTTP/WS/SSE are mocked in the page; its route env supplies OPENCANDLE_GUI_INTEGRATION=1 so collection matches the gate command instead of silently collecting zero cases.",
      "gui-journey is a deterministic full-stack lane: real browser, real gui/server child, and real session loop, with only external HTTP fixture-backed. It has no activation env gate, so its route env is empty.",
    ],
  };
}

export function validateInventory(inventory, { policy } = {}) {
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
  const policySteps = policy ? policyStepNames(policy) : null;
  for (const id of knownRouteIds) {
    if (!seenRoutes.has(id)) errors.push(`missing-route:${id}`);
  }
  for (const route of inventory.routes) {
    if (!knownRouteIds.has(route.id)) errors.push(`unknown-route:${route.id}`);
    if (Array.isArray(route.errors) && route.errors.length > 0) {
      errors.push(`collection-error:${route.id}`);
    }
    if (route.nature && !ROUTE_NATURES.includes(route.nature)) {
      errors.push(`unknown-route-nature:${route.id}`);
    }
    if (policySteps) {
      for (const step of route.gateSteps ?? []) {
        if (!policySteps.has(step)) errors.push(`unknown-gate-step:${step}`);
      }
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
