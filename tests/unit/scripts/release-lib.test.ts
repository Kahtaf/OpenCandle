import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { addUnreleasedSection, updateChangelogForRelease } from "../../../scripts/release-lib.mjs";

function makeTempChangelog(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "vantage-release-lib-"));
  const path = join(dir, "CHANGELOG.md");
  writeFileSync(path, content);
  return path;
}

describe("release-lib", () => {
  it("replaces the unreleased heading with a versioned release heading", () => {
    const path = makeTempChangelog("# Changelog\n\n## [Unreleased]\n\n- Pending item\n");

    updateChangelogForRelease(path, "0.2.0", "2026-03-30");

    expect(readFileSync(path, "utf-8")).toBe(
      "# Changelog\n\n## [0.2.0] - 2026-03-30\n\n- Pending item\n",
    );
  });

  it("re-inserts the unreleased section at the top of the changelog", () => {
    const path = makeTempChangelog("# Changelog\n\n## [0.2.0] - 2026-03-30\n\n- Released item\n");

    addUnreleasedSection(path);

    expect(readFileSync(path, "utf-8")).toBe(
      "# Changelog\n\n## [Unreleased]\n\n## [0.2.0] - 2026-03-30\n\n- Released item\n",
    );
  });
});
