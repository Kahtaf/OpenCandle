## ADDED Requirements

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
