import { readFileSync } from "node:fs";
import { join, matchesGlob } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  bumpSemver,
  compareSemver,
  parseReleaseArgs,
  runLocalRelease,
  validatePackageProof,
} from "../../../scripts/release-lib.mjs";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

interface HarnessStatuses {
  fetch: number;
  bump: number;
  commit: number;
  releaseCheck: number;
  pack: number;
  providerRelease: number;
  evals: number;
  summary: number;
  tag: number;
  reset: number;
  pushMain: number;
  pushTag: number;
}

interface HarnessState {
  clean: boolean;
  branch: string;
  head: string;
  parentSha: string;
  origin: string;
  version: string;
  parentVersion: string;
  subject: string;
  changedFiles: string[];
  changelog: string;
  statuses: HarnessStatuses;
}

const zeroStatuses: HarnessStatuses = {
  fetch: 0,
  bump: 0,
  commit: 0,
  releaseCheck: 0,
  pack: 0,
  providerRelease: 0,
  evals: 0,
  summary: 0,
  tag: 0,
  reset: 0,
  pushMain: 0,
  pushTag: 0,
};

function createHarness(
  initial: Partial<Omit<HarnessState, "statuses">> & { statuses?: Partial<HarnessStatuses> } = {},
) {
  const calls: string[] = [];
  const state: HarnessState = {
    clean: true,
    branch: "main",
    head: "c-parent",
    parentSha: "c-parent",
    origin: "c-parent",
    version: "1.2.3",
    parentVersion: "1.2.2",
    subject: "chore: base",
    changedFiles: [],
    changelog: "# Changelog\n\n## [Unreleased]\n\n- pending\n",
    ...initial,
    statuses: { ...zeroStatuses, ...(initial.statuses ?? {}) },
  };
  const deps = {
    log: (message: string) => calls.push(`log:${message}`),
    isWorkingTreeClean: () => state.clean,
    currentBranch: () => state.branch,
    headSha: () => state.head,
    originMainSha: () => state.origin,
    fetchOriginMain: () => {
      calls.push("fetchOriginMain");
      return state.statuses.fetch;
    },
    tagExists: (tag: string) => {
      calls.push(`tagExists:${tag}`);
      return false;
    },
    readVersion: () => state.version,
    runBump: (type: string) => {
      calls.push(`runBump:${type}`);
      if (state.statuses.bump === 0) state.version = bumpSemver(state.version, type);
      return state.statuses.bump;
    },
    markChangelogReleased: (version: string, date: string) => {
      calls.push(`markChangelogReleased:${version}`);
      state.changelog = state.changelog.replace("## [Unreleased]", `## [${version}] - ${date}`);
    },
    commitCandidate: (version: string) => {
      calls.push(`commitCandidate:${version}`);
      if (state.statuses.commit === 0) {
        state.head = "c-candidate";
        state.changedFiles = ["package.json", "package-lock.json", "CHANGELOG.md"];
      }
      return state.statuses.commit;
    },
    runReleaseCheck: () => {
      calls.push("runReleaseCheck");
      return state.statuses.releaseCheck;
    },
    runReleaseEvals: () => {
      calls.push("runReleaseEvals");
      return state.statuses.evals;
    },
    prepareReleasePackage: () => {
      calls.push("prepareReleasePackage");
      return state.statuses.pack;
    },
    runProviderReleaseSmoke: () => {
      calls.push("runProviderReleaseSmoke");
      return state.statuses.providerRelease;
    },
    writeReleaseSummary: () => {
      calls.push("writeReleaseSummary");
      return state.statuses.summary;
    },
    tagVersion: (tag: string) => {
      calls.push(`tagVersion:${tag}`);
      return state.statuses.tag;
    },
    addUnreleasedSection: () => calls.push("addUnreleasedSection"),
    commitChangelogReset: () => {
      calls.push("commitChangelogReset");
      return state.statuses.reset;
    },
    pushMain: () => {
      calls.push("pushMain");
      return state.statuses.pushMain;
    },
    pushTag: (tag: string) => {
      calls.push(`pushTag:${tag}`);
      return state.statuses.pushTag;
    },
    readHeadSubject: () => state.subject,
    readHeadParentSha: () => state.parentSha,
    readHeadChangedFiles: () => state.changedFiles,
    readVersionAt: () => state.parentVersion,
    readChangelog: () => state.changelog,
  };
  return { deps, state, calls };
}

