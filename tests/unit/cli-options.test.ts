import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { frontDoorCommand } from "../../src/cli-options.js";

describe("CLI front-door options", () => {
  it("handles help and version before interactive startup", () => {
    expect(frontDoorCommand(["--help"])).toBe("help");
    expect(frontDoorCommand(["-h"])).toBe("help");
    expect(frontDoorCommand(["--version"])).toBe("version");
    expect(frontDoorCommand(["-v"])).toBe("version");
    expect(frontDoorCommand(["doctor"])).toBeUndefined();
  });

  const packageVersion = (JSON.parse(readFileSync("package.json", "utf8")) as { version: string })
    .version;

  it.each([
    ["--help", "Usage: opencandle [command]"],
    ["--version", packageVersion],
  ])("prints %s without starting the TUI", (arg, expectedOutput) => {
    const result = spawnSync(
      process.execPath,
      ["node_modules/tsx/dist/cli.mjs", "src/cli.ts", arg],
      { cwd: process.cwd(), encoding: "utf8", timeout: 5_000 },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(expectedOutput);
    expect(result.stdout).not.toContain("\u001b[");
  });

  it("declares the supported Node range and read-only package positioning", async () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      description: string;
      engines: { node: string };
      keywords: string[];
    };
    const semver = await import("semver");

    expect(packageJson.description).toBe(
      "Open source financial investigator: evidence-first market research agent for your terminal and local GUI",
    );
    expect(packageJson.keywords).not.toContain("trading");
    expect(semver.satisfies("22.22.2", packageJson.engines.node)).toBe(true);
    expect(semver.satisfies("22.19.0", packageJson.engines.node)).toBe(false);
    expect(semver.satisfies("23.0.0", packageJson.engines.node)).toBe(false);
    expect(semver.satisfies("24.0.0", packageJson.engines.node)).toBe(true);
    expect(semver.satisfies("26.0.0", packageJson.engines.node)).toBe(true);
  });
});
