import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALL_ROUTES,
  assertNoSecretLikeValues,
  buildCollectionEnv,
  buildInventory,
  CONTROLLED_ENV_KEYS,
  classifyBoundary,
  deriveRouteGateMembership,
  detectMockSignals,
  EVAL_ENV_VARIANTS,
  loadGatePolicy,
  ROUTE_NATURES,
  routeById,
  STATIC_ROUTES,
  VITEST_ROUTES,
  validateInventory,
  validateOutputTarget,
} from "../../scripts/test-inventory-lib.mjs";
import sample from "./fixtures/test-inventory-sample.json";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const cliPath = resolve(repoRoot, "scripts/test-inventory.mjs");
const realPolicyPath = resolve(repoRoot, "scripts/test-gate-policy.json");
const realPolicy = loadGatePolicy(readFileSync(realPolicyPath, "utf8"));
const packageJson = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

/** Extract the inline `NAME=value` env assignments from an npm script string. */
function scriptEnvAssignments(script: string): Record<string, string> {
  const assignments: Record<string, string> = {};
  for (const match of script.matchAll(/\b([A-Z][A-Z0-9_]+)=([^\s&;]+)/g)) {
    assignments[match[1]] = match[2];
  }
  return assignments;
}

const tempRoots: string[] = [];

function makeTempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** Build the collections input the CLI would assemble, from the independent fixture sample. */
function sampleCollections() {
  const collections: Array<{
    routeId: string;
    variantId: string;
    env: Record<string, string>;
    cases: unknown[];
  }> = [];
  for (const route of VITEST_ROUTES) {
    if (route.id === "evals") {
      for (const variant of EVAL_ENV_VARIANTS) {
        const cases = (sample.vitest.evals as Record<string, unknown[]>)[variant.id] ?? [];
        collections.push({
          routeId: route.id,
          variantId: variant.id,
          env: variant.env,
          cases,
        });
      }
      continue;
    }
    collections.push({
      routeId: route.id,
      variantId: "default",
      env: {},
      cases: (sample.vitest as Record<string, unknown[]>)[route.id] ?? [],
    });
  }
  return collections;
}

function sampleStaticFiles() {
  return Object.entries(sample.static).flatMap(([routeId, files]) =>
    (files as string[]).map((file) => ({ routeId, file })),
  );
}

function buildSampleInventory(overrides: Record<string, unknown> = {}) {
  return buildInventory({
    collections: sampleCollections(),
    staticFiles: sampleStaticFiles(),
    repoRoot,
    generatedAt: "2026-01-01T00:00:00.000Z",
    readFile: () => "import { vi } from 'vitest';\nvi.mock('./dependency.js');\n",
    policy: realPolicy,
    policyDigest: "sha256:fixture",
    ...overrides,
  });
}

describe("buildInventory parses collection output", () => {
  it("records one case per collected entry, keyed by route with location identity", () => {
    const inventory = buildSampleInventory();
    expect(inventory.totals.collectedCases).toBe(12);
    expect(inventory.totals.collectedFiles).toBe(10);
    expect(inventory.totals.staticEntries).toBe(6);

    const quote = inventory.cases.find(
      (entry: { name: string }) => entry.name === "Alpha suite > parses a quote",
    );
    expect(quote).toMatchObject({
      file: "tests/unit/alpha.test.ts",
      suiteRoute: "unit",
      collector: "vitest",
      project: "unit",
      location: { line: 10, column: 3 },
    });
  });

  it("preserves duplicate case names with stable unique identities", () => {
    const first = buildSampleInventory();
    const second = buildSampleInventory();
    const duplicates = first.cases.filter(
      (entry: { name: string }) => entry.name === "Alpha suite > duplicate case name",
    );
    expect(duplicates).toHaveLength(2);
    expect(new Set(duplicates.map((entry: { id: string }) => entry.id)).size).toBe(2);
    expect(second.cases.map((entry: { id: string }) => entry.id)).toEqual(
      first.cases.map((entry: { id: string }) => entry.id),
    );
    // The second duplicate is distinguishable from the first, not renamed or dropped.
    expect(duplicates[0].id).not.toBe(duplicates[1].id);
  });

  it("leaves every case unreviewed with boundary unknown rather than guessing", () => {
    const inventory = buildSampleInventory();
    for (const entry of inventory.cases) {
      expect(entry.boundary).toBe("unknown");
      expect(entry.boundarySource).toBe("unreviewed");
      expect(entry.needsHumanReview).toBe(true);
      expect(entry.reviewedDisposition).toBe("pending-review");
    }
    expect(inventory.reviewStatus.reviewedCases).toBe(0);
    expect(inventory.reviewStatus.pendingReviewCases).toBe(inventory.totals.collectedCases);
  });

  it("keeps the mocks heuristic distinct from reviewed disposition", () => {
    const inventory = buildSampleInventory();
    const entry = inventory.cases[0];
    expect(entry.mocksHeuristic.level).toBe("signals-detected");
    expect(entry.mocksHeuristic.signals).toContain("vi.mock");
    expect(entry.reviewedDisposition).toBe("pending-review");
  });

  it("derives eval skip flags from the activation env variant", () => {
    const inventory = buildSampleInventory();
    const always = inventory.cases.find((entry: { name: string }) =>
      entry.name.includes("quote-accuracy"),
    );
    const usually = inventory.cases.find((entry: { name: string }) =>
      entry.name.includes("comprehensive-analysis"),
    );
    const knownFail = inventory.cases.find((entry: { name: string }) =>
      entry.name.includes("KNOWN-FAIL E1"),
    );
    expect(always.skipFlags).toEqual([]);
    expect(usually.skipFlags).toContain("EVAL_TIER");
    expect(knownFail.skipFlags).toEqual(
      expect.arrayContaining(["EVAL_TIER", "OPENCANDLE_LIVE_MULTI_TURN_EVAL"]),
    );
    expect(knownFail.knownFail).toBe(true);
  });
});

