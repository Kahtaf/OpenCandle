import { readFileSync, writeFileSync } from "node:fs";

export function updateChangelogForRelease(changelogPath, version, date = new Date().toISOString().split("T")[0]) {
  const content = readFileSync(changelogPath, "utf-8");
  if (!content.includes("## [Unreleased]")) {
    throw new Error(`Missing [Unreleased] section in ${changelogPath}`);
  }

  const updated = content.replace("## [Unreleased]", `## [${version}] - ${date}`);
  writeFileSync(changelogPath, updated);
}

export function addUnreleasedSection(changelogPath) {
  const content = readFileSync(changelogPath, "utf-8");
  if (content.includes("## [Unreleased]")) {
    return;
  }

  const updated = content.replace(/^(# Changelog\n\n)/, "$1## [Unreleased]\n\n");
  if (updated === content) {
    throw new Error(`Missing changelog header in ${changelogPath}`);
  }

  writeFileSync(changelogPath, updated);
}
