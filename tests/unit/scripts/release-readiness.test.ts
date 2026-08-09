import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

describe("release readiness automation", () => {
  it("requires release-eval confirmation unless an emergency skip is explicit", async () => {
    const { confirmReleaseEvals } = (await import(
      pathToFileURL(join(root, "scripts/release-lib.mjs")).href
    )) as {
      confirmReleaseEvals: (options: {
        input: PassThrough;
        output: PassThrough;
        skip?: boolean;
      }) => Promise<boolean>;
    };
    const input = new PassThrough();
    const output = new PassThrough();
    let prompt = "";
    output.setEncoding("utf8");
    output.on("data", (chunk: string) => {
      prompt += chunk;
    });

    input.end("no\n");
    await expect(confirmReleaseEvals({ input, output })).resolves.toBe(false);
    expect(prompt).toContain("npm run eval -- release");

    await expect(
      confirmReleaseEvals({ input: new PassThrough(), output: new PassThrough(), skip: true }),
    ).resolves.toBe(true);

    const releaseScript = read("scripts/release.mjs");
    expect(releaseScript).toContain('args.includes("--skip-eval-confirm")');
    expect(releaseScript).toContain("Release eval confirmation not received");
    expect(releaseScript.indexOf("confirmReleaseEvals")).toBeLessThan(
      releaseScript.indexOf("Bumping version"),
    );
  });

  it("runs release checks before mutating version or changelog state", () => {
    const releaseScript = read("scripts/release.mjs");

    expect(releaseScript.indexOf('run("npm run release:check")')).toBeGreaterThan(-1);
    expect(releaseScript.indexOf('run("npm run release:check")')).toBeLessThan(
      releaseScript.indexOf("Bumping version"),
    );
  });

  it("loads .env before GUI and monitor command handlers read process env", () => {
    const cliMain = read("src/cli-main.ts");

    expect(cliMain.indexOf("loadEnv();")).toBeLessThan(
      cliMain.indexOf("await handleGuiCommand(rawArgs, cwd)"),
    );
    expect(cliMain.indexOf("loadEnv();")).toBeLessThan(
      cliMain.indexOf("await handleMonitorCommand(rawArgs, cwd)"),
    );
  });

  it("guards release tagging against wrong branches, stale main, and duplicate tags", () => {
    const releaseScript = read("scripts/release.mjs");

    expect(releaseScript).toContain("assertMainBranch();");
    expect(releaseScript).toContain('run("git fetch origin main:refs/remotes/origin/main --tags")');
    expect(releaseScript).toContain("assertHeadMatchesOriginMain();");
    expect(releaseScript).toContain("assertTagAvailable(version);");
    expect(releaseScript.indexOf("assertMainBranch();")).toBeLessThan(
      releaseScript.indexOf("Bumping version"),
    );
    expect(releaseScript.indexOf("assertTagAvailable(version);")).toBeLessThan(
      releaseScript.indexOf("Committing and tagging"),
    );
  });

  it("defines a local release check that covers compile, lint, tests, GUI smoke, docs, packing, and link checks", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };
    const releaseCheck = pkg.scripts["release:check"];

    expect(pkg.scripts["test:gui:release-smoke"]).toBe(
      "npm run gui:web:build && OPENCANDLE_GUI_RELEASE_SMOKE=1 vitest run --config vitest.config.gui-release.ts",
    );
    expect(releaseCheck).toContain("npx tsc --noEmit");
    expect(releaseCheck).toContain("npx biome ci .");
    expect(releaseCheck).toContain("npm test");
    expect(releaseCheck).toContain("npm run test:gui:release-smoke");
    expect(releaseCheck).toContain("npm run docs:site:build");
    expect(releaseCheck).toContain("npm run package:contents:check");
    expect(releaseCheck).toContain("npm run test:packed-install");
    expect(releaseCheck).toContain("npm run docs:links:check");
  });

  it("uses the full release gate for local publish paths", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };

    expect(pkg.scripts.prepublishOnly).toBe("npm run release:check");
    expect(pkg.scripts["publish:dry"]).toContain("npm run release:check");
  });

  it("keeps package-content validation machine-readable and denylist based", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };
    const packageCheck = read("scripts/check-package-contents.mjs");

    expect(pkg.scripts["package:contents:check"]).toBe("node scripts/check-package-contents.mjs");
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
    expect(ciWorkflow).toContain('node-version: ["22.22.2", "24.x", "26.x"]');
    expect(ciWorkflow).toContain("npm run docs:site:build");
    expect(ciWorkflow).toContain("npm run package:contents:check");
    expect(ciWorkflow).toContain("npm run relay:typecheck");
    expect(ciWorkflow).toContain("npm run relay:test");
    expect(ciWorkflow).toContain("npm run test:packed-install");
    expect(ciWorkflow).toContain("npm run docs:links:check");
  });

  it("uses production model setup requirement literals in GUI browser smokes", () => {
    const guiBrowserTest = read("tests/e2e/gui-browser.test.ts");

    expect(guiBrowserTest).not.toContain("needs_api_key");
    expect(guiBrowserTest).toContain('requirement: "connect_auth"');
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
