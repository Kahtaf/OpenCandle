# Implementation plan

Status: approved on 2026-09-24; implementation in progress. Completion is tracked in tasks.md; proposed behavior below must not be assumed implemented until verified.

## Desired release gate

Keep `npm run eval -- release` as the eval front door: router-live, cases, product, and competitive:frozen remain central. Add a unified release report joining the following evidence rather than treating each green command as sufficient on its own.

| Evidence | Pull requests | Release candidate |
| --- | --- | --- |
| Types, lint, useful unit/component/HTTP/storage tests, relay contracts | Required | Required |
| Deterministic browser and TUI journeys | Required | Required against candidate |
| Site, package contents, supported Node install/boot checks | Required as appropriate to existing matrix | Required against final package |
| Coverage baseline and changed-code review | Required once baseline is established | Required; instrumentation gaps explicit |
| Existing live release evals and frozen competitive panel | Opt-in | Required |
| Bounded live provider/credential smoke for supported release paths | Scheduled/opt-in | Required selected core paths; expand for changed providers |
| Targeted mutation/fault tests | Changed critical areas; wider scheduled runs | Reviewed evidence for changed critical areas |
| Generated competitive discovery | Scheduled/opt-in | Supplemental; new findings triaged |

Do not silently weaken existing gates during migration. Share suite definitions between CI, `gates:full`, and `release:check` so their product coverage cannot drift. Maintainer-tool tests remain a development gate; do not conflate them with shipped product coverage.

## Phase 1 — Map contracts and establish measurement

**Deliverables:** executable-suite inventory; human-reviewed contract map; coverage baseline/report artifacts.

- Inventory every collected case, standalone e2e script, eval manifest, and release check. Record file/case identity, product contract, actual boundary, primary owner test, mocks, required environment, CI/release routing, known failures, and duration. Parameterized cases may share a reviewed family rationale, but every input must be accounted for.
- Install a coverage provider compatible with Vitest. Cover core, local/shared GUI, web components, hosted runtime, UI package, and relay with their actual TS/JS/JSX extensions. Include unexecuted production files; document generated-code exclusions.
- Collect in-process coverage first, then separately instrument Node children, built browser code, and hosted execution. Validate source mappings with a known executed and known unexecuted branch. Mark unavailable surfaces as unmeasured, never zero-gap or covered.
- Publish per-surface line/function/branch results. Ratchet measured baselines and require review of newly uncovered changed branches. Thresholds follow the baseline; no arbitrary 90% target or denominator shrinking.

**Acceptance:** every test surface has an explicit route and measurement status; a deliberately uncovered changed branch is visible; CI publishes reproducible reports. Classification does not require moving hundreds of files.

## Phase 2 — Strengthen deterministic product journeys

**Deliverables:** a self-contained mandatory browser/TUI journey suite with isolated storage and fixture external traffic.

- Split existing browser integration cases from live-agent cases. Start/stop their own server, allocate ports, use temporary homes, and fail on unexpected external requests in deterministic lanes.
- Keep the real application, internal transports, provider adapters, wrappers, cache/rate limiter, and storage. Script model responses/tool calls only at the external boundary. These tests prove application execution, not model decision quality; live evals retain that role.
- Reuse browser-only mocked-transport cases for rendering where useful, but do not count them as full application journeys.

Initial journey matrix:

| Journey | Assertions that matter |
| --- | --- |
| Fresh install/setup → successful research turn | Real tool executes; evidence and as-of data reach the answer/card; secrets stay out of logs/transcript |
| Chat streaming → reload/reopen | One user turn, ordered completion, same persisted answer and tool evidence after reopening |
| Ask-user → response → continuation | Correct session receives the answer; workflow resumes exactly once |
| Retry/reconnect and concurrent sessions | No duplicate accepted action; no cross-session leakage; correct resume/acknowledgement |
| Cancel during tool/workflow execution | Target run stops; unrelated session continues; locks eventually release |
| Provider failure / malformed / stale response | Correct fallback or honest unavailable result; no invented value or stale value labeled live |
| Saved preferences/watchlists/portfolios | Changes made through the application survive reopen and influence the next applicable action |
| Hosted multi-tab/offline/archive/update | Durable writes, correct forwarding, offline restrictions, usable restore, no credential export |
| Mobile/keyboard interaction | Drawer focus and return, usable composer, transcript scrolling and Latest hit target |

