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

Deterministic fixtures SHALL be seeded from sampled real production conversations (anonymized) when available. Synthetic fixtures MAY be added for edge cases, including multi-turn behavior, and SHALL NOT dominate the set — the emphasis is on real-turn-derived coverage. When real multi-turn sessions are not yet available for sampling, synthesized multi-turn fixtures SHALL be used to cover the required classes of behavior and SHALL be clearly tagged to enable later replacement with sampled real sessions.

#### Scenario: Seed set is real-turn-based

- **WHEN** the eval harness is first set up
- **THEN** the majority of single-turn seed fixtures originate from sampled real conversations, not synthetic constructions

#### Scenario: Synthetic multi-turn fixtures allowed in absence of real samples

- **WHEN** no real sampled multi-turn sessions are available
- **THEN** synthetic multi-turn fixtures MAY be authored, and each SHALL carry the tag `synthetic-multi-turn` in its `tags` array so reviewers can distinguish them from sampled-real fixtures at a glance

### Requirement: PII Anonymization

Fixtures SHALL strip personally-identifying information — account balances, exact dollar holdings, real names — while preserving classification-relevant signal (tickers, horizons, risk phrasing, workflow type). Multi-turn fixtures SHALL anonymize consistently within a single fixture: if a ticker or bucketed placeholder is used for an entity in one turn, the same anonymization SHALL be used for the same entity across all turns of that fixture. Different fixtures may pick different anonymizations independently; no suite-wide mapping is required.

#### Scenario: Fixture redacts a balance

- **WHEN** a real turn contains "I have $847,392.14 in my account"
- **THEN** the fixture version replaces the exact balance with a bucketed placeholder (e.g., "$500k-$1M") or a generic `<ANONYMIZED_BALANCE>` marker

#### Scenario: Fixture preserves classification signal

- **WHEN** a real turn contains "invest $50k in tech ETFs, I'm aggressive"
- **THEN** the anonymized fixture still enables classification to `portfolio_builder` with `asset_scope = "etf_focused"` and `risk_profile = "aggressive"`

#### Scenario: Multi-turn fixture uses consistent anonymization

- **WHEN** a multi-turn fixture's first turn references a ticker or balance
- **THEN** all subsequent turns of that same fixture use the exact same anonymized form for that entity (same ticker symbol, same bucket placeholder), so coreference assertions remain valid

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

### Requirement: Typed Route Eval Coverage

Router evals SHALL include deterministic and live cases for each canonical route kind: `workflow_dispatch`, `agent_task`, `clarification`, and `pass_through`.

#### Scenario: Workflow dispatch eval passes

- **WHEN** an eval prompt clearly maps to a known workflow
- **THEN** the expected output asserts `routeKind: "workflow_dispatch"` and the workflow name

#### Scenario: Agent task eval passes

- **WHEN** an eval prompt is an in-scope finance analysis request without a matching workflow
- **THEN** the expected output asserts `routeKind: "agent_task"` and relevant entities

#### Scenario: Clarification eval passes

- **WHEN** an eval prompt is missing a required slot and no reliable memory fills it
- **THEN** the expected output asserts `routeKind: "clarification"` and the missing slot names

#### Scenario: Pass-through eval passes

- **WHEN** an eval prompt is outside OpenCandle's finance task surface
- **THEN** the expected output asserts `routeKind: "pass_through"`

### Requirement: Tool Scope Eval Reporting

Router and competitive eval reports SHALL include selected tool bundles, active tool names when available, and any attempted out-of-bundle tool calls.

#### Scenario: Eval reports selected bundles

- **WHEN** a harness run completes
- **THEN** the report includes the route-selected tool bundles for each prompt

#### Scenario: Eval reports unnecessary exposure

- **WHEN** a prompt expected to need only core market tools exposes options tools
- **THEN** the report marks unnecessary tool exposure for that prompt

### Requirement: Memory Use Eval Reporting

Router and competitive eval reports SHALL include memory categories retrieved, memory items used for slot filling, and filtered stale or low-trust memory counts when those data are available.

#### Scenario: Eval reports preference memory source

- **WHEN** a prompt relies on a saved investor preference
- **THEN** the report shows the preference memory category and slot source provenance