function candidateHarness(overrides: Partial<HarnessState> = {}) {
  return createHarness({
    head: "c-candidate",
    parentSha: "c-parent",
    origin: "c-parent",
    version: "1.2.4",
    parentVersion: "1.2.3",
    subject: "Release v1.2.4",
    changedFiles: ["package.json", "package-lock.json", "CHANGELOG.md"],
    changelog: "# Changelog\n\n## [1.2.4] - 2026-06-01\n\n- item\n",
    ...overrides,
  });
}

function run(deps: unknown, options: Record<string, unknown> = {}) {
  return runLocalRelease({
    bumpType: "patch",
    resume: false,
    dryRun: false,
    deps,
    date: "2026-06-01",
    ...options,
  });
}

describe("release argument parsing", () => {
  it("accepts one bump type and the resume/dry-run flags", () => {
    expect(parseReleaseArgs(["patch"])).toEqual({
      ok: true,
      bumpType: "patch",
      resume: false,
      dryRun: false,
    });
    expect(parseReleaseArgs(["--dry-run", "minor"])).toEqual({
      ok: true,
      bumpType: "minor",
      resume: false,
      dryRun: true,
    });
    expect(parseReleaseArgs(["--resume"])).toEqual({
      ok: true,
      bumpType: null,
      resume: true,
      dryRun: false,
    });
    expect(parseReleaseArgs(["--resume", "--dry-run"])).toEqual({
      ok: true,
      bumpType: null,
      resume: true,
      dryRun: true,
    });
  });

  it("rejects unknown arguments and the removed eval-confirmation bypass", () => {
    expect(parseReleaseArgs(["--skip-eval-confirm", "patch"]).ok).toBe(false);
    expect(parseReleaseArgs(["--skip-eval-confirm", "patch"]).error).toMatch(
      /no longer supported/i,
    );
    expect(parseReleaseArgs(["--force", "patch"]).ok).toBe(false);
    expect(parseReleaseArgs(["banana"]).ok).toBe(false);
    expect(parseReleaseArgs([]).ok).toBe(false);
    expect(parseReleaseArgs(["patch", "minor"]).ok).toBe(false);
    expect(parseReleaseArgs(["--resume", "patch"]).ok).toBe(false);
  });
});

describe("semver helpers", () => {
  it("bumps and compares plain semantic versions", () => {
    expect(bumpSemver("1.2.3", "patch")).toBe("1.2.4");
    expect(bumpSemver("1.2.3", "minor")).toBe("1.3.0");
    expect(bumpSemver("1.2.3", "major")).toBe("2.0.0");
    expect(compareSemver("1.2.3", "1.2.4")).toBe(-1);
    expect(compareSemver("1.2.4", "1.2.3")).toBe(1);
    expect(compareSemver("1.2.3", "1.2.3")).toBe(0);
    expect(compareSemver("nope", "1.2.3")).toBeNull();
  });
});

describe("package proof validation", () => {
  const valid = {
    tarball: "opencandle-0.15.0.tgz",
    sha256: "a".repeat(64),
    candidateCommit: "c".repeat(40),
    packageName: "opencandle",
    packageVersion: "0.15.0",
  };
  const expected = {
    packageName: "opencandle",
    packageVersion: "0.15.0",
    candidateCommit: "c".repeat(40),
    sha256: "a".repeat(64),
  };

  it("accepts a matching proof and returns the plain tarball basename", () => {
    expect(validatePackageProof(valid, expected)).toEqual({ ok: true, tarball: valid.tarball });
  });

  it("rejects traversal and multi-segment tarball names", () => {
    for (const tarball of [
      "/tmp/evil.tgz",
      "../evil.tgz",
      "nested/evil.tgz",
      "a\\b.tgz",
      "..",
      ".",
    ]) {
      const result = validatePackageProof({ ...valid, tarball }, expected);
      expect(result.ok, tarball).toBe(false);
    }
  });

  it("rejects a tarball name that does not match package name and version", () => {
    expect(validatePackageProof({ ...valid, tarball: "other-0.15.0.tgz" }, expected).ok).toBe(
      false,
    );
  });

  it("rejects a hash, commit, or version mismatch", () => {
    expect(validatePackageProof({ ...valid, sha256: "b".repeat(64) }, expected).ok).toBe(false);
    expect(validatePackageProof({ ...valid, candidateCommit: "d".repeat(40) }, expected).ok).toBe(
      false,
    );
    expect(validatePackageProof({ ...valid, packageVersion: "9.9.9" }, expected).ok).toBe(false);
    expect(validatePackageProof({ ...valid, packageName: "other" }, expected).ok).toBe(false);
  });

  it("rejects non-object and malformed proofs", () => {
    expect(validatePackageProof(null, expected).ok).toBe(false);
    expect(validatePackageProof("proof", expected).ok).toBe(false);
    expect(validatePackageProof({ ...valid, sha256: "not-hex" }, expected).ok).toBe(false);
  });
});

