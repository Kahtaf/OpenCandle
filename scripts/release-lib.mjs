import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";

export async function confirmReleaseEvals({
  skip = false,
  input = process.stdin,
  output = process.stdout,
} = {}) {
  if (skip) {
    console.warn(
      "WARNING: --skip-eval-confirm supplied; proceeding without release eval confirmation.",
    );
    return true;
  }

  const readline = createInterface({ input, output });
  try {
    const answer = await readline.question(
      "Release evals: run `npm run eval -- release` and review results. Confirm evals were run and acceptable? [y/N] ",
    );
    return /^(y|yes)$/i.test(answer.trim());
  } finally {
    readline.close();
  }
}

export function updateChangelogForRelease(
  changelogPath,
  version,
  date = new Date().toISOString().split("T")[0],
) {
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
