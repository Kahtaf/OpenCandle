import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fingerprintCandidate, validateReleaseEvidence } from "../../scripts/release-evidence.mjs";

const SHA = (char: string) => `sha256:${char.repeat(64)}`;

const CANDIDATE = {
  commit: "a".repeat(40),
  sourceDigest: SHA("1"),
  lockDigest: SHA("2"),
  policyDigest: SHA("3"),
};

const STARTED = "2026-06-01T10:00:00.000Z";
const FINISHED = "2026-06-01T11:00:00.000Z";
const NOW = Date.parse("2026-06-01T12:00:00.000Z");

const DEFAULT_EXPECTED_CASE_IDS: Record<string, string[]> = {
  "router-live": ["router-live-smoke"],
  cases: ["cases-smoke"],
  product: ["product-smoke"],
  "competitive:frozen": ["competitive:frozen-smoke"],
};

function cloneExpectedCaseIds(overrides: Record<string, string[]> = {}): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [suiteId, ids] of Object.entries(DEFAULT_EXPECTED_CASE_IDS)) {
    result[suiteId] = [...ids];
  }
  for (const [suiteId, ids] of Object.entries(overrides)) {
    result[suiteId] = ids;
  }
  return result;
}

function makeSuite(suiteId: string, overrides: Record<string, unknown> = {}) {
  return {
    cases: [{ id: `${suiteId}-smoke`, status: "passed" }],
    attempts: [{ exitCode: 0, startedAt: STARTED, finishedAt: FINISHED }],
    ...overrides,
  };
}

function makeEvidence(overrides: Record<string, unknown> = {}): any {
  return {
    schemaVersion: 1,
    candidate: { ...CANDIDATE },
    startedAt: STARTED,
    finishedAt: FINISHED,
    suites: {
      "router-live": makeSuite("router-live"),
      cases: makeSuite("cases"),
      product: makeSuite("product"),
      "competitive:frozen": makeSuite("competitive:frozen"),
    },
    ...overrides,
  };
}

