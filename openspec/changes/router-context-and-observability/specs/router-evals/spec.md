## ADDED Requirements

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

## MODIFIED Requirements

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

### Requirement: Fixtures Sourced from Sampled Real Turns

Deterministic fixtures SHALL be seeded from sampled real production conversations (anonymized) when available. Synthetic fixtures MAY be added for edge cases, including multi-turn behavior, and SHALL NOT dominate the set — the emphasis is on real-turn-derived coverage. When real multi-turn sessions are not yet available for sampling, synthesized multi-turn fixtures SHALL be used to cover the required classes of behavior and SHALL be clearly tagged to enable later replacement with sampled real sessions.

#### Scenario: Seed set is real-turn-based

- **WHEN** the eval harness is first set up
- **THEN** the majority of single-turn seed fixtures originate from sampled real conversations, not synthetic constructions

#### Scenario: Synthetic multi-turn fixtures allowed in absence of real samples

- **WHEN** no real sampled multi-turn sessions are available
- **THEN** synthetic multi-turn fixtures MAY be authored, and each SHALL carry the tag `synthetic-multi-turn` in its `tags` array so reviewers can distinguish them from sampled-real fixtures at a glance