describe("local release orchestration", () => {
  it("prepares the candidate before proving it, then tags and pushes only on success", () => {
    const { deps, calls } = createHarness();

    const result = run(deps);

    expect(result.ok).toBe(true);
    expect(result.version).toBe("1.2.4");
    expect(calls.indexOf("runBump:patch")).toBeLessThan(calls.indexOf("commitCandidate:1.2.4"));
    expect(calls.indexOf("commitCandidate:1.2.4")).toBeLessThan(calls.indexOf("runReleaseCheck"));
    expect(calls.indexOf("runReleaseCheck")).toBeLessThan(calls.indexOf("prepareReleasePackage"));
    expect(calls.indexOf("prepareReleasePackage")).toBeLessThan(
      calls.indexOf("runProviderReleaseSmoke"),
    );
    expect(calls.indexOf("runProviderReleaseSmoke")).toBeLessThan(calls.indexOf("runReleaseEvals"));
    expect(calls.indexOf("runReleaseEvals")).toBeLessThan(calls.indexOf("writeReleaseSummary"));
    expect(calls.indexOf("writeReleaseSummary")).toBeLessThan(calls.indexOf("tagVersion:v1.2.4"));
    expect(result.state.releaseSummaryWritten).toBe(true);
    expect(calls.indexOf("tagVersion:v1.2.4")).toBeLessThan(calls.indexOf("commitChangelogReset"));
    expect(calls.indexOf("commitChangelogReset")).toBeLessThan(calls.indexOf("pushMain"));
    expect(calls.indexOf("pushMain")).toBeLessThan(calls.indexOf("pushTag:v1.2.4"));
  });

  for (const [stage, key] of [
    ["release-check", "releaseCheck"],
    ["release-package", "pack"],
    ["provider-release", "providerRelease"],
    ["release-evals", "evals"],
    ["release-summary", "summary"],
  ] as const) {
    it(`leaves the candidate untagged and unpushed when ${stage} fails`, () => {
      const { deps, calls } = createHarness({ statuses: { [key]: 1 } });

      const result = run(deps);

      expect(result.ok).toBe(false);
      expect(result.stage).toBe(stage);
      expect(calls).toContain("commitCandidate:1.2.4");
      expect(calls.some((call) => call.startsWith("tagVersion"))).toBe(false);
      expect(calls).not.toContain("pushMain");
      expect(calls).not.toContain("pushTag:v1.2.4");
      expect(result.recovery).toMatch(/candidate commit created/i);
      expect(result.recovery).toMatch(/tag v1\.2\.4 not created/i);
      expect(result.recovery).toMatch(/not pushed/i);
      expect(result.recovery).toMatch(/--resume/);
      expect(result.recovery).not.toMatch(/reset --hard/);
    });
  }

  it("runs the provider release smoke before evals and blocks tagging on failure", () => {
    const { deps, calls } = createHarness({ statuses: { providerRelease: 1 } });

    const result = run(deps);

    expect(result.ok).toBe(false);
    expect(result.stage).toBe("provider-release");
    expect(result.state.packagePrepared).toBe(true);
    expect(result.state.providerReleasePassed).toBe(false);
    expect(result.state.releaseEvalsPassed).toBe(false);
    expect(calls).not.toContain("runReleaseEvals");
    expect(calls.some((call) => call.startsWith("tagVersion"))).toBe(false);
  });

  it("reports an accurate partial-push state when main push fails", () => {
    const { deps } = createHarness({ statuses: { pushMain: 1 } });

    const result = run(deps);

    expect(result.ok).toBe(false);
    expect(result.stage).toBe("finalize");
    expect(result.state.tagCreated).toBe(true);
    expect(result.state.mainPushed).toBe(false);
    expect(result.state.tagPushed).toBe(false);
    expect(result.recovery).toMatch(/tag v1\.2\.4 created locally/i);
    expect(result.recovery).toMatch(/main not pushed/i);
    expect(result.recovery).not.toMatch(/reset --hard/);
  });

  it("reports an accurate partial-push state when the tag push fails", () => {
    const { deps } = createHarness({ statuses: { pushTag: 1 } });

    const result = run(deps);

    expect(result.ok).toBe(false);
    expect(result.state.mainPushed).toBe(true);
    expect(result.state.tagPushed).toBe(false);
    expect(result.recovery).toMatch(/main pushed/i);
    expect(result.recovery).toMatch(/tag not pushed/i);
    expect(result.recovery).toMatch(/force-push/i);
    expect(result.recovery).not.toMatch(/reset --hard/);
  });

  it("returns a staged failure with side-effect state when a step throws", () => {
    const { deps, calls } = createHarness();
    deps.markChangelogReleased = () => {
      calls.push("markChangelogReleased:throw");
      throw new Error("missing [Unreleased] section");
    };

    const result = run(deps);

    expect(result.ok).toBe(false);
    expect(result.stage).toBe("prepare");
    expect(result.error).toMatch(/missing \[Unreleased\]/);
    expect(result.state.versionBumped).toBe(true);
    expect(result.state.candidateCommitted).toBe(false);
    expect(result.recovery).toMatch(/version bump applied/i);
    expect(result.recovery).toMatch(/candidate commit not created/i);
    expect(calls.some((call) => call.startsWith("tagVersion"))).toBe(false);
  });

  it("refuses to tag when the tree is dirty after proof", () => {
    const { deps, state, calls } = createHarness();
    deps.prepareReleasePackage = () => {
      calls.push("prepareReleasePackage");
      state.clean = false;
      return 0;
    };

    const result = run(deps);

    expect(result.ok).toBe(false);
    expect(result.stage).toBe("finalize");
    expect(calls.some((call) => call.startsWith("tagVersion"))).toBe(false);
    expect(calls).not.toContain("pushMain");
  });

  it("refuses to tag when HEAD moved after proof", () => {
    const { deps, calls } = createHarness();
    const originalHead = deps.headSha;
    let moved = false;
    deps.headSha = () => (moved ? "c-other" : originalHead());
    deps.prepareReleasePackage = () => {
      calls.push("prepareReleasePackage");
      moved = true;
      return 0;
    };

    const result = run(deps);

    expect(result.ok).toBe(false);
    expect(result.stage).toBe("finalize");
    expect(calls.some((call) => call.startsWith("tagVersion"))).toBe(false);
  });

  it("stops before any mutation when preflight fails", () => {
    for (const [field, value] of [
      ["clean", false],
      ["branch", "feature/x"],
      ["head", "c-other"],
    ] as const) {
      const { deps, calls } = createHarness({ [field]: value });
      const result = run(deps);
      expect(result.ok, field).toBe(false);
      expect(result.stage, field).toBe("preflight");
      expect(calls.some((call) => call.startsWith("runBump"))).toBe(false);
      expect(calls).not.toContain("commitCandidate:1.2.4");
    }
  });

  it("refuses a duplicate tag before preparing the candidate", () => {
    const { deps, calls } = createHarness();
    deps.tagExists = (tag: string) => {
      calls.push(`tagExists:${tag}`);
      return true;
    };

    const result = run(deps);

    expect(result.ok).toBe(false);
    expect(result.stage).toBe("preflight");
    expect(calls.some((call) => call.startsWith("runBump"))).toBe(false);
  });

  it("describes the plan in dry-run without mutating or running proof", () => {
    const { deps, calls } = createHarness();

    const result = run(deps, { dryRun: true });

    expect(result.ok).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.version).toBe("1.2.4");
    expect(calls.some((call) => call.startsWith("runBump"))).toBe(false);
    expect(calls).not.toContain("runReleaseCheck");
    expect(calls).not.toContain("runReleaseEvals");
    expect(calls).not.toContain("writeReleaseSummary");
    expect(calls.some((call) => call.startsWith("tagVersion"))).toBe(false);
    expect(calls).not.toContain("pushMain");
  });
});