function validate(evidence: unknown, options: Record<string, unknown> = {}) {
  return validateReleaseEvidence(evidence, {
    candidate: { ...CANDIDATE },
    now: NOW,
    expectedCaseIds: cloneExpectedCaseIds(),
    ...options,
  });
}

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("validateReleaseEvidence", () => {
  it("accepts a complete, fresh, passing evidence record for the exact candidate", () => {
    const result = validate(makeEvidence());

    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("accepts optional allowlisted model settings and reasoned competitors", () => {
    const result = validate(
      makeEvidence({
        competitors: [{ id: "competitor-a", reason: "no frozen panel for this provider" }],
        model: { provider: "openai", model: "gpt-6", seed: "17" },
      }),
    );

    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("rejects a candidate field that does not exactly match the supplied identity", () => {
    const result = validate(makeEvidence({ candidate: { ...CANDIDATE, sourceDigest: SHA("f") } }));

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toMatch(/sourceDigest/);
  });

  it("rejects an empty candidate field in the evidence", () => {
    const result = validate(makeEvidence({ candidate: { ...CANDIDATE, commit: "   " } }));

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toMatch(/commit/);
  });

  it("rejects a missing candidate identity argument", () => {
    const result = validateReleaseEvidence(makeEvidence(), {
      now: NOW,
      expectedCaseIds: cloneExpectedCaseIds(),
    });

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toMatch(/candidate/i);
  });

  it("rejects an unsupported schema version", () => {
    const result = validate(makeEvidence({ schemaVersion: 2 }));

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toMatch(/schema/i);
  });

  describe("expected case ids", () => {
    it("accepts evidence whose case ids exactly match the caller-supplied set", () => {
      const evidence = makeEvidence();
      evidence.suites.cases.cases = [
        { id: "case-a", status: "passed" },
        { id: "case-b", status: "passed" },
      ];
      const expectedCaseIds = cloneExpectedCaseIds({ cases: ["case-b", "case-a"] });

      expect(validate(evidence, { expectedCaseIds }).valid).toBe(true);
    });

    it("rejects an evidence case set that is missing an expected id", () => {
      const evidence = makeEvidence();
      evidence.suites.cases.cases = [{ id: "case-a", status: "passed" }];

      const result = validate(evidence, {
        expectedCaseIds: cloneExpectedCaseIds({ cases: ["case-a", "case-b"] }),
      });

      expect(result.valid).toBe(false);
      expect(result.errors.join("\n")).toMatch(/case-b/);
    });

    it("rejects an evidence case set with an unexpected extra id", () => {
      const evidence = makeEvidence();
      evidence.suites.cases.cases = [
        { id: "case-a", status: "passed" },
        { id: "case-b", status: "passed" },
        { id: "case-c", status: "passed" },
      ];

      const result = validate(evidence, {
        expectedCaseIds: cloneExpectedCaseIds({ cases: ["case-a", "case-b"] }),
      });

      expect(result.valid).toBe(false);
      expect(result.errors.join("\n")).toMatch(/case-c/);
    });

    it("requires expectedCaseIds for every required suite", () => {
      const missing = validateReleaseEvidence(makeEvidence(), {
        candidate: { ...CANDIDATE },
        now: NOW,
      });
      expect(missing.valid).toBe(false);
      expect(missing.errors.join("\n")).toMatch(/expectedCaseIds/i);

      const partial = validate(makeEvidence(), { expectedCaseIds: { cases: ["cases-smoke"] } });
      expect(partial.valid).toBe(false);
      expect(partial.errors.join("\n")).toMatch(/router-live|product|competitive/);
    });

    it("rejects empty, blank, and duplicate expected ids", () => {
      for (const badCases of [[], [""], ["a", "a"]]) {
        const evidence = makeEvidence();
        evidence.suites.cases.cases = [{ id: "a", status: "passed" }];
        const result = validate(evidence, {
          expectedCaseIds: cloneExpectedCaseIds({ cases: badCases }),
        });
        expect(result.valid, JSON.stringify(badCases)).toBe(false);
      }
    });
  });

  it("rejects a missing required suite", () => {
    const evidence = makeEvidence();
    delete evidence.suites.product;

    const result = validate(evidence);

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toMatch(/product/);
  });

  it("rejects an unexpected extra suite", () => {
    const evidence = makeEvidence();
    evidence.suites.extra = makeSuite("extra");

    const result = validate(evidence);

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toMatch(/extra/);
  });

  it("rejects a suite with no cases", () => {
    const evidence = makeEvidence();
    evidence.suites.cases.cases = [];

    const result = validate(evidence);

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toMatch(/cases/);
  });

  it("rejects duplicate case ids inside a suite", () => {
    const evidence = makeEvidence();
    evidence.suites.product.cases = [
      { id: "dup", status: "passed" },
      { id: "dup", status: "passed" },
    ];

    const result = validate(evidence);

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toMatch(/dup/);
  });

  it("rejects an empty case id", () => {
    const evidence = makeEvidence();
    evidence.suites["router-live"].cases = [{ id: "  ", status: "passed" }];

    const result = validate(evidence);

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toMatch(/id/i);
  });

  it("rejects an unknown case status", () => {
    const evidence = makeEvidence();
    evidence.suites.cases.cases = [{ id: "case-1", status: "errored" }];

    const result = validate(evidence);

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toMatch(/status/i);
  });

  it("rejects a failed required case", () => {
    const evidence = makeEvidence();
    evidence.suites.cases.cases = [{ id: "case-1", status: "failed", reason: "assertion" }];

    const result = validate(evidence);

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toMatch(/case-1/);
  });

  it("rejects a skipped required case and names the silent skip", () => {
    const evidence = makeEvidence();
    evidence.suites.product.cases = [
      { id: "skipped-1", status: "skipped" },
      { id: "skipped-2", status: "skipped", reason: "provider down" },
    ];

    const result = validate(evidence);

    expect(result.valid).toBe(false);
    const errors = result.errors.join("\n");
    expect(errors).toMatch(/skipped-1/);
    expect(errors).toMatch(/reason/i);
    expect(errors).toMatch(/skipped-2/);
  });

  it("rejects a suite with zero attempts", () => {
    const evidence = makeEvidence();
    evidence.suites["competitive:frozen"].attempts = [];

    const result = validate(evidence);

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toMatch(/attempt/i);
  });

  it("rejects an attempt with a non-integer exit code", () => {
    const evidence = makeEvidence();
    evidence.suites.product.attempts = [
      { exitCode: 1.5, startedAt: STARTED, finishedAt: FINISHED },
    ];

    const result = validate(evidence);

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toMatch(/exitCode/);
  });

  it("blocks retry-green laundering when an earlier attempt failed", () => {
    const evidence = makeEvidence();
    evidence.suites.cases.attempts = [
      {
        exitCode: 1,
        startedAt: "2026-06-01T10:00:00.000Z",
        finishedAt: "2026-06-01T10:30:00.000Z",
      },
      {
        exitCode: 0,
        startedAt: "2026-06-01T10:30:00.000Z",
        finishedAt: "2026-06-01T11:00:00.000Z",
      },
    ];

    const result = validate(evidence);

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toMatch(/failed attempt|exit code/i);
  });

  it("accepts multiple contiguous attempts that all passed", () => {
    const evidence = makeEvidence();
    evidence.suites.cases.attempts = [
      {
        exitCode: 0,
        startedAt: "2026-06-01T10:00:00.000Z",
        finishedAt: "2026-06-01T10:30:00.000Z",
      },
      {
        exitCode: 0,
        startedAt: "2026-06-01T10:30:00.000Z",
        finishedAt: "2026-06-01T11:00:00.000Z",
      },
    ];

    expect(validate(evidence).valid).toBe(true);
  });

  it("rejects overlapping or out-of-order attempts", () => {
    const reversed = makeEvidence();
    reversed.suites.cases.attempts = [
      {
        exitCode: 0,
        startedAt: "2026-06-01T10:30:00.000Z",
        finishedAt: "2026-06-01T11:00:00.000Z",
      },
      {
        exitCode: 0,
        startedAt: "2026-06-01T10:00:00.000Z",
        finishedAt: "2026-06-01T10:30:00.000Z",
      },
    ];
    expect(validate(reversed).valid).toBe(false);

    const overlapping = makeEvidence();
    overlapping.suites.cases.attempts = [
      {
        exitCode: 0,
        startedAt: "2026-06-01T10:00:00.000Z",
        finishedAt: "2026-06-01T10:45:00.000Z",
      },
      {
        exitCode: 0,
        startedAt: "2026-06-01T10:30:00.000Z",
        finishedAt: "2026-06-01T11:00:00.000Z",
      },
    ];
    const result = validate(overlapping);

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toMatch(/overlap|out of order|order/i);
  });

  it("rejects attempts that fall outside the evidence window", () => {
    const before = makeEvidence();
    before.suites.product.attempts = [
      {
        exitCode: 0,
        startedAt: "2026-06-01T09:00:00.000Z",
        finishedAt: "2026-06-01T09:30:00.000Z",
      },
    ];
    expect(validate(before).valid).toBe(false);

    const after = makeEvidence();
    after.suites.product.attempts = [
      {
        exitCode: 0,
        startedAt: "2026-06-01T11:00:00.000Z",
        finishedAt: "2026-06-01T11:30:00.000Z",
      },
    ];
    const result = validate(after);

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toMatch(/evidence\.(startedAt|finishedAt)|window/i);
  });

  it("anchors freshness to the oldest required attempt, not the wrapper completion", () => {
    const evidence = makeEvidence({
      startedAt: "2026-05-31T06:00:00.000Z",
      finishedAt: "2026-06-01T11:00:00.000Z",
    });
    evidence.suites["router-live"].attempts = [
      {
        exitCode: 0,
        startedAt: "2026-05-31T06:00:00.000Z",
        finishedAt: "2026-05-31T07:00:00.000Z",
      },
    ];

    const result = validate(evidence);

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toMatch(/oldest|attempt/i);
  });

  it("rejects unparseable and non-finite times", () => {
    const evidence = makeEvidence({ startedAt: "not-a-date" });
    evidence.suites.cases.attempts = [
      { exitCode: 0, startedAt: Number.POSITIVE_INFINITY, finishedAt: FINISHED },
    ];

    const result = validate(evidence);

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toMatch(/startedAt|finite/i);
  });

  it("rejects a finish time before its start time", () => {
    const evidence = makeEvidence({ startedAt: FINISHED, finishedAt: STARTED });

    const result = validate(evidence);

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toMatch(/order|sequence|before/i);
  });

  it("rejects future evidence times", () => {
    const evidence = makeEvidence({
      startedAt: "2026-06-01T12:30:00.000Z",
      finishedAt: "2026-06-01T13:00:00.000Z",
    });

    const result = validate(evidence);

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toMatch(/future/i);
  });

  it("rejects evidence older than the 24 hour window", () => {
    const evidence = makeEvidence({
      startedAt: "2026-05-30T10:00:00.000Z",
      finishedAt: "2026-05-30T11:00:00.000Z",
    });

    const result = validate(evidence);

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toMatch(/age|old|window/i);
  });

  it("accepts age zero when evidence and attempts share the same millisecond", () => {
    const iso = new Date(NOW).toISOString();
    const evidence = makeEvidence({ startedAt: iso, finishedAt: iso });
    for (const suite of Object.values(evidence.suites) as any[]) {
      suite.attempts = [{ exitCode: 0, startedAt: iso, finishedAt: iso }];
    }

    expect(validate(evidence).valid).toBe(true);
  });

  it("honours a tighter maxAgeHours option", () => {
    const result = validate(makeEvidence(), { maxAgeHours: 0.5 });

    expect(result.valid).toBe(false);
  });

  it("accepts a Date or ISO string for the now option", () => {
    expect(validate(makeEvidence(), { now: new Date(NOW) }).valid).toBe(true);
    expect(validate(makeEvidence(), { now: new Date(NOW).toISOString() }).valid).toBe(true);
  });

  it("rejects invalid maxAgeHours options", () => {
    for (const maxAgeHours of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = validate(makeEvidence(), { maxAgeHours });
      expect(result.valid, `maxAgeHours=${maxAgeHours}`).toBe(false);
    }
  });

  it("rejects a competitor entry without an explicit reason", () => {
    const result = validate(makeEvidence({ competitors: [{ id: "competitor-a" }] }));

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toMatch(/reason/i);
  });

  it("rejects unknown model fields without echoing the value", () => {
    const secret = "sk-live-SUPER-SECRET-VALUE";
    const result = validate(makeEvidence({ model: { provider: "openai", apiKey: secret } }));

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toMatch(/apiKey|unsupported/i);
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("rejects nested model settings without echoing the value", () => {
    const secret = "nested-SECRET-TOKEN-VALUE";
    const result = validate(makeEvidence({ model: { auth: { token: secret } } }));

    expect(result.valid).toBe(false);
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("rejects non-string allowlisted model fields", () => {
    const result = validate(makeEvidence({ model: { provider: "openai", seed: 17 } }));

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toMatch(/seed/);
  });

  it("rejects non-object model settings", () => {
    const result = validate(makeEvidence({ model: "gpt-6" }));

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toMatch(/model/i);
  });

  it.each([null, undefined, "", 0, 42, [], "evidence", true])(
    "returns errors without throwing for malformed input %p",
    (input) => {
      expect(() => validate(input)).not.toThrow();
      const result = validate(input);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    },
  );

  it("returns errors without throwing for deeply malformed nested input", () => {
    const malformed = {
      schemaVersion: 1,
      candidate: null,
      startedAt: {},
      finishedAt: [],
      suites: {
        "router-live": { cases: "nope", attempts: [{ exitCode: "zero" }] },
      },
    };

    expect(() => validate(malformed)).not.toThrow();
    const result = validate(malformed);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("turns property-access failures into validation errors instead of throwing", () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("hostile property access");
        },
      },
    );

    expect(() => validate(hostile)).not.toThrow();
    expect(validate(hostile).valid).toBe(false);
  });
});

function runGit(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "release-evidence-repo-"));
  tempRoots.push(dir);
  runGit(dir, ["init", "-q"]);
  runGit(dir, ["config", "user.email", "release-evidence@example.com"]);
  runGit(dir, ["config", "user.name", "Release Evidence Test"]);
  runGit(dir, ["config", "commit.gpgsign", "false"]);
  return dir;
}

function write(dir: string, rel: string, content: string): void {
  const full = join(dir, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function seedRepo(dir: string): void {
  write(
    dir,
    "package.json",
    `${JSON.stringify({ name: "fixture", scripts: { test: "vitest run" } }, null, 2)}\n`,
  );
  write(dir, "package-lock.json", '{"lockfileVersion":3}\n');
  write(dir, "vitest.config.ts", "export default {};\n");
  write(dir, "vitest.projects.ts", "export const projects = [];\n");
  write(dir, "tests/scripts/run.ts", "export const run = 1;\n");
  write(dir, "tests/evals/cases/a.eval.ts", "export const a = 1;\n");
}

function commitAll(dir: string, message: string): void {
  runGit(dir, ["add", "-A"]);
  runGit(dir, ["commit", "-q", "-m", message]);
}

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

describe("fingerprintCandidate", () => {
  it("returns the exact HEAD commit and stable, well-formed digests", () => {
    const dir = makeRepo();
    seedRepo(dir);
    commitAll(dir, "init");
    const head = runGit(dir, ["rev-parse", "HEAD"]).trim();

    const identity = fingerprintCandidate(dir);

    expect(identity.commit).toBe(head);
    expect(identity.sourceDigest).toMatch(DIGEST_PATTERN);
    expect(identity.lockDigest).toMatch(DIGEST_PATTERN);
    expect(identity.policyDigest).toMatch(DIGEST_PATTERN);
    expect(fingerprintCandidate(dir)).toEqual(identity);
  });

  it("throws on a modified tracked file", () => {
    const dir = makeRepo();
    seedRepo(dir);
    commitAll(dir, "init");
    write(
      dir,
      "package.json",
      '{"name":"fixture","scripts":{"test":"vitest run","lint":"biome"}}\n',
    );

    expect(() => fingerprintCandidate(dir)).toThrow(/clean working tree/i);
  });

  it("throws on an untracked non-ignored file", () => {
    const dir = makeRepo();
    seedRepo(dir);
    commitAll(dir, "init");
    write(dir, "stray.txt", "left behind\n");

    expect(() => fingerprintCandidate(dir)).toThrow(/clean working tree/i);
  });

  it("allows ignored evidence artifacts", () => {
    const dir = makeRepo();
    seedRepo(dir);
    write(dir, ".gitignore", "evidence/\n.tmp/\n");
    commitAll(dir, "init");
    write(dir, "evidence/run.json", '{"status":"passed"}\n');
    write(dir, ".tmp/scratch", "scratch\n");

    expect(() => fingerprintCandidate(dir)).not.toThrow();
  });

  it("throws when the root is not a git repository", () => {
    const dir = mkdtempSync(join(tmpdir(), "release-evidence-nongit-"));
    tempRoots.push(dir);

    expect(() => fingerprintCandidate(dir)).toThrow();
  });

  it("throws for an invalid root argument", () => {
    expect(() => fingerprintCandidate("")).toThrow();
  });

  it("changes sourceDigest when tracked content changes", () => {
    const dir = makeRepo();
    seedRepo(dir);
    commitAll(dir, "init");
    const before = fingerprintCandidate(dir);

    write(dir, "tests/scripts/run.ts", "export const run = 2;\n");
    commitAll(dir, "change runner");
    const after = fingerprintCandidate(dir);

    expect(after.sourceDigest).not.toBe(before.sourceDigest);
    expect(after.commit).not.toBe(before.commit);
  });

  it("changes lockDigest when package-lock changes", () => {
    const dir = makeRepo();
    seedRepo(dir);
    commitAll(dir, "init");
    const before = fingerprintCandidate(dir);

    write(dir, "package-lock.json", '{"lockfileVersion":3,"packages":{}}\n');
    commitAll(dir, "update lockfile");
    const after = fingerprintCandidate(dir);

    expect(after.lockDigest).not.toBe(before.lockDigest);
  });

  it("changes policyDigest when package scripts change", () => {
    const dir = makeRepo();
    seedRepo(dir);
    commitAll(dir, "init");
    const before = fingerprintCandidate(dir);

    write(
      dir,
      "package.json",
      `${JSON.stringify({ name: "fixture", scripts: { test: "vitest run", lint: "biome ci ." } }, null, 2)}\n`,
    );
    commitAll(dir, "add lint script");
    const after = fingerprintCandidate(dir);

    expect(after.policyDigest).not.toBe(before.policyDigest);
  });

  it("changes policyDigest when an eval manifest changes", () => {
    const dir = makeRepo();
    seedRepo(dir);
    commitAll(dir, "init");
    const before = fingerprintCandidate(dir);

    write(dir, "tests/evals/cases/a.eval.ts", "export const a = 2;\n");
    commitAll(dir, "change eval case");
    const after = fingerprintCandidate(dir);

    expect(after.policyDigest).not.toBe(before.policyDigest);
  });

  it("never embeds tracked source content in the returned identity", () => {
    const dir = makeRepo();
    seedRepo(dir);
    write(dir, "tests/scripts/marker.ts", "export const MARKER = 'SOURCE-SECRET-MARKER';\n");
    commitAll(dir, "init");

    const identity = fingerprintCandidate(dir);

    expect(JSON.stringify(identity)).not.toContain("SOURCE-SECRET-MARKER");
  });

  it("fails closed on a tracked .env credential file without echoing it", () => {
    const dir = makeRepo();
    seedRepo(dir);
    write(dir, ".env", "PROVIDER_API_KEY=super-secret-value\n");
    commitAll(dir, "init");

    let message = "";
    try {
      fingerprintCandidate(dir);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toMatch(/credential|secret/i);
    expect(message).not.toContain("super-secret-value");
    expect(message).not.toContain(".env");
  });

  it("fails closed on a tracked private key file", () => {
    const dir = makeRepo();
    seedRepo(dir);
    write(dir, "certs/release.pem", "-----BEGIN PRIVATE KEY-----\nsecret\n");
    commitAll(dir, "init");

    expect(() => fingerprintCandidate(dir)).toThrow(/credential|secret/i);
  });

  it("hashes the documented .env.example template as tracked nonsecret content", () => {
    const dir = makeRepo();
    seedRepo(dir);
    write(dir, ".npmrc", "engine-strict=true\n");
    write(dir, ".env.example", "# OPENCANDLE_EXAMPLE=allowed\n");
    commitAll(dir, "init");

    const withExample = fingerprintCandidate(dir);
    expect(withExample.sourceDigest).toMatch(DIGEST_PATTERN);

    // The example template is real tracked content, so editing it must move the
    // source digest rather than being silently ignored as a redacted constant.
    write(dir, ".env.example", "# OPENCANDLE_EXAMPLE=changed\n");
    commitAll(dir, "update example template");
    const changed = fingerprintCandidate(dir);
    expect(changed.sourceDigest).not.toBe(withExample.sourceDigest);
    expect(JSON.stringify(changed)).not.toContain("OPENCANDLE_EXAMPLE");
  });

  it("rejects an actual .env even when the documented .env.example template is present", () => {
    const dir = makeRepo();
    seedRepo(dir);
    write(dir, ".npmrc", "engine-strict=true\n");
    write(dir, ".env.example", "# OPENCANDLE_EXAMPLE=allowed\n");
    write(dir, ".env", "PROVIDER_API_KEY=super-secret-value\n");
    commitAll(dir, "init");

    let message = "";
    try {
      fingerprintCandidate(dir);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toMatch(/credential|secret/i);
    expect(message).not.toContain("super-secret-value");
    expect(message).not.toContain(".env");
  });

  it("does not follow tracked symlinks into external files", () => {
    const outsideDir = mkdtempSync(join(tmpdir(), "release-evidence-outside-"));
    tempRoots.push(outsideDir);
    const outsideFile = join(outsideDir, "outside-secret.txt");
    writeFileSync(outsideFile, "OUTSIDE-SECRET-CONTENT");

    const dir = makeRepo();
    seedRepo(dir);
    symlinkSync(outsideFile, join(dir, "tracked-link"));
    commitAll(dir, "init");

    const identity = fingerprintCandidate(dir);
    expect(JSON.stringify(identity)).not.toContain("OUTSIDE-SECRET-CONTENT");

    writeFileSync(outsideFile, "OUTSIDE-SECRET-CONTENT-CHANGED");
    const after = fingerprintCandidate(dir);
    expect(after.sourceDigest).toBe(identity.sourceDigest);
  });
});
