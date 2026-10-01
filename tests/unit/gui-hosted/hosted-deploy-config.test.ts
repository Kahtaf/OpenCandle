import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findDeployEnvProblems } from "../../../gui/hosted/scripts/check-deploy-env.mjs";

const root = resolve(import.meta.dirname, "../../..");
const hostedDir = resolve(root, "gui/hosted");

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

describe("hosted web deploy configuration", () => {
  const wrangler = readJson(resolve(hostedDir, "wrangler.jsonc"));
  const hostedPackage = readJson(resolve(hostedDir, "package.json")) as {
    scripts: Record<string, string>;
    devDependencies: Record<string, string>;
  };

  it("declares the production custom domain so it is reviewable in config", () => {
    expect(wrangler.routes).toEqual([{ pattern: "web.opencandle.app", custom_domain: true }]);
  });

  it("points $schema at an installed wrangler config schema", () => {
    expect(typeof wrangler.$schema).toBe("string");
    const schemaPath = resolve(
      dirname(resolve(hostedDir, "wrangler.jsonc")),
      wrangler.$schema as string,
    );
    expect(existsSync(schemaPath)).toBe(true);
  });

  it("owns its wrangler binary at the same pin as the provider relay", () => {
    const relayPackage = readJson(resolve(root, "workers/provider-relay/package.json")) as {
      devDependencies: Record<string, string>;
    };
    expect(hostedPackage.devDependencies.wrangler).toBe(relayPackage.devDependencies.wrangler);
  });

  it("builds before every deploy and offers a dry run", () => {
    expect(hostedPackage.scripts.deploy).toBe(
      "node scripts/check-deploy-env.mjs && npm run build && wrangler deploy",
    );
    expect(hostedPackage.scripts["deploy:dry-run"]).toBe(
      "node scripts/check-deploy-env.mjs && npm run build && wrangler deploy --dry-run",
    );
  });

  it("exposes root convenience scripts for the hosted deploy", () => {
    const rootPackage = readJson(resolve(root, "package.json")) as {
      scripts: Record<string, string>;
    };
    expect(rootPackage.scripts["gui:hosted:deploy"]).toBe(
      "npm --workspace @opencandle/gui-hosted run deploy",
    );
    expect(rootPackage.scripts["gui:hosted:deploy:dry-run"]).toBe(
      "npm --workspace @opencandle/gui-hosted run deploy:dry-run",
    );
  });
});

describe("hosted deploy build environment guard", () => {
  const dirs: string[] = [];
  function envDir(files: Record<string, string> = {}): string {
    const dir = mkdtempSync(join(tmpdir(), "oc-hosted-env-"));
    dirs.push(dir);
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
    return dir;
  }
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("passes when the WebContainer key is unset everywhere", () => {
    expect(findDeployEnvProblems({ env: {}, envDir: envDir() })).toEqual([]);
  });

  it("fails when the WebContainer key is set in the shell", () => {
    const problems = findDeployEnvProblems({
      env: { VITE_WEBCONTAINER_API_KEY: "k" },
      envDir: envDir(),
    });
    expect(problems.join("\n")).toContain("VITE_WEBCONTAINER_API_KEY");
    expect(problems.join("\n")).not.toContain("k\n");
  });

  it.each([".env", ".env.local", ".env.production", ".env.production.local"])(
    "fails when Vite would load the WebContainer key from %s",
    (file) => {
      const problems = findDeployEnvProblems({
        env: {},
        envDir: envDir({ [file]: "VITE_WEBCONTAINER_API_KEY=from-file\n" }),
      });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("VITE_WEBCONTAINER_API_KEY");
      expect(problems[0]).not.toContain("from-file");
    },
  );

  it("ignores env files Vite does not load for production builds", () => {
    const dir = envDir({ ".env.development": "VITE_WEBCONTAINER_API_KEY=dev\n" });
    expect(findDeployEnvProblems({ env: {}, envDir: dir })).toEqual([]);
  });

  it("allows an explicitly licensed key only with the opt-in flag", () => {
    expect(
      findDeployEnvProblems({
        env: { VITE_WEBCONTAINER_API_KEY: "k", OPENCANDLE_ALLOW_WEBCONTAINER_API_KEY: "1" },
        envDir: envDir(),
      }),
    ).toEqual([]);
  });
});
