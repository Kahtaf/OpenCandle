import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

describe("release readiness automation", () => {
  it("runs release checks before mutating version or changelog state", () => {
    const releaseScript = read("scripts/release.mjs");

    expect(releaseScript.indexOf('run("npm run release:check")')).toBeGreaterThan(-1);
    expect(releaseScript.indexOf('run("npm run release:check")')).toBeLessThan(
      releaseScript.indexOf("Bumping version"),
    );
  });

  it("defines a local release check that covers compile, lint, tests, docs, packing, and link checks", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };
    const releaseCheck = pkg.scripts["release:check"];

    expect(releaseCheck).toContain("npx tsc --noEmit");
    expect(releaseCheck).toContain("npx biome ci .");
    expect(releaseCheck).toContain("npm test");
    expect(releaseCheck).toContain("npm run docs:site:build");
    expect(releaseCheck).toContain("npm pack --dry-run");
    expect(releaseCheck).toContain("npm run test:packed-install");
    expect(releaseCheck).toContain("npm run docs:links:check");
  });

  it("keeps publish tag-only and checks that the tag matches the package version", () => {
    const publishWorkflow = read(".github/workflows/publish.yml");

    expect(publishWorkflow).not.toContain("workflow_dispatch");
    expect(publishWorkflow).toContain('tags:\n      - "v*"');
    expect(publishWorkflow).toMatch(/\$\{GITHUB_REF\}" != refs\/tags\/v\*/);
    expect(publishWorkflow).toMatch(/\$\{GITHUB_REF_NAME\}" != "v\$\{PACKAGE_VERSION\}/);
  });

  it("tests the declared Node range and runs release-package smoke in CI", () => {
    const ciWorkflow = read(".github/workflows/ci.yml");

    expect(ciWorkflow).toContain("permissions:\n  contents: read");
    expect(ciWorkflow).toContain('node-version: ["22.19.0", "24.x", "26.x"]');
    expect(ciWorkflow).toContain("npm run docs:site:build");
    expect(ciWorkflow).toContain("npm run test:packed-install");
    expect(ciWorkflow).toContain("npm run docs:links:check");
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
