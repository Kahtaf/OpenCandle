## Purpose
Router evals provide deterministic and opt-in live coverage for router behavior, fixture stability, and routing regressions.
## Requirements
### Requirement: Two-Tier Eval Structure

The router SHALL have two eval tiers: (1) deterministic CI fixtures that run on every PR without live model calls, and (2) an opt-in live-run eval that developers invoke locally. The two tiers SHALL have clearly separated responsibilities: CI enforces deterministic correctness of router code; live eval measures real-model behavior against labeled real turns.

#### Scenario: CI runs deterministic fixtures

- **WHEN** a PR triggers CI
- **THEN** the deterministic router fixture suite runs without making any live LLM API calls and reports pass/fail

#### Scenario: Live eval is not invoked by CI

- **WHEN** CI runs on any PR
- **THEN** the live-eval script (`tests/scripts/run-live-router-eval.ts`) is NOT invoked automatically; it runs only when a developer executes it locally

### Requirement: Deterministic Fixture Format

Deterministic fixtures SHALL be JSON files in `tests/fixtures/router/` with the shape `{ input, priorTurns, profileSnapshot, expectedRouterOutput, tags }`. The `expectedRouterOutput` is a recorded snapshot of the router's output for that input, reviewed and committed at fixture creation time.

#### Scenario: Fixture file loads

- **WHEN** the eval harness loads a fixture file
- **THEN** the file parses successfully and contains all required fields (input, priorTurns, profileSnapshot, expectedRouterOutput, tags)

### Requirement: Fixtures Sourced from Sampled Real Turns

Deterministic fixtures SHALL be seeded from sampled real production conversations (anonymized). Synthetic fixtures MAY be added for edge cases but SHALL NOT dominate the set — the seed emphasis is on real-turn-derived coverage.

#### Scenario: Seed set is real-turn-based

- **WHEN** the eval harness is first set up
- **THEN** the majority of seed fixtures originate from sampled real conversations, not synthetic constructions

### Requirement: PII Anonymization

Fixtures SHALL strip personally-identifying information — account balances, exact dollar holdings, real names — while preserving classification-relevant signal (tickers, horizons, risk phrasing, workflow type).

#### Scenario: Fixture redacts a balance

- **WHEN** a real turn contains "I have $847,392.14 in my account"
- **THEN** the fixture version replaces the exact balance with a bucketed placeholder (e.g., "$500k-$1M") or a generic `<ANONYMIZED_BALANCE>` marker

#### Scenario: Fixture preserves classification signal

- **WHEN** a real turn contains "invest $50k in tech ETFs, I'm aggressive"
- **THEN** the anonymized fixture still enables classification to `portfolio_builder` with `asset_scope = "etf_focused"` and `risk_profile = "aggressive"`

### Requirement: Diff-Based Assertion with Tolerance for Reasoning Field

Both eval tiers SHALL compare router output against the fixture `expectedRouterOutput` field using JSON-structured diff. The `reasoning` field SHALL be exempt from exact-match comparison in both tiers.

#### Scenario: Matching output passes

- **WHEN** the router output matches `expectedRouterOutput` on all fields except `reasoning`
- **THEN** the fixture passes

#### Scenario: Mismatched route fails

- **WHEN** `expectedRouterOutput.route = "workflow"` but router returns `"fallback"`
- **THEN** the fixture fails with a diff report naming the field

#### Scenario: Reasoning-only differences pass

- **WHEN** the only difference between router output and `expectedRouterOutput` is the `reasoning` string
- **THEN** the fixture passes

### Requirement: CI Merge Gate on Deterministic Fixtures Only

CI SHALL merge-gate on the deterministic fixture pass-rate. The baseline SHALL be `100%` — any deterministic fixture failure blocks the merge. Baseline lowering requires explicit PR documentation and approval.

#### Scenario: Deterministic fixture failure blocks merge

- **WHEN** a PR causes any deterministic fixture to fail
- **THEN** CI fails with a named-fixture report

#### Scenario: Live eval does not gate merge

- **WHEN** a PR is ready to merge
- **THEN** no check from the live eval script is required to pass CI

### Requirement: Live Eval Reporting

When invoked, the opt-in live eval script SHALL emit a summary report containing per-fixture pass/fail (against labeled expectations with reasoning-field exemption), aggregate pass-rate, and latency statistics (p50 and p95 of router call duration).

