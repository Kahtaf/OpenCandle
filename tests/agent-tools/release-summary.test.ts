import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { fingerprintCandidate } from "../../scripts/release-evidence.mjs";
import {
  buildReleaseSummary,
  parseSummaryArgs,
  providerSummaryProblems,
  writeReleaseSummary,
} from "../../scripts/release-summary.mjs";
import realProviderSummary from "../fixtures/provider-release/core-AAPL-summary.json";

const tempRoots: string[] = [];
const NOW = Date.parse("2026-09-24T12:00:00.000Z");
const RECENT = "2026-09-24T11:30:00.000Z";
const EARLIER = "2026-09-24T10:00:00.000Z";
const STALE = "2026-09-23T06:00:00.000Z";
const FUTURE = "2026-09-24T23:00:00.000Z";

// Small valid checked-in policy: core -> full -> release, exercised end to end.
const POLICY = {
  core: ["check"],
  full: ["check", "test"],
  release: ["check", "test", "test:gui:integration"],
};
const POLICY_CONTENT = `${JSON.stringify(POLICY, null, 2)}\n`;
const POLICY_DIGEST = `sha256:${createHash("sha256").update(POLICY_CONTENT).digest("hex")}`;

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function write(dir: string, rel: string, content: string): void {
  const full = join(dir, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

function writeJson(dir: string, rel: string, value: unknown): void {
  write(dir, rel, `${JSON.stringify(value, null, 2)}\n`);
}

interface CandidateRepo {
  root: string;
  commit: string;
  name: string;
  version: string;
}

function makeCandidate(): CandidateRepo {
  const root = mkdtempSync(join(tmpdir(), "release-summary-"));
  tempRoots.push(root);
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test"]);
  git(root, ["config", "commit.gpgsign", "false"]);
  const name = "opencandle";
  const version = "0.15.0";
  write(root, ".gitignore", "validation-output/\ncoverage/\n");
  write(root, "package.json", `${JSON.stringify({ name, version, scripts: {} }, null, 2)}\n`);
  write(root, "package-lock.json", '{"lockfileVersion":3}\n');
  write(root, "scripts/test-gate-policy.json", POLICY_CONTENT);
  write(root, "src/index.ts", "export const value = 1;\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "init"]);
  return { root, commit: git(root, ["rev-parse", "HEAD"]), name, version };
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function policySteps(gate: "core" | "release"): Array<Record<string, unknown>> {
  return POLICY[gate].map((step) => ({ step, status: 0, signal: null, durationMs: 7 }));
}

function seedGate(
  repo: CandidateRepo,
  {
    gate = "release",
    overall = "passed",
    startedAt = RECENT,
    candidate,
    steps,
    policyDigest,
    headChanged = false,
    failedStep,
    name = "run-1",
  }: {
    gate?: "core" | "release";
    overall?: string;
    startedAt?: string;
    candidate?: string;
    steps?: Array<Record<string, unknown>>;
    policyDigest?: string;
    headChanged?: boolean;
    failedStep?: string | null;
    name?: string;
  } = {},
): void {
  const commit = candidate ?? repo.commit;
  const chosen = steps ?? (gate === "release" ? policySteps("release") : policySteps("core"));
  const derivedFailed =
    failedStep === undefined
      ? ((chosen.find((step) => step.status !== 0)?.step as string | undefined) ?? null)
      : failedStep;
  writeJson(repo.root, `validation-output/gates/${name}.json`, {
    schemaVersion: 1,
    gate,
    candidateCommit: commit,
    headBefore: commit,
    headAfter: headChanged ? "f".repeat(40) : commit,
    headChanged,
    insideWorkTree: true,
    node: "v22.23.0",
    platform: "darwin-arm64",
    startedAt,
    finishedAt: startedAt,
    policyDigest: policyDigest ?? POLICY_DIGEST,
    steps: chosen,
    failedStep: derivedFailed,
    overall,
  });
}

function seedProvider(
  repo: CandidateRepo,
  {
    failed = false,
    candidate,
    startedAt,
    finishedAt = RECENT,
    mutate,
    runId = "run-1",
  }: {
    failed?: boolean;
    candidate?: string;
    startedAt?: string;
    finishedAt?: string;
    mutate?: (summary: any) => void;
    runId?: string;
  } = {},
): void {
  const summary: any = {
    runId,
    candidateCommit: candidate ?? repo.commit,
    startedAt: startedAt ?? finishedAt,
    finishedAt,
    scope: "core",
    symbol: "AAPL",
    provider: "yahoo",
    fixtureVersion: "none",
    strict: true,
    timedOut: false,
    fatal: false,
    totals: {
      total: 2,
      passed: failed ? 1 : 2,
      failed: failed ? 1 : 0,
      skipped: 0,
      corePassed: failed ? 1 : 2,
      coreSkipped: 0,
      optionalSkipped: 0,
    },
    cases: [
      {
        name: "get_stock_quote:AAPL",
        status: failed ? "failed" : "passed",
        durationMs: 5,
        provider: "yahoo",
        fixtureVersion: "none",
      },
      {
        name: "get_stock_history:AAPL",
        status: "passed",
        durationMs: 5,
        provider: "yahoo",
        fixtureVersion: "none",
      },
    ],
  };
  mutate?.(summary);
  writeJson(repo.root, `validation-output/provider-release/${runId}/summary.json`, summary);
}

function requiredSuite(startedAt: string): Record<string, unknown> {
  return {
    cases: [{ id: "case-1", status: "passed" }],
    attempts: [{ exitCode: 0, startedAt, finishedAt: startedAt }],
  };
}

interface SeedEvalOptions {
  exitCode?: number;
  candidate?: { commit?: string; sourceDigest?: string; lockDigest?: string } | null;
  startedAt?: string;
  mutateEvidence?: (evidence: any) => void;
  mutateSummary?: (summary: any) => void;
  mutateStartup?: (startup: any) => void;
  runId?: string;
  omitStartup?: boolean;
  omitSummary?: boolean;
}

/** v2 candidate-scoped run: startup manifest + final summary + evidence. */
function seedEvals(repo: CandidateRepo, options: SeedEvalOptions = {}): void {
  const {
    exitCode = 0,
    candidate,
    startedAt = RECENT,
    mutateEvidence,
    mutateSummary,
    mutateStartup,
    runId = "run-1",
    omitStartup = false,
  } = options;
  const identity = fingerprintCandidate(repo.root);
  const candidateIdentity = candidate === null ? null : { ...identity, ...(candidate ?? {}) };
  const runDir = `validation-output/release-evals/v2/${candidateIdentity?.commit ?? "unknown"}/${runId}`;
  if (!omitStartup) {
    const startup: any = {
      format: "release-eval-evidence-v2",
      schemaVersion: 2,
      runId,
      candidate: candidateIdentity,
      startedAt,
    };
    mutateStartup?.(startup);
    writeJson(repo.root, `${runDir}/release-eval-startup.json`, startup);
  }
  if (exitCode === 0) {
    const evidence: any = {
      schemaVersion: 1,
      candidate: candidateIdentity,
      startedAt,
      finishedAt: startedAt,
      suites: {
        "router-live": requiredSuite(startedAt),
        cases: requiredSuite(startedAt),
        product: requiredSuite(startedAt),
        "competitive:frozen": requiredSuite(startedAt),
      },
    };
    mutateEvidence?.(evidence);
    writeJson(repo.root, `${runDir}/release-evidence.json`, evidence);
  } else {
    const incomplete: any = {
      candidate: candidateIdentity,
      startedAt,
      finishedAt: startedAt,
      problems: ["suite failed"],
    };
    mutateEvidence?.(incomplete);
    writeJson(repo.root, `${runDir}/release-eval-incomplete.json`, incomplete);
  }
  const summary: any = {
    format: "release-eval-evidence-v2",
    schemaVersion: 2,
    candidate: candidateIdentity,
    runId,
    startedAt,
    finishedAt: startedAt,
    exitCode,
    evidencePath: exitCode === 0 ? `${runDir}/release-evidence.json` : null,
    incompletePath: exitCode === 0 ? null : `${runDir}/release-eval-incomplete.json`,
    attemptsPath: `${runDir}/attempts.jsonl`,
    requiredSuites: ["router-live", "cases", "product", "competitive:frozen"],
    notRunSuites: [],
    optionalSkips: [],
    suiteSettings: {
      cases: { provider: "openai", model: "gpt-6" },
      "competitive:frozen": { provider: "openai", model: "gpt-6", judge: "openai/gpt-6-luna" },
    },
    competitors: null,
    competitorsKnown: false,
  };
  mutateSummary?.(summary);
  writeJson(repo.root, `${runDir}/release-eval-summary.json`, summary);
}

/** Crash-safety directory: startup manifest only, no final summary. */
function seedInterruptedV2(
  repo: CandidateRepo,
  { commit = repo.commit, runId = "run-interrupted" }: { commit?: string; runId?: string } = {},
): void {
  const identity = { ...fingerprintCandidate(repo.root), commit };
  writeJson(
    repo.root,
    `validation-output/release-evals/v2/${commit}/${runId}/release-eval-startup.json`,
    {
      format: "release-eval-evidence-v2",
      schemaVersion: 2,
      runId,
      candidate: identity,
      startedAt: RECENT,
    },
  );
}

/** Pre-cutover unscoped run, retained untouched for historical reporting. */
function seedLegacyEvals(repo: CandidateRepo, options: SeedEvalOptions = {}): void {
  const {
    exitCode = 0,
    candidate,
    startedAt = RECENT,
    mutateEvidence,
    mutateSummary,
    runId = "legacy-run",
    omitSummary = false,
  } = options;
  const runDir = `validation-output/release-evals/${runId}`;
  const baseIdentity = fingerprintCandidate(repo.root);
  const identity = candidate === null ? null : { ...baseIdentity, ...(candidate ?? {}) };
  if (exitCode === 0) {
    const evidence: any = {
      schemaVersion: 1,
      candidate: identity,
      startedAt,
      finishedAt: startedAt,
      suites: {
        "router-live": requiredSuite(startedAt),
        cases: requiredSuite(startedAt),
        product: requiredSuite(startedAt),
        "competitive:frozen": requiredSuite(startedAt),
      },
    };
    mutateEvidence?.(evidence);
    writeJson(repo.root, `${runDir}/release-evidence.json`, evidence);
  } else {
    const incomplete: any = {
      candidate: identity,
      startedAt,
      finishedAt: startedAt,
      problems: ["suite failed"],
    };
    mutateEvidence?.(incomplete);
    writeJson(repo.root, `${runDir}/release-eval-incomplete.json`, incomplete);
  }
  if (omitSummary) return;
  const summary: any = {
    runId,
    startedAt,
    finishedAt: startedAt,
    exitCode,
    evidencePath: exitCode === 0 ? `${runDir}/release-evidence.json` : null,
    incompletePath: exitCode === 0 ? null : `${runDir}/release-eval-incomplete.json`,
    attemptsPath: `${runDir}/attempts.jsonl`,
    requiredSuites: ["router-live", "cases", "product", "competitive:frozen"],
    optionalSkips: [],
    suiteSettings: {
      cases: { provider: "openai", model: "gpt-6" },
      "competitive:frozen": { provider: "openai", model: "gpt-6", judge: "openai/gpt-6-luna" },
    },
    competitors: null,
    competitorsKnown: false,
  };
  mutateSummary?.(summary);
  writeJson(repo.root, `${runDir}/release-eval-summary.json`, summary);
}

function seedPackage(
  repo: CandidateRepo,
  { tamperSha = false, testedAt = RECENT }: { tamperSha?: boolean; testedAt?: string } = {},
): void {
  const dir = "validation-output/release-package";
  const tarball = `${repo.name}-${repo.version}.tgz`;
  const bytes = Buffer.from("fake tarball bytes");
  mkdirSync(join(repo.root, dir), { recursive: true });
  writeFileSync(join(repo.root, dir, tarball), bytes);
  writeJson(repo.root, `${dir}/package-proof.json`, {
    schemaVersion: 1,
    candidateCommit: repo.commit,
    packageName: repo.name,
    packageVersion: repo.version,
    tarball,
    sha256: tamperSha ? "0".repeat(64) : sha256(bytes),
    testedAt,
    node: "22.23.0",
    platform: "darwin",
    smokePassed: true,
  });
}

function seedCoverage(repo: CandidateRepo): void {
  writeJson(repo.root, "coverage/coverage-summary.json", {
    total: {
      lines: { total: 100, covered: 90, pct: 90 },
      functions: { total: 20, covered: 18, pct: 90 },
      branches: { total: 40, covered: 30, pct: 75 },
      statements: { total: 100, covered: 91, pct: 91 },
    },
  });
}

/**
 * Seed every artifact for one candidate. Unit tests pin the injected clock to
 * `NOW`, so their default `RECENT` fixtures stay fixed and deterministic. The
 * real CLI test overrides the reference with its own invocation time: the CLI
 * reads `Date.now()` and enforces a 24h freshness window, so a frozen fixture
 * date would silently expire the day after it was written.
 */
function seedAll(repo: CandidateRepo, startedAt = RECENT): void {
  seedGate(repo, { startedAt });
  seedProvider(repo, { startedAt, finishedAt: startedAt });
  seedEvals(repo, { startedAt });
  seedPackage(repo, { testedAt: startedAt });
  seedCoverage(repo);
}

function build(repo: CandidateRepo, options: Record<string, unknown> = {}) {
  return buildReleaseSummary({
    root: repo.root,
    packageDir: join(repo.root, "validation-output/release-package"),
    now: NOW,
    ...options,
  });
}

describe("parseSummaryArgs", () => {
  it("defaults to validation-output/release and rejects paths outside it", () => {
    expect(parseSummaryArgs([], { cwd: "/repo" })).toMatchObject({
      ok: true,
      relativePackageDir: "validation-output/release",
    });
    expect(
      parseSummaryArgs(["--package-dir", "validation-output/release-package"], { cwd: "/repo" }).ok,
    ).toBe(true);
    expect(parseSummaryArgs(["--package-dir", "../etc"], { cwd: "/repo" }).ok).toBe(false);
    expect(parseSummaryArgs(["--package-dir", "/tmp/outside"], { cwd: "/repo" }).ok).toBe(false);
    expect(parseSummaryArgs(["--bogus"], { cwd: "/repo" }).ok).toBe(false);
    expect(parseSummaryArgs(["--package-dir"], { cwd: "/repo" }).ok).toBe(false);
  });
});

describe("buildReleaseSummary", () => {
  it("aggregates a passing exact candidate into a bounded descriptive summary", () => {
    const repo = makeCandidate();
    seedAll(repo);

    const result = build(repo);

    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    const summary = result.summary as any;
    expect(summary).toMatchObject({
      schemaVersion: 1,
      kind: "release-summary",
      descriptiveOnly: true,
      releaseAuthorization: false,
      waiver: null,
    });
    expect(summary.candidate.commit).toBe(repo.commit);
    expect(summary.package).toMatchObject({
      name: repo.name,
      version: repo.version,
      tarball: `${repo.name}-${repo.version}.tgz`,
    });
    expect(summary.deterministicGate.steps.map((s: any) => s.name)).toEqual(POLICY.release);
    expect(summary.deterministicGate.policyDigest).toBe(POLICY_DIGEST);
    expect(summary.coverage).toMatchObject({ available: true, label: "gate-derived" });
    expect(summary.releaseEvals.completedSuites).toBe(4);
    expect(summary.releaseEvals.models).toEqual({
      cases: { provider: "openai", model: "gpt-6" },
      "competitive:frozen": { provider: "openai", model: "gpt-6", judge: "openai/gpt-6-luna" },
    });
    expect(summary.providerRelease.totals).toMatchObject({ passed: 2, failed: 0, skipped: 0 });
    expect(summary.unmeasured).toMatchObject({
      childProcess: true,
      webContainer: true,
      releaseEnvironmentProtection: "externally-unverified",
    });
    expect(result.markdown).toContain(repo.commit);
    expect(result.markdown).toMatch(/descriptive/i);
    expect(result.markdown).toMatch(/attempt\(s\), 0 failed/);
    expect(JSON.stringify(summary)).not.toMatch(/sk-|api[_-]?key|token/i);
  });

  it("ignores a later diagnostic core gate report and uses the matching release report", () => {
    const repo = makeCandidate();
    seedGate(repo, { startedAt: EARLIER });
    seedGate(repo, { gate: "core", startedAt: RECENT, name: "core-run" });
    seedProvider(repo);
    seedEvals(repo);
    seedPackage(repo);

    const result = build(repo);

    expect(result.ok).toBe(true);
  });

  it("rejects when only a diagnostic core gate report exists", () => {
    const repo = makeCandidate();
    seedGate(repo, { gate: "core", name: "core-run" });
    seedProvider(repo);
    seedEvals(repo);
    seedPackage(repo);

    const result = build(repo);

    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/release gate report/i);
  });

  it("refreshes expired successes with a newer fresh run while preserving attempt history", () => {
    const repo = makeCandidate();
    seedGate(repo, { startedAt: STALE, name: "gate-old" });
    seedGate(repo, { startedAt: RECENT, name: "gate-new" });
    seedProvider(repo, { startedAt: STALE, finishedAt: STALE, runId: "provider-old" });
    seedProvider(repo, { startedAt: RECENT, finishedAt: RECENT, runId: "provider-new" });
    seedEvals(repo, { startedAt: STALE, runId: "evals-old" });
    seedEvals(repo, { startedAt: RECENT, runId: "evals-new" });
    seedPackage(repo);
    seedCoverage(repo);

    const result = build(repo);

    expect(result.ok).toBe(true);
    const summary = result.summary as any;
    expect(summary.deterministicGate.attempts.map((attempt: any) => attempt.overall)).toEqual([
      "passed",
      "passed",
    ]);
    expect(summary.providerRelease.attempts).toHaveLength(2);
    expect(summary.releaseEvals.attempts).toHaveLength(2);
    expect(result.markdown).toMatch(/2 attempt\(s\), 0 failed/);
  });

  it("still blocks when an expired attempt failed even though a fresh attempt passed", () => {
    const repo = makeCandidate();
    seedGate(repo, { overall: "failed", startedAt: STALE, name: "gate-old" });
    seedGate(repo, { overall: "passed", startedAt: RECENT, name: "gate-new" });
    seedProvider(repo, { startedAt: RECENT, finishedAt: RECENT });
    seedEvals(repo, { startedAt: RECENT });
    seedPackage(repo);

    const result = build(repo);

    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/failed/i);
  });

  it("rejects a stale release gate report outside the freshness window", () => {
    const repo = makeCandidate();
    seedGate(repo, { startedAt: STALE });
    seedProvider(repo);
    seedEvals(repo);
    seedPackage(repo);

    const result = build(repo);

    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/stale|future/i);
  });

  it("rejects a candidate mismatch even when every other item is fresh", () => {
    const repo = makeCandidate();
    seedGate(repo, { candidate: "f".repeat(40) });
    seedProvider(repo);
    seedEvals(repo);
    seedPackage(repo);

    const result = build(repo);

    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/candidate/i);
  });

  it("rejects a release gate report whose policy digest is not the checked-in policy", () => {
    const repo = makeCandidate();
    seedGate(repo, { policyDigest: `sha256:${"a".repeat(64)}` });
    seedProvider(repo);
    seedEvals(repo);
    seedPackage(repo);

    const result = build(repo);

    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/policy/i);
  });

  it("rejects a release gate report whose steps are reordered or incomplete", () => {
    const repo = makeCandidate();
    const reordered = policySteps("release");
    reordered.reverse();
    seedGate(repo, { steps: reordered });
    seedProvider(repo);
    seedEvals(repo);
    seedPackage(repo);

    const result = build(repo);

    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/step/i);
  });

  it("rejects a gate that claims passed while a step exited non-zero", () => {
    const repo = makeCandidate();
    const steps = policySteps("release");
    steps[1] = { step: "test", status: 1, signal: null, durationMs: 7 };
    seedGate(repo, { overall: "passed", steps, failedStep: null });
    seedProvider(repo);
    seedEvals(repo);
    seedPackage(repo);

    const result = build(repo);

    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/step.*(failed|non-zero)|(failed|non-zero).*step/i);
  });

  it("rejects a gate report where HEAD moved during the run", () => {
    const repo = makeCandidate();
    seedGate(repo, { headChanged: true });
    seedProvider(repo);
    seedEvals(repo);
    seedPackage(repo);

    const result = build(repo);

    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/head/i);
  });

  it("rejects a failed attempt even when a later release gate attempt passed", () => {
    const repo = makeCandidate();
    seedGate(repo, { overall: "failed", startedAt: EARLIER, name: "run-1" });
    seedGate(repo, { overall: "passed", startedAt: RECENT, name: "run-2" });
    seedProvider(repo);
    seedEvals(repo);
    seedPackage(repo);

    const result = build(repo);

    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/attempt|failed/i);
  });

  it("rejects the latest failed release gate attempt without hiding attempts", () => {
    const repo = makeCandidate();
    seedGate(repo, { overall: "passed", startedAt: EARLIER, name: "run-1" });
    seedGate(repo, { overall: "failed", startedAt: RECENT, name: "run-2" });
    seedProvider(repo);
    seedEvals(repo);
    seedPackage(repo);

    const result = build(repo);

    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/failed/i);
  });

  it("rejects a provider summary that is missing totals or the required core cases", () => {
    for (const mutate of [
      (summary: any) => {
        delete summary.totals;
      },
      (summary: any) => {
        summary.cases = [];
      },
      (summary: any) => {
        summary.cases[0].status = "skipped";
      },
      (summary: any) => {
        summary.totals.passed = 0;
        summary.totals.failed = 0;
        summary.totals.total = 0;
        summary.cases = [];
      },
    ]) {
      const repo = makeCandidate();
      seedGate(repo);
      seedProvider(repo, { mutate });
      seedEvals(repo);
      seedPackage(repo);

      const result = build(repo);

      expect(result.ok).toBe(false);
      expect(result.errors.join("\n")).toMatch(/provider/i);
    }
  });

  it("rejects a provider summary that is not the strict core shape", () => {
    for (const mutate of [
      (summary: any) => {
        summary.strict = false;
      },
      (summary: any) => {
        summary.fatal = true;
      },
      (summary: any) => {
        summary.scope = "full";
      },
      (summary: any) => {
        summary.cases[0].name = "get_stock_quote:MSFT";
      },
    ]) {
      const repo = makeCandidate();
      seedGate(repo);
      seedProvider(repo, { mutate });
      seedEvals(repo);
      seedPackage(repo);

      const result = build(repo);

      expect(result.ok).toBe(false);
      expect(result.errors.join("\n")).toMatch(/provider/i);
    }
  });

  it("rejects an earlier failed provider or eval attempt even when a later one passed", () => {
    const providerRepo = makeCandidate();
    seedGate(providerRepo);
    seedProvider(providerRepo, {
      failed: true,
      startedAt: EARLIER,
      finishedAt: EARLIER,
      runId: "run-1",
    });
    seedProvider(providerRepo, { startedAt: RECENT, runId: "run-2" });
    seedEvals(providerRepo);
    seedPackage(providerRepo);
    expect(build(providerRepo).ok).toBe(false);

    const evalRepo = makeCandidate();
    seedGate(evalRepo);
    seedProvider(evalRepo);
    seedEvals(evalRepo, { exitCode: 1, startedAt: EARLIER, runId: "run-1" });
    seedEvals(evalRepo, { exitCode: 0, startedAt: RECENT, runId: "run-2" });
    seedPackage(evalRepo);
    expect(build(evalRepo).ok).toBe(false);
  });

  it("rejects a latest failed provider smoke and preserves attempts", () => {
    const repo = makeCandidate();
    seedGate(repo);
    seedProvider(repo, { failed: true });
    seedEvals(repo);
    seedPackage(repo);

    const result = build(repo);

    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/provider/i);
  });

  it("rejects eval evidence missing a candidate fingerprint field", () => {
    const repo = makeCandidate();
    seedGate(repo);
    seedProvider(repo);
    seedEvals(repo, {
      mutateEvidence: (evidence) => {
        evidence.candidate.sourceDigest = "sha256:deadbeef";
      },
    });
    seedPackage(repo);

    const result = build(repo);

    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/candidate|digest/i);
  });

  it("rejects an eval run whose required suite is empty, skipped, or missing attempts", () => {
    for (const mutate of [
      (evidence: any) => {
        evidence.suites.cases.cases = [];
      },
      (evidence: any) => {
        evidence.suites.product.cases[0].status = "skipped";
      },
      (evidence: any) => {
        delete evidence.suites["competitive:frozen"].attempts;
      },
      (evidence: any) => {
        evidence.suites["router-live"].attempts[0].exitCode = 1;
      },
      (evidence: any) => {
        delete evidence.suites["competitive:frozen"];
      },
    ]) {
      const repo = makeCandidate();
      seedGate(repo);
      seedProvider(repo);
      seedEvals(repo, { mutateEvidence: mutate });
      seedPackage(repo);

      const result = build(repo);

      expect(result.ok).toBe(false);
      expect(result.errors.join("\n")).toMatch(/suite|attempt|eval/i);
    }
  });

  it("rejects an incomplete eval run and future-dated eval evidence", () => {
    const incomplete = makeCandidate();
    seedGate(incomplete);
    seedProvider(incomplete);
    seedEvals(incomplete, { exitCode: 1 });
    seedPackage(incomplete);
    expect(build(incomplete).errors.join("\n")).toMatch(/eval/i);

    const future = makeCandidate();
    seedGate(future);
    seedProvider(future);
    seedEvals(future, { startedAt: FUTURE });
    seedPackage(future);
    expect(build(future).ok).toBe(false);
    expect(build(future).errors.join("\n")).toMatch(/future|stale/i);
  });

  it("rejects unknown or unbounded eval settings and malformed competitors", () => {
    const unknownSetting = makeCandidate();
    seedGate(unknownSetting);
    seedProvider(unknownSetting);
    seedEvals(unknownSetting, {
      mutateSummary: (summary) => {
        summary.suiteSettings = { cases: { provider: "openai", apiKey: "leak" } };
      },
    });
    seedPackage(unknownSetting);
    const unknownResult = build(unknownSetting);
    expect(unknownResult.ok).toBe(false);
    expect(unknownResult.errors.join("\n")).toMatch(/setting/i);
    expect(unknownResult.errors.join("\n")).not.toContain("leak");

    const longSetting = makeCandidate();
    seedGate(longSetting);
    seedProvider(longSetting);
    seedEvals(longSetting, {
      mutateSummary: (summary) => {
        summary.suiteSettings = { cases: { model: "m".repeat(300) } };
      },
    });
    seedPackage(longSetting);
    expect(build(longSetting).ok).toBe(false);

    const badCompetitor = makeCandidate();
    seedGate(badCompetitor);
    seedProvider(badCompetitor);
    seedEvals(badCompetitor, {
      mutateSummary: (summary) => {
        summary.competitors = [{ id: "claude", reason: "rate limited", extra: "raw" }];
        summary.competitorsKnown = true;
      },
    });
    seedPackage(badCompetitor);
    const competitorResult = build(badCompetitor);
    expect(competitorResult.ok).toBe(false);
    expect(competitorResult.errors.join("\n")).toMatch(/competitor/i);
  });

  it("rejects a package proof whose hash does not match the artifact", () => {
    const repo = makeCandidate();
    seedGate(repo);
    seedProvider(repo);
    seedEvals(repo);
    seedPackage(repo, { tamperSha: true });

    const result = build(repo);

    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/package/i);
  });

  it("fails closed on malformed JSON instead of throwing", () => {
    const repo = makeCandidate();
    write(repo.root, "validation-output/gates/broken.json", "{not json");
    seedProvider(repo);
    seedEvals(repo);
    seedPackage(repo);

    expect(() => build(repo)).not.toThrow();
    expect(build(repo).ok).toBe(false);
  });

  it("fails closed when the checked-in gate policy is missing", () => {
    const repo = makeCandidate();
    git(repo.root, ["rm", "-q", "scripts/test-gate-policy.json"]);
    git(repo.root, ["commit", "-q", "-m", "remove policy"]);
    repo.commit = git(repo.root, ["rev-parse", "HEAD"]);
    seedAll(repo);

    const result = build(repo);

    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/policy/i);
  });

  it("writes unique summary.json and summary.md without overwriting", () => {
    const repo = makeCandidate();
    seedAll(repo);

    const first = writeReleaseSummary({
      root: repo.root,
      packageDir: "validation-output/release-package",
      now: NOW,
    });
    const second = writeReleaseSummary({
      root: repo.root,
      packageDir: "validation-output/release-package",
      now: NOW + 1000,
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(first.dir).not.toBe(second.dir);
    expect(existsSync(join(first.dir as string, "summary.json"))).toBe(true);
    expect(existsSync(join(first.dir as string, "summary.md"))).toBe(true);
    expect(readdirSync(join(repo.root, "validation-output/release-summary")).length).toBe(2);
    const summary = JSON.parse(readFileSync(join(first.dir as string, "summary.json"), "utf8"));
    expect(summary.candidate.commit).toBe(repo.commit);
  });

  it("runs as a CLI and rejects unknown arguments", () => {
    const repo = makeCandidate();
    // The CLI ignores the test's injected clock and reads Date.now() directly,
    // so seed its fixtures relative to this invocation instead of RECENT.
    seedAll(repo, new Date(Date.now() - 30 * 60 * 1000).toISOString());
    const script = fileURLToPath(new URL("../../scripts/release-summary.mjs", import.meta.url));

    const run = spawnSync(
      process.execPath,
      [script, "--package-dir", "validation-output/release-package"],
      { cwd: repo.root, encoding: "utf8" },
    );
    expect(run.status).toBe(0);
    const base = join(repo.root, "validation-output/release-summary");
    const dirs = readdirSync(base);
    expect(dirs.length).toBe(1);
    expect(existsSync(join(base, dirs[0], "summary.json"))).toBe(true);
    expect(existsSync(join(base, dirs[0], "summary.md"))).toBe(true);

    const bad = spawnSync(process.execPath, [script, "--bogus"], {
      cwd: repo.root,
      encoding: "utf8",
    });
    expect(bad.status).toBe(1);
  });
});