describe("classifyBoundary", () => {
  it("uses a reviewed override only when one is recorded", () => {
    const overrides = {
      "unit::tests/unit/alpha.test.ts::Alpha suite > parses a quote": "pure-unit",
    };
    const reviewed = classifyBoundary(
      {
        id: "unit::tests/unit/alpha.test.ts::Alpha suite > parses a quote",
        routeId: "unit",
      },
      overrides,
    );
    expect(reviewed).toEqual({
      boundary: "pure-unit",
      boundarySource: "reviewed",
      needsHumanReview: false,
    });
    const unreviewed = classifyBoundary({ id: "unit::other", routeId: "unit" }, overrides);
    expect(unreviewed).toEqual({
      boundary: "unknown",
      boundarySource: "unreviewed",
      needsHumanReview: true,
    });
  });
});

describe("detectMockSignals", () => {
  it("reports named signals and none when the source has no mock calls", () => {
    expect(detectMockSignals("const x = 1;\n").level).toBe("none-detected");
    const detected = detectMockSignals(
      "vi.mock('./a.js');\nglobalThis.fetch = vi.fn();\nmockResolvedValue({});\n",
    );
    expect(detected.level).toBe("signals-detected");
    expect(detected.signals).toEqual(
      expect.arrayContaining(["vi.mock", "globalThis.fetch", "vi.fn", "mockResolvedValue"]),
    );
  });
});

describe("buildCollectionEnv", () => {
  it("clears ambient gating flags before applying route and variant env", () => {
    const base = {
      PATH: "/bin",
      EVAL_TIER: "usually",
      OPENCANDLE_LIVE_MULTI_TURN_EVAL: "1",
      OPENCANDLE_RUN_KNOWN_FAIL_EVALS: "1",
      OPENCANDLE_GUI_BROWSER: "1",
      OPENCANDLE_GUI_RELEASE_SMOKE: "1",
      KEEP: "yes",
    };
    const env = buildCollectionEnv(
      base,
      { OPENCANDLE_GUI_RELEASE_SMOKE: "1" },
      { EVAL_TIER: "usually" },
    );
    expect(env).toEqual({
      PATH: "/bin",
      KEEP: "yes",
      OPENCANDLE_GUI_RELEASE_SMOKE: "1",
      EVAL_TIER: "usually",
    });
    for (const key of CONTROLLED_ENV_KEYS) {
      if (key === "EVAL_TIER" || key === "OPENCANDLE_GUI_RELEASE_SMOKE") continue;
      expect(env[key]).toBeUndefined();
    }
  });
});

