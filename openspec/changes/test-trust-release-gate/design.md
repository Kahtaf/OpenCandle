# Design decisions

## Test execution and evidence

Preserve Vitest and the existing eval front door. Add measurement and deterministic browser projects incrementally. Existing suites continue running until replacements demonstrate equivalent protection. Actual test collection is the source of inventory counts; static heuristics may annotate candidates but cannot mark them reviewed.

Coverage is grouped by production surface. Initially report in-process coverage separately from browser/process/hosted execution. Never combine percentages or present missing instrumentation as complete. Baseline comparisons use explicit file inclusion and branch totals; unexplained regressions fail the coverage check.

Keep test infrastructure under tests/ or scripts/, never add mock data or testing switches to production tools. Browser-only integration stubs are identified as such. Full-stack journeys use real server routes and persistence with external fixture model/provider boundaries.

## Release identity and trust

The release evidence schema records the Git commit/tree, dependency and test-policy digests, case outcomes, attempts, dates, execution environment, and artifacts. A completed release eval requires each configured suite to execute nonzero cases and expose complete outcomes. Optional competitor skips remain visible; the release panel's OpenCandle hard assertions are mandatory. Live evidence expires after 24 hours by default.

Separate evidence validation from evidence provenance. A JSON report can validate candidate identity and completeness but is not authorization to publish. The publish workflow must obtain the report from a trusted, explicitly approved workflow run, verify its origin and candidate, and reject arbitrary checked-in reports. Do not weaken this to an environment boolean.

Prepare final version metadata before definitive package validation. If behavioral eval evidence was generated against the pre-bump tree, permit only version fields in package manifests/lockfile and changelog changes; compare normalized tree content and require unchanged production, dependency values, tests, and policy. Pack once, hash and smoke-test that tarball, and publish that exact artifact. No actual release or remote workflow is triggered by implementation.

Introduce reporting first, then exercise success/failure rehearsals before enforcement. Keep manual quality review of noisy competitive judgments; correctness hard assertions and completed required journeys block automatically. Waivers are explicit records with approver/reason/checks/expiry and cannot turn failure into a plain pass.

## Worker ownership and review

Each ACPX DeepSeek worker owns one worktree and one bounded task. Parent owns design, threat assessment, review, and integration. Workers may not publish, push, alter system prompts, or relax tests to mask failures. Review source and red/green proof before accepting patches. Large security-sensitive release design decisions remain with the parent.