Mirror relevant core contracts across GUI and TUI; do not duplicate every GUI layout scenario in the TUI harness. Adapt existing hosted journeys instead of rebuilding them. Split mandatory hosted fixture behavior from live provider/CORS checks currently mixed into that script.

**Acceptance:** selected journeys pass without model keys/public APIs, run in PR CI, clean up after failure, and fail when their intended behavior is deliberately broken. Repeat/shuffle runs to expose shared-state dependencies before promotion.

## Phase 3 — Audit every existing test and consolidate protection

**Deliverables:** reviewed disposition for every inventoried case/family and small cleanup changes with before/after proof.

Use the repo-local [test-audit skill](../../../.agents/skills/test-audit/SKILL.md). For each case ask: what credible defect does it catch, does it exercise the responsible production path, are expectations independent, and does another mandatory test already prove the same contract?

Priority order: GUI source/CSS checks → manually stitched coordinator scenarios → provider-internal mocks → runtime/storage/routing → numerical/security contracts → tooling/package checks. Audit all areas; this ordering is not permission to delete later areas automatically.

- Remove the redundant supplied-ID uniqueness test after confirming the real generator test remains.
- Replace drawer/Latest/home-routing source checks with Phase 2 interactions. Keep distinct branch cases until equivalent proof exists.
- Replace mock implementations of provider wrapper behavior with fixture transport tests. Retain independent financial calculations and failure matrices.
- Replace manually inserted persistence/clarification state with application-driven workflows where the claimed contract is application wiring.
- Retain static architecture, package, security, and protocol contracts when they independently protect something runtime happy paths cannot.
- Mark uncertain candidates for investigation; no bulk removal based on mock count, source reads, filenames, or runtime alone.

**Acceptance per batch:** explicit remaining owner for each removed contract, no unexplained branch loss, replacements demonstrably detect the intended defect, focused validation plus repository gates. Completion means every inventory entry has a reviewed disposition; unresolved entries are reported as unfinished work.

## Phase 4 — Prove the tests, eval checkers, and harness can fail correctly

**Deliverables:** targeted fault/mutation evidence and validated scoring/completion contracts.

- Start with critical areas: price freshness, option units, financial formulas, authorization, duplicate action handling, session targeting, persistence, and cancellation. Mutate a comparison, remove a write, swap a session ID, or drop a required event in isolated validation runs.
- A mutation must fail the intended assertion, not an unrelated timeout/import error. Review surviving mutations for missing assertions, equivalent behavior, or unreachable code. No repo-wide mutation percentage gate initially.
- For each deterministic eval checker, use independently authored valid and invalid traces/answers, including near misses. Confirm semantically equivalent valid answers pass, and fabricated/missing evidence fails; avoid rewarding keyword presence alone.
- Exercise harness crashes, incomplete/truncated traces, timeouts, missing checker registration, zero selected cases, missing credentials, and swallowed child failures. Required suites must report incomplete/blocked or failure, never a false pass.
- Keep benchmark examples in fixtures/manifests. Fix genuine product bugs in the narrowest durable layer; no broad prompt additions to appease a benchmark.
- Review frozen-panel hard assertions as blocking contracts. Judge scores and win counts remain contextual quality evidence, with explicit maintainer review; do not introduce arbitrary judge-score cutoffs. Coordinate assertion/cache changes with the existing competitive proposal.

**Acceptance:** each critical contract has a recorded defect its owning test detects; scorer tests reject known-invalid output; incomplete harness runs cannot produce releasable evidence.

## Phase 5 — Make release evidence complete and traceable

**Deliverables:** versioned report schema, shared release policy, release/publish evidence validation, final artifact smoke.

