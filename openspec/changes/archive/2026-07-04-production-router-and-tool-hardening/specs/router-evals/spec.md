## ADDED Requirements

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

Each `npm run eval:router-live` run executed for acceptance verification SHALL be archived under `tests/fixtures/router/eval-baselines/<YYYY-MM-DD>.txt` with the full per-fixture pass/fail output, latency p50/p95, and total cost. Inadmissible runs (e.g., missing API credentials) SHALL be labeled as such in the archive.

#### Scenario: Acceptance run archived

- **WHEN** an acceptance verification run completes
- **THEN** a file at `tests/fixtures/router/eval-baselines/<date>.txt` exists containing the full eval output

#### Scenario: Inadmissible run labeled

- **WHEN** the eval is run without credentials and the output shows the deterministic-fallback shape on every fixture
- **THEN** the archive entry is annotated `INADMISSIBLE: missing ANTHROPIC_API_KEY` (or equivalent provider)
- **AND** that run is NOT used to compute the acceptance gate