#### Scenario: Eval reports stale memory filtering

- **WHEN** candidate memory is filtered out by staleness or trust rules
- **THEN** the report includes a filtered-memory count or diagnostic

### Requirement: Clarification Quality Eval

Router evals SHALL measure whether clarification is requested only when required and whether the missing slots are specific enough for the main agent to ask a useful question.

#### Scenario: Missing symbol clarification is specific

- **WHEN** the user asks "build me an options setup" without a symbol
- **THEN** the eval expects `missing_required` to include `"symbol"` rather than a generic `"details"` field

#### Scenario: Clarification is not over-used

- **WHEN** prior context reliably supplies the missing symbol
- **THEN** the eval expects no clarification route for that symbol

### Requirement: Multi-Turn Fixture Coverage

The deterministic fixture set SHALL include multi-turn fixtures (fixtures with non-empty `priorTurns` arrays) that exercise at least the following classes of behavior: coreference resolution against a prior ticker, carrying prior-turn entity context without violating slot provenance, topic shift that invalidates prior context, user correction of a prior entity, preference-conflict resolution between the profile snapshot and the current-turn signal, and dollar-phrase non-leakage from prior turns into current-turn slots. At least one fixture per listed class SHALL be present.

#### Scenario: Each required class is represented by at least one fixture

- **WHEN** the deterministic fixture suite is loaded and bucketed by behavior class (via tags or inspection)
- **THEN** every listed class (coreference, carried-context, topic-shift, correction, preference-conflict, dollar-phrase-preservation) has at least one fixture whose `priorTurns.length > 0` and whose `expectedRouterOutput` reflects that class's expected behavior

### Requirement: Prior-Turn-Derived Values Populate Entities, Not Slots