describe("gate policy derivation", () => {
  const fixturePolicy = {
    core: ["check", "test"],
    full: ["check", "test", "test:site", "test:gui:integration"],
    release: ["check", "test", "test:site", "test:gui:integration", "test:packed-install"],
  };

  it("derives gate names from the policy instead of the registry", () => {
    expect(
      deriveRouteGateMembership({ id: "a", gateSteps: ["test"] }, fixturePolicy),
    ).toMatchObject({ gates: ["core", "full", "release"], inDefaultGates: true });
    expect(
      deriveRouteGateMembership({ id: "b", gateSteps: ["test:gui:integration"] }, fixturePolicy),
    ).toMatchObject({ gates: ["full", "release"], inDefaultGates: false });
    expect(deriveRouteGateMembership({ id: "c", gateSteps: [] }, fixturePolicy)).toMatchObject({
      gates: [],
      inDefaultGates: false,
      gateCommands: [],
    });
  });

  it("keeps opt-in manual and live commands out of gate membership", () => {
    const membership = deriveRouteGateMembership(
      {
        id: "d",
        nature: "mixed",
        gateSteps: ["test:site"],
        manualCommands: ["test:e2e"],
        liveCommands: ["relay:smoke:browser"],
      },
      fixturePolicy,
    );
    expect(membership.gateCommands).toEqual(["npm run test:site"]);
    expect(membership.manualCommands).toEqual(["npm run test:e2e"]);
    expect(membership.liveCommands).toEqual(["npm run relay:smoke:browser"]);
  });

  it("every registered gate step exists in the real gate policy", () => {
    const policySteps = new Set([...realPolicy.core, ...realPolicy.full, ...realPolicy.release]);
    for (const route of ALL_ROUTES) {
      for (const step of route.gateSteps ?? []) {
        expect(policySteps).toContain(step);
      }
    }
  });

  it("flags a registry step that drifted out of the policy", () => {
    const inventory = buildSampleInventory();
    const drifted = {
      ...inventory,
      routes: inventory.routes.map((route: { id: string; gateSteps: string[] }) =>
        route.id === "unit" ? { ...route, gateSteps: ["test:does-not-exist"] } : route,
      ),
    };
    expect(validateInventory(drifted, { policy: realPolicy }).errors).toContain(
      "unknown-gate-step:test:does-not-exist",
    );
  });
});

describe("gui route activation contract", () => {
  it("gives gui-integration the env its npm gate command sets", () => {
    const route = routeById("gui-integration");
    expect(route).not.toBeNull();
    expect(route?.nature).toBe("deterministic");
    expect(route?.env).toEqual({ OPENCANDLE_GUI_INTEGRATION: "1" });
    // The route env must mirror the command that actually enables the spec:
    // without it, `describe.skipIf(!runGuiIntegration)` collects zero cases.
    expect(scriptEnvAssignments(packageJson.scripts["test:gui:integration"])).toEqual(route?.env);
  });

  it("leaves gui-journey ungated and deterministic, matching its npm command", () => {
    const route = routeById("gui-journey");
    expect(route).not.toBeNull();
    expect(route?.nature).toBe("deterministic");
    expect(route?.env ?? {}).toEqual({});
    expect(scriptEnvAssignments(packageJson.scripts["test:gui:journey"])).toEqual({});
  });

  it("treats the gui-integration flag as controlled so ambient values cannot leak", () => {
    expect(CONTROLLED_ENV_KEYS).toContain("OPENCANDLE_GUI_INTEGRATION");
    const enabled = buildCollectionEnv(
      { PATH: "/bin", OPENCANDLE_GUI_INTEGRATION: "ambient" },
      routeById("gui-integration")?.env ?? {},
    );
    expect(enabled.OPENCANDLE_GUI_INTEGRATION).toBe("1");
    expect(enabled.PATH).toBe("/bin");
    const cleared = buildCollectionEnv(
      { PATH: "/bin", OPENCANDLE_GUI_INTEGRATION: "1" },
      routeById("gui-journey")?.env ?? {},
    );
    expect(cleared.OPENCANDLE_GUI_INTEGRATION).toBeUndefined();
  });
});