describe("candidate-scoped v2 eval evidence selection", () => {
  it("accepts a passing candidate-scoped v2 run", () => {
    const repo = makeCandidate();
    seedAll(repo);

    const result = build(repo);

    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect((result.summary as any).releaseEvals.format).toBe("release-eval-evidence-v2");
  });

  it("blocks a current-candidate interrupted v2 run even when a later v2 run passed", () => {
    const repo = makeCandidate();
    seedGate(repo);
    seedProvider(repo);
    seedEvals(repo, { startedAt: RECENT, runId: "run-later" });
    seedInterruptedV2(repo, { runId: "run-interrupted" });
    seedPackage(repo);

    const result = build(repo);

    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/run-interrupted|startup|final summary/i);
  });

  it("does not let an interrupted run for another candidate or a legacy interrupted dir block", () => {
    const repo = makeCandidate();
    seedGate(repo);
    seedProvider(repo);
    seedEvals(repo, { startedAt: RECENT });
    seedPackage(repo);
    seedInterruptedV2(repo, { commit: "f".repeat(40), runId: "other-run" });
    mkdirSync(join(repo.root, "validation-output/release-evals/legacy-interrupted"), {
      recursive: true,
    });

    const result = build(repo);

    expect(result.ok).toBe(true);
  });

  it("blocks path/manifest/final identity mismatches", () => {
    for (const mutate of [
      (startup: any) => {
        startup.candidate = { ...startup.candidate, commit: "f".repeat(40) };
      },
      (startup: any) => {
        startup.runId = "some-other-run";
      },
    ]) {
      const repo = makeCandidate();
      seedGate(repo);
      seedProvider(repo);
      seedEvals(repo, { mutateStartup: mutate });
      seedPackage(repo);

      const result = build(repo);

      expect(result.ok).toBe(false);
      expect(result.errors.join("\n")).toMatch(/identity|runId|manifest|startup/i);
    }

    for (const mutate of [
      (summary: any) => {
        summary.candidate = { ...summary.candidate, sourceDigest: "sha256:deadbeef" };
      },
      (summary: any) => {
        summary.runId = "not-this-run";
      },
    ]) {
      const repo = makeCandidate();
      seedGate(repo);
      seedProvider(repo);
      seedEvals(repo, { mutateSummary: mutate });
      seedPackage(repo);

      const result = build(repo);

      expect(result.ok).toBe(false);
      expect(result.errors.join("\n")).toMatch(/identity|runId|summary|candidate/i);
    }
  });

  it("blocks a malformed current-candidate v2 run with no startup manifest", () => {
    const repo = makeCandidate();
    seedGate(repo);
    seedProvider(repo);
    seedEvals(repo);
    seedPackage(repo);
    writeJson(
      repo.root,
      `validation-output/release-evals/v2/${repo.commit}/no-manifest/release-eval-summary.json`,
      { format: "release-eval-evidence-v2", schemaVersion: 2, runId: "no-manifest" },
    );

    const result = build(repo);

    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/startup manifest/i);
  });

  it("requires fresh v2 proof and treats a legacy same-candidate success as ineligible", () => {
    const repo = makeCandidate();
    seedGate(repo);
    seedProvider(repo);
    seedLegacyEvals(repo, { startedAt: RECENT });
    seedPackage(repo);

    const result = build(repo);

    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/v2 release eval evidence/i);
  });

  it("still blocks a legacy same-candidate failed run even with fresh v2 proof", () => {
    const repo = makeCandidate();
    seedGate(repo);
    seedProvider(repo);
    seedEvals(repo, { startedAt: RECENT });
    seedLegacyEvals(repo, { exitCode: 1, startedAt: EARLIER, runId: "legacy-failed" });
    seedPackage(repo);

    const result = build(repo);

    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/legacy/i);
  });

  it("reports genuinely unattributed legacy records as unavailable history rather than blocking", () => {
    const repo = makeCandidate();
    seedGate(repo);
    seedProvider(repo);
    seedEvals(repo, { startedAt: RECENT });
    seedPackage(repo);
    write(
      repo.root,
      "validation-output/release-evals/legacy-broken/release-eval-summary.json",
      "{not json",
    );

    const result = build(repo);

    expect(result.ok).toBe(true);
    expect((result.summary as any).releaseEvals.legacyRecords.unavailable).toBeGreaterThan(0);
  });

  it("blocks an attributed legacy incomplete record even when its summary is missing or malformed", () => {
    for (const summaryState of ["missing", "malformed"]) {
      const repo = makeCandidate();
      seedGate(repo);
      seedProvider(repo);
      seedEvals(repo, { startedAt: RECENT });
      seedPackage(repo);
      seedLegacyEvals(repo, {
        exitCode: 1,
        startedAt: EARLIER,
        runId: "legacy-incomplete",
        omitSummary: true,
      });
      if (summaryState === "malformed") {
        write(
          repo.root,
          "validation-output/release-evals/legacy-incomplete/release-eval-summary.json",
          "{not json",
        );
      }

      const result = build(repo);

      expect(result.ok, summaryState).toBe(false);
      expect(result.errors.join("\n")).toMatch(/legacy/i);
    }
  });

  it("blocks a same-commit legacy success whose full fingerprint differs or evidence is invalid", () => {
    for (const mutateEvidence of [
      (evidence: any) => {
        evidence.candidate = { ...evidence.candidate, sourceDigest: "sha256:deadbeef" };
      },
      (evidence: any) => {
        evidence.suites.cases.cases[0].status = "failed";
      },
      (evidence: any) => {
        delete evidence.suites.product;
      },
    ]) {
      const repo = makeCandidate();
      seedGate(repo);
      seedProvider(repo);
      seedEvals(repo, { startedAt: RECENT });
      seedPackage(repo);
      seedLegacyEvals(repo, {
        startedAt: EARLIER,
        runId: "legacy-invalid",
        mutateEvidence,
      });

      const result = build(repo);

      expect(result.ok).toBe(false);
      expect(result.errors.join("\n")).toMatch(/legacy/i);
    }
  });

  it("distinguishes other known commit history from unattributed legacy records", () => {
    const repo = makeCandidate();
    seedGate(repo);
    seedProvider(repo);
    seedEvals(repo, { startedAt: RECENT });
    seedPackage(repo);
    seedLegacyEvals(repo, {
      startedAt: EARLIER,
      runId: "legacy-other",
      candidate: { commit: "f".repeat(40) },
    });
    write(
      repo.root,
      "validation-output/release-evals/legacy-broken/release-eval-summary.json",
      "{not json",
    );

    const result = build(repo);

    expect(result.ok).toBe(true);
    const legacyRecords = (result.summary as any).releaseEvals.legacyRecords;
    expect(legacyRecords.historical).toBeGreaterThanOrEqual(1);
    expect(legacyRecords.unavailable).toBeGreaterThanOrEqual(1);
  });
});

describe("real provider release summary shape", () => {
  // Verbatim copy of the producer artifact at
  // validation-output/provider-release/2026-09-24T18-52-18-889Z-51059/summary.json.
  const NOW_AFTER = Date.parse("2026-09-24T19:00:00.000Z");
  const WINDOW_MS = 24 * 60 * 60 * 1000;

  it("accepts the exact strict core summary the provider smoke emits", () => {
    expect(providerSummaryProblems(realProviderSummary, NOW_AFTER, WINDOW_MS)).toEqual([]);
  });

  it("rejects the real shape once a required case or total changes", () => {
    const failed = {
      ...realProviderSummary,
      totals: { ...realProviderSummary.totals, passed: 1, failed: 1 },
    };
    expect(providerSummaryProblems(failed, NOW_AFTER, WINDOW_MS).length).toBeGreaterThan(0);

    const skipped = {
      ...realProviderSummary,
      cases: realProviderSummary.cases.map((entry, index) =>
        index === 0 ? { ...entry, status: "skipped" } : entry,
      ),
    };
    expect(providerSummaryProblems(skipped, NOW_AFTER, WINDOW_MS).length).toBeGreaterThan(0);
  });
});