To preserve the settled source-enum semantics (`user` = THIS turn's text, `preference` = profileSnapshot, `default` = workflow fallback; see archived `llm-intent-router/design.md` §8), prior-turn-derived entity values SHALL land in `RouterOutput.entities` but SHALL NOT be emitted as `RouterOutput.slots` entries. The `missing_required` field SHALL NOT flag a required slot as missing when the value is available in `entities` (whether from the current turn, prior turns, or profile); required-slot resolution uses `entities` first and only flags values that remain absent after that lookup.

#### Scenario: Coreference fixture

- **WHEN** the fixture has `priorTurns: [{role:"user", text:"tell me about NVDA"}, {role:"assistant", text:"..."}]` and `input: "what about at $500?"`
- **THEN** `expectedRouterOutput.entities.symbols` contains `["NVDA"]`; `slots` contains no `symbol` slot (NVDA is prior-turn-derived); the fixture is tagged `multi-turn-coreference`

#### Scenario: Carried-context fixture

- **WHEN** the fixture has `priorTurns: [{role:"user", text:"build portfolio for $20k"}]` and `input: "make it aggressive"`
- **THEN** `expectedRouterOutput.entities.budget` equals `20000`; `expectedRouterOutput.slots` contains `risk_profile` (source `user`, from the current turn) but SHALL NOT contain a `budget` slot (budget is prior-turn-derived); `missing_required` does NOT list `budget`

#### Scenario: Topic-shift fixture

- **WHEN** the fixture has `priorTurns` about BTC and `input: "tell me about NVDA"`
- **THEN** `expectedRouterOutput.entities.symbols` contains `["NVDA"]` only (BTC SHALL NOT leak into entities or slots)

#### Scenario: Correction fixture

- **WHEN** the fixture has `priorTurns: [{role:"user", text:"analyze TSLA"}]` and `input: "I meant TSLAQ"`
- **THEN** `expectedRouterOutput.entities.symbols` contains `["TSLAQ"]` only

#### Scenario: Preference-conflict fixture

- **WHEN** the fixture has `profileSnapshot: { risk_profile: "aggressive" }` and `input` expresses a more cautious disposition
- **THEN** `expectedRouterOutput.preference_updates` contains an inferred `risk_profile` update at high confidence reflecting the current-turn signal

#### Scenario: Dollar-phrase-preservation fixture

- **WHEN** the fixture has `priorTurns: [{role:"user", text:"$500k in SPY"}]` and `input: "same for QQQ"`
- **THEN** `expectedRouterOutput.entities.symbols` contains `["QQQ"]` (and may also carry `["SPY"]`); `slots` does NOT contain a dollar-derived slot from the prior turn (no `budget: 500000` in slots)

### Requirement: Fixture Count Baseline After Seeding

`tests/fixtures/router/BASELINE.json` SHALL reflect the actual number of checked-in fixtures. When fixtures are added or removed, `fixtureCount` and `recordedAt` SHALL be updated in the same commit.

#### Scenario: Baseline reflects disk state

- **WHEN** the deterministic fixture suite is loaded
- **THEN** the count of `.json` files (excluding `BASELINE.json`) equals `BASELINE.json.fixtureCount`

### Requirement: Multi-Turn Fixture Presence Guard

The router fixture unit test suite SHALL include an assertion that at least one fixture has `priorTurns.length > 0`. This guards against silent regression to a single-turn-only fixture set.

#### Scenario: Guard test fails when multi-turn coverage disappears

- **WHEN** all multi-turn fixtures are deleted and the suite is run
- **THEN** at least one test failure surfaces the missing multi-turn coverage

### Requirement: Acronym Disambiguation Fixtures

The deterministic router fixture suite SHALL include fixtures that exercise the acronym-disambiguation post-filter for at least the following classes:

- Bare finance acronym treated as the metric/concept it represents (IV-as-Implied-Volatility, SEC-as-regulator, FED-as-bank, CPI-as-metric).
- Acronym retained when a positive ticker signal is present (`$IV`).
- Acronym dropped when it is bare in a list alongside non-dictionary candidates (`compare KO, IV, PEP`).
- Acronym retained when a local ticker phrase is present (`compare KO, the IV ticker, and PEP`).

Each fixture SHALL include the expected post-filter outcome in `expectedRouterOutput.entities.symbols` (i.e., the dictionary tokens are absent when no signal is present, retained when at least one signal is present).

#### Scenario: IV-as-volatility fixture exists

- **WHEN** the fixture suite is loaded
- **THEN** there is a fixture whose input contains "IV" with no positive signal AND whose `expectedRouterOutput.entities.symbols` excludes `"IV"`
- **AND** the fixture's `tags` array contains `acronym-disambiguation`

#### Scenario: Positive-signal fixture exists

- **WHEN** the fixture suite is loaded
- **THEN** there is a fixture whose input contains `$IV` AND whose `expectedRouterOutput.entities.symbols` includes `"IV"`
- **AND** the fixture's `tags` array contains `acronym-disambiguation`

#### Scenario: Bare-list fixture exists

- **WHEN** the fixture suite is loaded
- **THEN** there is a fixture whose input contains a bare acronym listed alongside non-dictionary candidates AND whose `expectedRouterOutput.entities.symbols` excludes the acronym
- **AND** the fixture's `tags` array contains `acronym-disambiguation`

#### Scenario: Local ticker phrase fixture exists

- **WHEN** the fixture suite is loaded
- **THEN** there is a fixture whose input contains a local phrase such as "IV ticker" AND whose `expectedRouterOutput.entities.symbols` includes `"IV"`
- **AND** the fixture's `tags` array contains `acronym-disambiguation`

### Requirement: Live-Eval Baseline Archived per Run

Each `npm run eval -- router-live` run executed for acceptance verification SHALL be archived under `tests/fixtures/router/eval-baselines/<YYYY-MM-DD>.txt` with the full per-fixture pass/fail output, latency p50/p95, and total cost. Inadmissible runs (e.g., missing API credentials) SHALL be labeled as such in the archive.

#### Scenario: Acceptance run archived

- **WHEN** an acceptance verification run completes
- **THEN** a file at `tests/fixtures/router/eval-baselines/<date>.txt` exists containing the full eval output

#### Scenario: Inadmissible run labeled

- **WHEN** the eval is run without credentials and the output shows the deterministic-fallback shape on every fixture
- **THEN** the archive entry is annotated `INADMISSIBLE: missing ANTHROPIC_API_KEY` (or equivalent provider)
- **AND** that run is NOT used to compute the acceptance gate