describe("route registry shape", () => {
  it("registers the integration and journey projects with their gate steps", () => {
    const guiIntegration = VITEST_ROUTES.find((route) => route.id === "gui-integration");
    const guiJourney = VITEST_ROUTES.find((route) => route.id === "gui-journey");
    expect(guiIntegration?.gateSteps).toEqual(["test:gui:integration"]);
    expect(guiJourney?.gateSteps).toEqual(["test:gui:journey"]);
    expect(realPolicy.full).toEqual(
      expect.arrayContaining(["test:gui:integration", "test:gui:journey"]),
    );
    expect(realPolicy.release).toEqual(
      expect.arrayContaining(["test:gui:integration", "test:gui:journey"]),
    );
  });

  it("marks gui-browser live and keeps every route nature in the registry vocabulary", () => {
    const guiBrowser = VITEST_ROUTES.find((route) => route.id === "gui-browser");
    expect(guiBrowser?.nature).toBe("live");
    for (const route of ALL_ROUTES) {
      expect(ROUTE_NATURES).toContain(route.nature);
    }
  });

  it("excludes the new vitest files and the live-canary helper from the standalone glob", () => {
    const e2e = STATIC_ROUTES.find((route) => route.id === "e2e");
    expect(e2e?.staticExclude).toEqual(
      expect.arrayContaining([
        "tests/e2e/gui-integration.test.ts",
        "tests/e2e/gui-integration-lifecycle.test.ts",
        "tests/e2e/gui-session-journey.test.ts",
        "tests/e2e/live-canary-results.ts",
      ]),
    );
    // The live canary script itself stays inventoried.
    expect(e2e?.staticExclude).not.toContain("tests/e2e/provider-release-smoke.ts");
    expect(e2e?.liveCommands).toContain("test:providers:release");
  });

  it("distinguishes hosted deterministic from hosted live and never gates the relay live smoke", () => {
    const hosted = STATIC_ROUTES.find((route) => route.id === "hosted");
    expect(hosted?.gateSteps).toEqual(["test:gui:hosted"]);
    expect(hosted?.liveCommands).toContain("relay:smoke:browser");
    expect(hosted?.nature).toBe("mixed");
    const membership = deriveRouteGateMembership(hosted ?? {}, realPolicy);
    expect(membership.gateCommands).not.toContain("npm run relay:smoke:browser");
  });

  it("reports machine review separately from the empty human ledger", () => {
    const inventory = buildSampleInventory();
    expect(inventory.reviewStatus.machine.reviewedCases).toBe(0);
    expect(inventory.reviewStatus.human.reviewedCases).toBe(0);
    expect(inventory.reviewStatus.human.ledgers).toEqual([]);
    expect(inventory.reviewStatus.reviewedCases).toBe(0);
    expect(inventory.gatePolicy.path).toBe("scripts/test-gate-policy.json");
  });
});

describe("validateInventory", () => {
  it("accepts the sample inventory and reports route completeness", () => {
    const inventory = buildSampleInventory();
    const result = validateInventory(inventory, { policy: realPolicy });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    for (const route of [...VITEST_ROUTES, ...STATIC_ROUTES]) {
      expect(inventory.routes.map((entry: { id: string }) => entry.id)).toContain(route.id);
    }
  });

  it("flags a missing route and an unknown case route", () => {
    const inventory = buildSampleInventory();
    const missingSite = {
      ...inventory,
      routes: inventory.routes.filter((entry: { id: string }) => entry.id !== "site"),
    };
    expect(validateInventory(missingSite, { policy: realPolicy }).errors).toContain(
      "missing-route:site",
    );

    const weird = {
      ...inventory,
      cases: [
        ...inventory.cases,
        {
          ...inventory.cases[0],
          id: "bogus::tests/bogus.test.ts::case",
          suiteRoute: "bogus",
        },
      ],
    };
    expect(validateInventory(weird, { policy: realPolicy }).errors).toContain(
      "unknown-case-route:bogus",
    );
  });

  it("flags incomplete collection so the CLI can exit non-zero", () => {
    const inventory = buildSampleInventory({
      collections: sampleCollections().map((collection) =>
        collection.routeId === "unit" ? { ...collection, error: "timed out" } : collection,
      ),
    });
    expect(validateInventory(inventory, { policy: realPolicy }).errors).toContain(
      "collection-error:unit",
    );
  });

  it("stays extensible: registry-derived routes validate before they collect cases", () => {
    expect(ALL_ROUTES).toHaveLength(VITEST_ROUTES.length + STATIC_ROUTES.length);
    const ids = ALL_ROUTES.map((route: { id: string }) => route.id);
    expect(new Set(ids).size).toBe(ids.length);

    // A new project (for example gui-integration) needs one registry entry and
    // no case changes to be representable; it validates with zero cases until
    // its first collection.
    const empty = buildInventory({
      collections: [],
      staticFiles: [],
      repoRoot,
      generatedAt: "2026-01-01T00:00:00.000Z",
      readFile: () => "",
    });
    expect(empty.routes).toHaveLength(ALL_ROUTES.length);
    expect(empty.routes.every((route: { caseCount: number }) => route.caseCount === 0)).toBe(true);
    expect(validateInventory(empty, { policy: realPolicy }).errors).toEqual([]);
  });
});