describe("resume orchestration", () => {
  it("verifies the candidate and reruns proof before tagging without preparing a new version", () => {
    const { deps, calls } = candidateHarness();

    const result = run(deps, { resume: true, bumpType: null });

    expect(result.ok).toBe(true);
    expect(result.version).toBe("1.2.4");
    expect(calls.some((call) => call.startsWith("runBump"))).toBe(false);
    expect(calls.some((call) => call.startsWith("commitCandidate"))).toBe(false);
    expect(calls.indexOf("runReleaseCheck")).toBeLessThan(calls.indexOf("prepareReleasePackage"));
    expect(calls.indexOf("prepareReleasePackage")).toBeLessThan(
      calls.indexOf("runProviderReleaseSmoke"),
    );
    expect(calls.indexOf("runProviderReleaseSmoke")).toBeLessThan(calls.indexOf("runReleaseEvals"));
    expect(calls.indexOf("runReleaseEvals")).toBeLessThan(calls.indexOf("writeReleaseSummary"));
  });

  it("cannot bypass a failing proof on resume", () => {
    const { deps, calls } = candidateHarness({ statuses: { releaseCheck: 1 } });

    const result = run(deps, { resume: true, bumpType: null });

    expect(result.ok).toBe(false);
    expect(result.stage).toBe("release-check");
    expect(calls.some((call) => call.startsWith("tagVersion"))).toBe(false);
    expect(calls).not.toContain("pushMain");
  });

  it("rejects a candidate that changed unexpected files", () => {
    const { deps, calls } = candidateHarness({ changedFiles: ["package.json", "src/rogue.ts"] });

    const result = run(deps, { resume: true, bumpType: null });

    expect(result.ok).toBe(false);
    expect(result.stage).toBe("resume-verify");
    expect(result.error).toMatch(/rogue|unexpected/i);
    expect(calls.some((call) => call.startsWith("runReleaseCheck"))).toBe(false);
  });

  it("rejects a parent version that is not lower", () => {
    const { deps } = candidateHarness({ parentVersion: "1.2.4" });
    const result = run(deps, { resume: true, bumpType: null });
    expect(result.ok).toBe(false);
    expect(result.stage).toBe("resume-verify");
  });

  it("rejects a version mismatch, a stale changelog, and a non-adjacent HEAD", () => {
    expect(
      run(candidateHarness({ version: "9.9.9" }).deps, { resume: true, bumpType: null }).ok,
    ).toBe(false);
    expect(
      run(candidateHarness({ changelog: "# Changelog\n\n## [Unreleased]\n\n- pending\n" }).deps, {
        resume: true,
        bumpType: null,
      }).ok,
    ).toBe(false);
    expect(
      run(candidateHarness({ head: "c-other", parentSha: "c-mid" }).deps, {
        resume: true,
        bumpType: null,
      }).ok,
    ).toBe(false);
  });
});