#### Scenario: Live eval summary is produced

- **WHEN** a developer invokes the live eval script
- **THEN** a report is printed or written that includes every fixture's pass/fail result, aggregate pass-rate, and p50/p95 router latency

### Requirement: Live Eval Usage Guidance

The repository SHALL document when and how to run the live eval: before PRs that modify router prompt, model choice, schema, or output handling; and how to interpret delta reports against the baseline pass-rate committed in `tests/fixtures/router/BASELINE.json`.

#### Scenario: Live eval is documented

- **WHEN** a developer reads the router testing documentation
- **THEN** they can find instructions for running the live eval script and the criteria for considering a delta acceptable

### Requirement: Router Evals Cover Task-Family Selection

Router deterministic and live evals SHALL assert task-family selection in addition to route kind, workflow, entities, slots, tool bundles, and missing required fields.

#### Scenario: Sentiment prompt selects sentiment task family

- **WHEN** a router eval input asks whether retail mood around a ticker has shifted
- **THEN** the expected router output includes a sentiment-oriented task family and the sentiment tool bundle

#### Scenario: Concept prompt selects concept task family

- **WHEN** a router eval input asks for an educational explanation without named securities or current examples
- **THEN** the expected router output includes a concept-explainer task family and no active finance tool bundle

#### Scenario: Retail tradeoff prompt selects retail task family

- **WHEN** a router eval input asks about brokerage choice, safe cash products, mortgage-vs-investing, tax-loss harvesting, or crypto sizing
- **THEN** the expected output includes a retail tradeoff-oriented task family or planning diagnostic
- **AND** it does not require market-data tools unless current security-specific facts are requested

### Requirement: Router Evals Cover Commitment Mode

Router deterministic and live evals SHALL assert commitment mode where the prompt's requested answer shape is material to behavior.

#### Scenario: Decision prompt selects decision mode

- **WHEN** a router eval input asks whether to buy, wait, or avoid a security
- **THEN** the expected output includes a decision-oriented commitment mode

#### Scenario: Tradeoff prompt selects comparison mode

- **WHEN** a router eval input asks for pros and cons or tradeoffs without asking for a portfolio build
- **THEN** the expected output includes a comparison-oriented commitment mode

### Requirement: Router Evals Preserve Existing Routing Expectations

Adding task-family assertions SHALL NOT weaken existing route/workflow fixture expectations. Existing route kind, workflow, entity, slot, tool-bundle, prior-turn, and memory expectations SHALL remain part of router evals.

#### Scenario: Existing workflow dispatch remains asserted

- **WHEN** a portfolio-builder fixture is updated with task-family metadata
- **THEN** the fixture still asserts workflow dispatch, required slots, slot provenance, and tool bundles

#### Scenario: Existing clarification behavior remains asserted

- **WHEN** a missing-symbol options fixture is updated with task-family metadata
- **THEN** the fixture still asserts clarification route kind and missing required fields

### Requirement: Router Live Eval Reports Planning Accuracy

The live router eval SHALL report task-family accuracy separately from route/workflow accuracy. It SHALL report policy-card accuracy for migrated or dual-run behaviors where policy-card expectations are defined.

#### Scenario: Live eval reports task-family pass rate

- **WHEN** a developer runs the live router eval
- **THEN** the report includes aggregate route accuracy, workflow accuracy, task-family accuracy, and any defined policy-card accuracy

#### Scenario: Task-family failure does not hide route success

- **WHEN** the live router chooses the correct route kind but wrong task family
- **THEN** the report records route success and task-family failure separately

#### Scenario: Commitment-mode accuracy is reported

- **WHEN** live router eval cases include commitment-mode expectations
- **THEN** the report includes commitment-mode accuracy separately from route and task-family accuracy

### Requirement: Router Evals Cover Followup Context

Router evals SHALL include multi-turn cases where prior context determines task family, commitment mode, entity replacement, or clarification behavior.

#### Scenario: Followup entity replacement

- **WHEN** a prior turn asked about VOO versus QQQ and the followup asks "what about SCHD instead?"
- **THEN** the expected output preserves the comparison task shape and identifies the replaced entity

#### Scenario: Ambiguous followup asks clarification

- **WHEN** a followup uses "that" or "same thing" and prior context is insufficient
- **THEN** the expected route or planning diagnostics require clarification rather than silent guessing

