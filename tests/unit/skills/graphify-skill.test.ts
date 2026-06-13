import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const skillPaths = [
  ".codex/skills/graphify/SKILL.md",
  ".claude/skills/graphify/SKILL.md",
] as const;

describe("graphify skill snippets", () => {
  it.each(skillPaths)("supports code-only runs in %s", (path) => {
    const source = readFileSync(resolve(path), "utf-8");

    expect(source).toContain("sem_path = Path('graphify-out/.graphify_semantic.json')");
    expect(source).toContain("if sem_path.exists() else {'nodes':[],'edges':[],'hyperedges':[]");
  });

  it.each(skillPaths)("preserves directed mode when rebuilding in %s", (path) => {
    const source = readFileSync(resolve(path), "utf-8");
    const directedBuilds = source.match(/build_from_json\(extraction, directed=DIRECTED\)/g) ?? [];

    expect(source).toContain("DIRECTED = False  # replace with True when --directed was given");
    expect(directedBuilds).toHaveLength(2);
  });
});