describe("release workflow security contract", () => {
  const publishWorkflow = read(".github/workflows/publish.yml");

  it("triggers only from v* tags and scopes write permissions to the publish job", () => {
    expect(publishWorkflow).not.toContain("workflow_dispatch");
    expect(publishWorkflow).toContain('tags:\n      - "v*"');
    expect(publishWorkflow).toMatch(/^permissions:\n {2}contents: read\n/m);
    expect(publishWorkflow).toMatch(
      /jobs:[\s\S]*publish:[\s\S]*permissions:[\s\S]*contents: write/,
    );
    expect(publishWorkflow).toContain("id-token: write");
    expect(publishWorkflow).toContain("environment: release");
    expect(publishWorkflow).toContain("fetch-depth: 0");
  });

  it("documents that required-reviewer protection is repository-configured, not created by the workflow", () => {
    expect(publishWorkflow).toMatch(/required reviewers/i);
    expect(publishWorkflow).toMatch(/repository settings/i);
    expect(publishWorkflow).toMatch(/cannot (create|verify|confirm)/i);
  });

  it("verifies the tagged candidate is reachable from origin/main", () => {
    expect(publishWorkflow).toContain("merge-base --is-ancestor HEAD origin/main");
    expect(publishWorkflow).toMatch(/PACKAGE_VERSION/);
    expect(publishWorkflow).toMatch(/GITHUB_REF_NAME/);
  });

  it("runs release:check without secrets and fresh release evals with explicit secrets only in that step", () => {
    const checkIndex = publishWorkflow.indexOf("npm run release:check");
    const evalIndex = publishWorkflow.indexOf("npm run eval -- release");
    expect(checkIndex).toBeGreaterThan(-1);
    expect(evalIndex).toBeGreaterThan(-1);
    for (const secret of [
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "GEMINI_API_KEY",
      "GOOGLE_API_KEY",
      "ALPHA_VANTAGE_API_KEY",
      "FRED_API_KEY",
      "BRAVE_API_KEY",
      "EXA_API_KEY",
      "FINNHUB_API_KEY",
      "LSE_API_KEY",
    ]) {
      expect(publishWorkflow, secret).toContain(secret);
    }
    // The release:check step must not receive the model/provider secrets.
    const checkStep = publishWorkflow.slice(Math.max(0, checkIndex - 400), checkIndex);
    expect(checkStep).not.toContain("OPENAI_API_KEY");
    const evalStep = publishWorkflow.slice(evalIndex, evalIndex + 2500);
    expect(evalStep).toContain("OPENAI_API_KEY");
  });

  it("prepares the exact package before provider smoke and fresh evals, then verifies and publishes in one shell step", () => {
    const checkIndex = publishWorkflow.indexOf("npm run release:check");
    const prepareIndex = publishWorkflow.indexOf("prepare --out validation-output/release-package");
    const providerIndex = publishWorkflow.indexOf("npm run test:providers:release");
    const evalIndex = publishWorkflow.indexOf("npm run eval -- release");
    const summaryIndex = publishWorkflow.indexOf("release-summary.mjs");
    const uploadIndex = publishWorkflow.indexOf("actions/upload-artifact@v7");
    const verifyIndex = publishWorkflow.indexOf("verify --dir");
    const publishIndex = publishWorkflow.indexOf('npm publish "$tarball"');
    expect(checkIndex).toBeGreaterThan(-1);
    expect(prepareIndex).toBeGreaterThan(checkIndex);
    expect(providerIndex).toBeGreaterThan(prepareIndex);
    expect(evalIndex).toBeGreaterThan(providerIndex);
    expect(summaryIndex).toBeGreaterThan(evalIndex);
    expect(uploadIndex).toBeGreaterThan(summaryIndex);
    expect(verifyIndex).toBeGreaterThan(uploadIndex);
    expect(publishIndex).toBeGreaterThan(verifyIndex);
    // Verify and publish must live in the same step (no step boundary between).
    expect(publishWorkflow.slice(verifyIndex, publishIndex)).not.toContain("- name:");
    // The tarball path comes from the validated package proof, never a find/glob guess.
    expect(publishWorkflow).toContain("package-proof.json");
    expect(publishWorkflow).toContain("validatePackageProof");
    expect(publishWorkflow).not.toMatch(/\bfind\s/);
    expect(publishWorkflow).toContain("--ignore-scripts");
    expect(publishWorkflow).toContain("--provenance");
    expect(publishWorkflow).not.toContain("workflow_dispatch");
    expect(publishWorkflow).not.toContain("inputs.");
    expect(publishWorkflow).not.toContain("actions/download-artifact");
    const releaseIndex = publishWorkflow.indexOf("gh release create");
    expect(releaseIndex).toBeGreaterThan(publishIndex);
  });

  it("uploads bounded release evidence always without masking an earlier failure", () => {
    expect(publishWorkflow).toContain("actions/upload-artifact@v7");
    expect(publishWorkflow).toContain("if: always()");
    expect(publishWorkflow).toContain("if-no-files-found: warn");
    expect(publishWorkflow).not.toContain("if-no-files-found: error");
    for (const artifact of [
      "validation-output/release-evals/**/release-eval-startup.json",
      "validation-output/release-evals/**/release-evidence.json",
      "validation-output/release-evals/**/release-eval-summary.json",
      "validation-output/release-evals/**/release-eval-incomplete.json",
      "validation-output/release-evals/**/attempts.jsonl",
      "validation-output/release-package/package-proof.json",
      "validation-output/release-package/*.tgz",
      "validation-output/provider-release/**/summary.json",
      "validation-output/gates/*.json",
      "validation-output/release-summary/**/summary.json",
      "validation-output/release-summary/**/summary.md",
      "coverage/coverage-summary.json",
    ]) {
      expect(publishWorkflow, artifact).toContain(artifact);
    }
    expect(publishWorkflow).not.toContain("\n            coverage-summary.json");
    // The upload step's own paths must not include raw completion files or
    // reporter traces (the workflow comment may name what is excluded).
    const uploadStart = publishWorkflow.indexOf("- name: Upload release evidence");
    const uploadEnd = publishWorkflow.indexOf("- name:", uploadStart + 1);
    const uploadStep = publishWorkflow.slice(uploadStart, uploadEnd);
    expect(uploadStep).not.toContain(".completion.json");
    expect(uploadStep).not.toMatch(/reporter/i);
  });

  it("matches the artifact globs against the real generated report path shapes", () => {
    const generated = [
      "validation-output/release-evals/v2/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/2026-09-24T18-00-00-000Z-1/release-eval-startup.json",
      "validation-output/release-evals/v2/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/2026-09-24T18-00-00-000Z-1/release-evidence.json",
      "validation-output/release-evals/v2/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/2026-09-24T18-00-00-000Z-1/release-eval-summary.json",
      "validation-output/release-evals/v2/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/2026-09-24T18-00-00-000Z-1/release-eval-incomplete.json",
      "validation-output/release-evals/v2/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/2026-09-24T18-00-00-000Z-1/attempts.jsonl",
      "validation-output/release-package/package-proof.json",
      "validation-output/release-package/opencandle-0.15.0.tgz",
      "validation-output/provider-release/2026-09-24T18-00-00-000Z-1/summary.json",
      "validation-output/gates/2026-09-24T18-51-51-864Z-1.json",
      "validation-output/release-summary/2026-09-24T18-00-00-000Z-1/summary.json",
      "validation-output/release-summary/2026-09-24T18-00-00-000Z-1/summary.md",
      "coverage/coverage-summary.json",
    ];
    const patterns = [
      "validation-output/release-evals/**/release-eval-startup.json",
      "validation-output/release-evals/**/release-evidence.json",
      "validation-output/release-evals/**/release-eval-summary.json",
      "validation-output/release-evals/**/release-eval-incomplete.json",
      "validation-output/release-evals/**/attempts.jsonl",
      "validation-output/release-package/package-proof.json",
      "validation-output/release-package/*.tgz",
      "validation-output/provider-release/**/summary.json",
      "validation-output/gates/*.json",
      "validation-output/release-summary/**/summary.json",
      "validation-output/release-summary/**/summary.md",
      "coverage/coverage-summary.json",
    ];
    for (const pattern of patterns) {
      expect(publishWorkflow, pattern).toContain(pattern);
      expect(
        generated.some((file) => matchesGlob(file, pattern)),
        `${pattern} should match a generated report path`,
      ).toBe(true);
    }
  });
});