- Record candidate identity, source/tree digest, dependency lock and suite-definition digests, timestamps, selected case IDs/counts, model/provider/seed settings, fixture versions, results/skips, attempts, coverage, and links to reports. Store redacted evidence as CI/release artifacts; keep raw local traces out of git.
- Extend the existing eval front door and reports rather than adding a competing eval command. A release coordinator may orchestrate deterministic/package checks and consume the front-door report.
- Validate required reports before tag/publication. Cover both local release and tag-triggered publish so direct tagging cannot bypass evidence checks. Publish must consume evidence from a trusted CI job or explicit maintainer-approved workflow, not arbitrary repository JSON.
- Account explicitly for today's version/changelog bump after preflight. Prepare final release metadata before the definitive package check, or verify that only allowlisted release metadata changed since behavioral evals. Any production, dependency, test, or policy change invalidates relevant evidence. Build, hash, smoke-test, and publish the same tarball.
- Proposed default: live evidence must be from the candidate and within 24 hours of release; rerun later releases. Deterministic evidence may be reused only for matching inputs/environment policy. The chosen live window is configurable and reported.
- Missing required credentials/cases/checkers or stale/mismatched reports block release. Optional competitor baselines may be skipped only if declared optional in the release policy with a visible reason; they do not count as wins. Specify which baselines are required when Phase 1 records the maintainer's current cadence.
- The plan originally proposed: "Preserve an explicit emergency waiver with reason, approver,
  affected checks, and expiry in the release report. It must remain visibly waived, never green."
  **Superseded by the maintainer's explicit decision (2026-09-25): every release failure blocks and
  no emergency waiver will be built.** Missing required credentials/cases/checkers or stale/mismatched
  reports block release; the response is a concrete diagnosis and repair, never a waiver. Normal
  publication cannot use the current unrecorded confirmation bypass.

**Acceptance:** dry-run releases reject missing/stale/wrong-candidate reports and failed required cases; a valid candidate succeeds without publishing. Test metadata-only version changes, direct-tag attempts, and mismatched package hashes. Approval of this plan does not authorize an actual publish.

## Phase 6 — Keep the gate trustworthy

**Deliverables:** test authoring guidance, flake ownership, and a compact release summary.

- Make the value checklist part of test review: named contract, credible defect, correct boundary, independent expected result, and explanation of additional protection.
- Preserve all run attempts. No retry-until-green: allow one diagnostic rerun for suspected
  infrastructure failure, classify the cause (product defect, inaccurate assertion, or
  harness/environment), and expose it in the report. A failure is diagnosed, reproduced as a credible
  regression red, fixed at the narrowest durable layer, and verified with a focused run; it never ends
  at a report and is never waived.
- Quarantines need an owner, reason, expiry, and known coverage loss. Critical release journeys cannot
  silently disappear through quarantine; alternate proof is required, and quarantine is never a waiver
  of a release failure.
- Track runtime, failure causes, flake rate, missing coverage, and mutation survivors. Set execution/cost budgets from measurements and keep broad live discovery off the PR path.
- Release summary answers: what candidate/artifact was tested, which user journeys and failure cases
  passed, what was skipped or is still pending, and which risks remain.

**Acceptance:** one real release-candidate rehearsal produces complete evidence; a seeded failure blocks the rehearsal; subsequent release does not require interpreting scattered logs to establish readiness.

## Delivery and approval boundary

Implement sequentially in reviewable changes: Phase 1 measurement → Phase 2 mandatory journeys → Phases 3/4 subsystem batches → Phase 5 evidence enforcement → Phase 6 rollout. Introduce evidence reporting before enforcement so existing legitimate release paths can be demonstrated before becoming mandatory. Unit tests remain useful throughout; no large deletion-first rewrite.

After approval, complete OpenSpec design/spec deltas and tasks before sizable implementation. Follow TDD, live-product verification, `gates:full`, and autoreview for implementation batches. Existing prompt/orchestration/provider/schema approval boundaries still apply. Any unexpectedly broad production redesign returns for a separate proposal.

Planning validation: existing code/configuration and prior audit inspected; `npm run gates` rerun for this handoff. No live paid evals, test changes, CI changes, or release operations are part of creating this plan.
