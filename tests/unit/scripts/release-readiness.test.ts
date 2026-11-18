import { readFileSync } from "node:fs";
import { join, matchesGlob } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  bumpSemver,
  parseReleaseArgs,
  prepareReleaseCandidate,
} from "../../../scripts/release-lib.mjs";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

describe("release candidate preparation", () => {
  function preparation(branch = "release/next", clean = true, head = "main-tip") {
    const effects: string[] = [];
    const deps = {
      readVersion: () => "1.2.3",
      isWorkingTreeClean: () => clean,
      currentBranch: () => branch,
      fetchOriginMain: () => 0,
      headSha: () => head,
      originMainSha: () => "main-tip",
      tagExists: () => false,
      runBump: (bump: string) => {
        effects.push(`bump:${bump}`);
        return 0;
      },
      markChangelogReleased: (version: string) => effects.push(`changelog:${version}`),
      commitCandidate: (version: string) => {
        effects.push(`commit:${version}`);
        return 0;
      },
    };
    return { effects, deps };
  }

  it("prepares only the version PR commit and leaves publication to CI", () => {
    const { effects, deps } = preparation();
    expect(prepareReleaseCandidate({ bumpType: "patch", deps })).toBe("1.2.4");
    expect(effects).toEqual(["bump:patch", "changelog:1.2.4", "commit:1.2.4"]);
  });

  it.each([
    ["main", true, "main-tip"],
    ["release/next", false, "main-tip"],
    ["release/next", true, "stale"],
  ])("rejects unsuitable worktrees without mutating anything", (branch, clean, head) => {
    const { effects, deps } = preparation(branch, clean, head);
    expect(() => prepareReleaseCandidate({ bumpType: "patch", deps })).toThrow();
    expect(effects).toEqual([]);
  });

  it("supports a dry run and rejects old publish flags", () => {
    const { effects, deps } = preparation();
    expect(prepareReleaseCandidate({ bumpType: "minor", dryRun: true, deps })).toBe("1.3.0");
    expect(effects).toEqual([]);
    expect(parseReleaseArgs(["patch", "--dry-run"])).toMatchObject({ ok: true, dryRun: true });
    expect(parseReleaseArgs(["--resume"]).ok).toBe(false);
    expect(parseReleaseArgs(["patch", "--skip-eval-confirm"]).ok).toBe(false);
    expect(bumpSemver("1.2.3", "major")).toBe("2.0.0");
  });
});

describe("release workflow security contract", () => {
  const publishWorkflow = read(".github/workflows/publish.yml");

  it("pins a main dispatch to its commit and protects dry runs from publishing", () => {
    expect(publishWorkflow).toContain("workflow_dispatch:");
    expect(publishWorkflow).not.toContain("  push:");
    expect(publishWorkflow).toContain("if: github.ref == 'refs/heads/main'");
    expect(publishWorkflow).toContain(`ref: \${{ github.sha }}`);
    expect(publishWorkflow).toContain('test "$(git rev-parse HEAD)" = "$GITHUB_SHA"');
    expect(publishWorkflow).toContain("merge-base --is-ancestor HEAD origin/main");
    expect(publishWorkflow).toMatch(/publish:\n[\s\S]*?default: false/);
    expect(publishWorkflow).toMatch(/Publish exact verified tarball to npm\n +if: inputs.publish/);
    expect(publishWorkflow).toMatch(/Create GitHub Release\n +if: inputs.publish/);
    expect(publishWorkflow).toMatch(/^permissions:\n {2}contents: read$/m);
    expect(publishWorkflow).toContain("environment: release");
    expect(publishWorkflow).toContain("id-token: write");
    expect(publishWorkflow).not.toContain("actions/download-artifact");
  });

  it("checks live access before the full gate and keeps judging outside publication", () => {
    const [publish, advisory] = publishWorkflow.split("\n  advisory:");
    const preflight = publish.indexOf("node scripts/release-preflight.mjs");
    const install = publish.indexOf("npm ci");
    const smoke = publish.indexOf("npm run test:providers:release");
    const gate = publish.indexOf("npm run release:check");
    const evals = publish.indexOf("npm run eval -- release");
    expect(preflight).toBeGreaterThan(-1);
    expect(install).toBeGreaterThan(preflight);
    expect(smoke).toBeGreaterThan(install);
    expect(gate).toBeGreaterThan(smoke);
    expect(evals).toBeGreaterThan(gate);
    expect(publish.slice(gate, evals)).not.toContain("secrets.");
    expect(publish).not.toContain("OPENAI_API_KEY");
    expect(advisory).toContain("competitive:frozen");
    expect(advisory).toContain("continue-on-error: true");
    expect(advisory).not.toContain("contents: write");
    expect(advisory).not.toContain("id-token: write");
    expect(publish).not.toContain("needs:");
  });

  it("prepares one release tarball and verifies it in the publish step", () => {
    const pkg = pkgScripts();
    expect(pkg["release:package:prepare"]).toBe(
      "node scripts/release-package.mjs prepare --out validation-output/release-package",
    );
    expect(JSON.parse(read("scripts/test-gate-policy.json")).release).toContain(
      "release:package:prepare",
    );
    expect(publishWorkflow).not.toContain("prepare --out");
    const upload = publishWorkflow.indexOf("actions/upload-artifact@v7");
    const verify = publishWorkflow.indexOf("verify --dir");
    const publish = publishWorkflow.indexOf('npm publish "$tarball"');
    expect(verify).toBeGreaterThan(upload);
    expect(publish).toBeGreaterThan(verify);
    expect(publishWorkflow.slice(verify, publish)).not.toContain("- name:");
    expect(publishWorkflow).toContain("package-proof.json");
    expect(publishWorkflow).toContain("--ignore-scripts");
    expect(publishWorkflow).toContain("--provenance");
    const tag = publishWorkflow.indexOf('git push origin "HEAD:refs/tags/$tag"');
    expect(tag).toBeGreaterThan(publish);
    expect(publishWorkflow.indexOf("gh release create")).toBeGreaterThan(tag);
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