describe("CI workflow contract", () => {
  const ciWorkflow = read(".github/workflows/ci.yml");

  it("runs the full gate once on Node 24 while preserving docs links and packed proof", () => {
    expect(ciWorkflow).toContain('node-version: ["22.22.2", "24.x", "26.x"]');
    expect(ciWorkflow).toContain("npm run gates:full");
    expect(ciWorkflow).toMatch(/if:\s*matrix\.node-version == '24\.x'[\s\S]*npm run gates:full/);
    // The external docs link check stays a canonical Node 24 step.
    expect(ciWorkflow).toContain("npm run docs:links:check");
    expect(ciWorkflow).toMatch(
      /if:\s*matrix\.node-version == '24\.x'[\s\S]*npm run docs:links:check/,
    );
    // Packed install and CLI boot run on every supported runtime, not just non-24.
    expect(ciWorkflow).toContain("npm run test:packed-install");
    expect(ciWorkflow).toContain("node dist/cli.js --version");
    expect(ciWorkflow).not.toContain("matrix.node-version != '24.x'");
  });

  it("uploads coverage-summary and gate reports with an explicit missing-file failure", () => {
    expect(ciWorkflow).toContain("actions/upload-artifact@v7");
    expect(ciWorkflow).toContain("if-no-files-found: error");
    expect(ciWorkflow).toContain("coverage/coverage-summary.json");
    expect(ciWorkflow).toContain("validation-output/gates/*.json");
    expect(ciWorkflow).not.toContain("\n            coverage-summary.json");
  });

  it("does not skip infrastructure failures", () => {
    expect(ciWorkflow).not.toContain("continue-on-error");
  });
});