describe("safe output validation", () => {
  it("restricts generated output to validation-output and rejects escaping paths", () => {
    expect(validateOutputTarget("validation-output/test-inventory.json", { repoRoot }).ok).toBe(
      true,
    );
    expect(validateOutputTarget("/tmp/test-inventory.json", { repoRoot }).ok).toBe(false);
    expect(validateOutputTarget("validation-output/../package.json", { repoRoot }).ok).toBe(false);
    expect(validateOutputTarget("docs/internal/foo.md", { repoRoot }).ok).toBe(false);
  });

  it("rejects secret-like values in serialized output", () => {
    const clean = assertNoSecretLikeValues('{"hello":"world"}');
    expect(clean.ok).toBe(true);
    const dirty = assertNoSecretLikeValues('{"apiKey":"sk-abcdefghijklmnopqrstuvwxyz012345"}');
    expect(dirty.ok).toBe(false);
    expect(dirty.findings.length).toBeGreaterThan(0);
  });
});

describe("CLI read-only behaviour", () => {
  it("validates an existing inventory with --check without writing", () => {
    const dir = makeTempRoot("oc-test-inventory-check-");
    const inventoryPath = join(dir, "test-inventory.json");
    const inventory = buildSampleInventory();
    writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`);
    const before = readFileSync(inventoryPath, "utf8");

    const result = spawnSync(process.execPath, [cliPath, "--check", inventoryPath], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/ok/i);
    expect(readFileSync(inventoryPath, "utf8")).toBe(before);

    const brokenPath = join(dir, "broken.json");
    writeFileSync(brokenPath, '{"schemaVersion":1,"kind":"other"}\n');
    const brokenBefore = readFileSync(brokenPath, "utf8");
    const broken = spawnSync(process.execPath, [cliPath, "--check", brokenPath], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(broken.status).toBe(1);
    expect(readFileSync(brokenPath, "utf8")).toBe(brokenBefore);
  });

  it("lists routes with --routes in a read-only cwd without creating files", () => {
    const dir = makeTempRoot("oc-test-inventory-routes-");
    const result = spawnSync(process.execPath, [cliPath, "--routes"], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("unit");
    expect(result.stdout).toContain("evals");
    expect(result.stdout).toContain("relay");
    expect(result.stdout).toContain("hosted");
    expect(spawnSync("ls", ["-A", dir], { encoding: "utf8" }).stdout.trim()).toBe("");
  });

  it("exits non-zero when --from captures are incomplete", () => {
    const emptyFrom = makeTempRoot("oc-test-inventory-from-");
    const result = spawnSync(process.execPath, [cliPath, "--from", emptyFrom, "--stdout"], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/collection-error:/);
  });
});

describe("Windows-safe npx collection", () => {
  /**
   * Run the real CLI in-process under a simulated Windows platform. Only the
   * npm-entrypoint probe and the child-process boundary are mocked; the route
   * runner, `buildNpmInvocation`, and option forwarding stay real. On POSIX the
   * bare `npx` and the node + JS-entrypoint forms are identical, so the
   * simulation is the only way to observe the wiring on a non-Windows host.
   */
  it("spawns npx through buildNpmInvocation with the node JS entrypoint", async () => {
    const calls: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = [];
    const spawnMock = vi.fn((command: string, args: string[], options: Record<string, unknown>) => {
      calls.push({ command, args, options });
      return { status: 0, stdout: "[]", stderr: "", signal: null, error: undefined };
    });
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
    const originalArgv = process.argv;
    const originalExitCode = process.exitCode;

    vi.resetModules();
    vi.doMock("node:child_process", () => ({ spawnSync: spawnMock }));
    vi.doMock("node:fs", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs")>();
      return {
        ...actual,
        existsSync: (path: string) =>
          String(path).endsWith("npx-cli.js") || actual.existsSync(path),
      };
    });

    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      Object.defineProperty(process, "platform", { value: "win32" });
      process.argv = [process.execPath, cliPath, "--stdout"];
      await import(pathToFileURL(cliPath).href);
    } finally {
      log.mockRestore();
      error.mockRestore();
      process.argv = originalArgv;
      process.exitCode = originalExitCode;
      if (platformDescriptor) Object.defineProperty(process, "platform", platformDescriptor);
      vi.doUnmock("node:child_process");
      vi.doUnmock("node:fs");
      vi.resetModules();
    }

    expect(calls.length).toBeGreaterThan(0);
    // Every collection spawn must resolve npx to `process.execPath` plus the
    // JavaScript entrypoint, never the bare npx (the .cmd shim on Windows).
    for (const call of calls) {
      expect(call.command).toBe(process.execPath);
      expect(call.args[0]).toMatch(/npx-cli\.js$/);
    }
    expect(calls[0].args.slice(1)).toEqual([
      "vitest",
      "list",
      "--json",
      "--project",
      "unit",
      "--staticParse=false",
    ]);
    expect(calls[0].options).toMatchObject({
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: 600_000,
      killSignal: "SIGKILL",
    });
  });
});
