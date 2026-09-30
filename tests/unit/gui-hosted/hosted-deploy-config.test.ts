import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

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
    expect(hostedPackage.scripts.deploy).toBe("npm run build && wrangler deploy");
    expect(hostedPackage.scripts["deploy:dry-run"]).toBe(
      "npm run build && wrangler deploy --dry-run",
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