describe("package scripts", () => {
  const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };

  it("dispatches gates, gates:full, and release:check through the shared gate runner", () => {
    expect(pkg.scripts.gates).toBe("node scripts/test-gate.mjs core");
    expect(pkg.scripts["gates:full"]).toBe("node scripts/test-gate.mjs full");
    expect(pkg.scripts["release:check"]).toBe("node scripts/test-gate.mjs release");
    expect(pkg.scripts.prepublishOnly).toBe("npm run release:check");
    expect(pkg.scripts["publish:dry"]).toContain("npm run release:check");
  });
});

describe("preserved release-readiness contracts", () => {
  it("loads .env before GUI and monitor command handlers read process env", () => {
    const cliMain = read("src/cli-main.ts");

    expect(cliMain.indexOf("loadEnv();")).toBeLessThan(
      cliMain.indexOf("await handleGuiCommand(rawArgs, cwd)"),
    );
    expect(cliMain.indexOf("loadEnv();")).toBeLessThan(
      cliMain.indexOf("await handleMonitorCommand(rawArgs, cwd)"),
    );
  });

  it("keeps package-content validation machine-readable and denylist based", () => {
    const packageCheck = read("scripts/check-package-contents.mjs");

    expect(pkgScripts()["package:contents:check"]).toBe("node scripts/check-package-contents.mjs");
    expect(packageCheck).toContain("--dry-run");
    expect(packageCheck).toContain("--json");
    expect(packageCheck).not.toContain("--ignore-scripts");
    expect(packageCheck).toContain("deniedDirectorySegments");
    expect(packageCheck).toContain('"docs"');
    expect(packageCheck).toContain('"src"');
    expect(packageCheck).toContain('".agents"');
    expect(packageCheck).toContain('"graphify-out"');
    expect(packageCheck).toContain('"dist/gui/server/server.js"');
  });

  it("builds published runtime artifacts without source maps", () => {
    const tsconfig = read("tsconfig.json");
    const guiServerBuild = read("scripts/build-gui-server.mjs");

    expect(tsconfig).toContain('"sourceMap": false');
    expect(guiServerBuild).not.toContain('"--sourceMap"');
  });

  it("rejects denied package artifacts below published runtime directories", async () => {
    const { isDeniedPackagePath, parsePackDryRunJson } = (await import(
      pathToFileURL(join(root, "scripts/check-package-contents.mjs")).href
    )) as {
      isDeniedPackagePath: (path: string) => boolean;
      parsePackDryRunJson: (output: string) => unknown;
    };

    expect(isDeniedPackagePath("fixtures/provider/quote.json")).toBe(true);
    expect(isDeniedPackagePath("src/providers/yahoo/fixtures/quote.json")).toBe(true);
    expect(isDeniedPackagePath("src/tools/market/tests/quote.test.ts")).toBe(true);
    expect(isDeniedPackagePath("src/providers/yahoo-finance.ts")).toBe(true);
    expect(isDeniedPackagePath("gui/server/server.ts")).toBe(true);
    expect(isDeniedPackagePath("gui/shared/chat-events.ts")).toBe(true);
    expect(isDeniedPackagePath("gui/server/.env.local")).toBe(true);
    expect(isDeniedPackagePath("website/dist/index.html")).toBe(true);
    expect(isDeniedPackagePath("dist/providers/yahoo-finance.js")).toBe(false);
    expect(isDeniedPackagePath("dist/gui/server/server.js")).toBe(false);
    expect(
      parsePackDryRunJson('> opencandle@0.7.0 prepare\n[{"files":[{"path":"dist/cli.js"}]}]'),
    ).toEqual([{ files: [{ path: "dist/cli.js" }] }]);
  });

  it("rewrites llms-full markdown links to absolute public URLs", () => {
    const websiteBuild = read("website/scripts/prerender.jsx");

    expect(websiteBuild).toContain("function rewriteMarkdownLinksForSite");
    expect(websiteBuild).toContain("rewriteMarkdownLinksForSite(page.body, page)");
    expect(websiteBuild).toContain("AGENTS.md");
  });

  it("adds dependency update automation and code ownership for sensitive surfaces", () => {
    const dependabot = read(".github/dependabot.yml");
    const codeowners = read(".github/CODEOWNERS");

    expect(dependabot).toContain("package-ecosystem: npm");
    expect(dependabot).toContain("package-ecosystem: github-actions");
    expect(dependabot).toContain('"@earendil-works/pi-*"');
    expect(codeowners).toContain("/.github/ @Kahtaf");
    expect(codeowners).toContain("/src/pi/ @Kahtaf");
    expect(codeowners).toContain("/src/providers/ @Kahtaf");
    expect(codeowners).toContain("/src/prompts/ @Kahtaf");
  });
});

function pkgScripts(): Record<string, string> {
  return (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts;
}
