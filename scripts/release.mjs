#!/usr/bin/env node

import { createReleaseDeps, parseReleaseArgs, prepareReleaseCandidate } from "./release-lib.mjs";

const parsed = parseReleaseArgs(process.argv.slice(2));
if (!parsed.ok) {
  console.error(parsed.error);
  process.exit(1);
}

try {
  const version = prepareReleaseCandidate({ ...parsed, deps: createReleaseDeps() });
  if (parsed.dryRun) {
    console.log(
      `Would prepare version ${version} for a PR. GitHub owns verification and publishing.`,
    );
  } else {
    console.log(`Prepared version ${version}. Open and merge the version PR, then run:`);
    console.log(`gh workflow run publish.yml --ref main -f version=${version} -F publish=true`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error("Inspect git status before retrying. No rollback is performed.");
  process.exitCode = 1;
}
