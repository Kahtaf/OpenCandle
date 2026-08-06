import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Pi model runtime migration guards", () => {
  it("passes the shared model runtime to startup setup", () => {
    const source = readFileSync(resolve("src/pi/opencandle-extension-core.ts"), "utf-8");
    const handlerStart = source.indexOf('pi.on("session_start"');
    const handlerEnd = source.indexOf("// One-shot welcome", handlerStart);
    const handlerSource = source.slice(handlerStart, handlerEnd);

    expect(handlerSource).toMatch(
      /coordinator\.runSetup\([\s\S]*?\{ mode: "startup" \},\s*options\?\.modelRuntime,?\s*\)/,
    );
  });

  it("loads local environment before composing native provider-backed tools", () => {
    const source = readFileSync(resolve("src/pi/session.ts"), "utf-8");

    expect(source.indexOf("loadEnv();")).toBeGreaterThan(0);
    expect(source.indexOf("loadEnv();")).toBeLessThan(
      source.indexOf("getOpenCandleToolDefinitions({"),
    );
    expect(source).toContain("options.useInlineExtension === false");
  });

  it("keeps Codex review advisory instead of blocking pull requests", () => {
    expect(existsSync(resolve(".github/workflows/codex-review-gate.yml"))).toBe(false);

    const contributing = readFileSync(resolve("CONTRIBUTING.md"), "utf-8");
    expect(contributing).toContain("@codex review");
    expect(contributing).not.toContain("required alongside CI");
  });
});
