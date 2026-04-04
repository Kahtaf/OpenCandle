## ADDED Requirements

### Requirement: Baseline storage
Eval baselines SHALL be stored in `tests/evals/baseline.json`, checked into git. The baseline file SHALL contain per-case scores from the last accepted eval run.

#### Scenario: Baseline file structure
- **WHEN** a baseline exists
- **THEN** it SHALL contain a JSON object mapping eval case names to their last accepted scores and per-layer detail

#### Scenario: First run with no baseline
- **WHEN** evals run and no `baseline.json` exists
- **THEN** the eval report SHALL show `baseline: null` and `delta: null` with no regression flag

### Requirement: Regression detection
The eval framework SHALL compare current eval scores against the baseline and flag regressions at two levels: (1) aggregate regression when the overall score drops more than 0.05 below the baseline, and (2) safety-critical per-case blocking when any Layer 4 (data faithfulness) or Layer 5 (risk disclosure) score drops to 0 on an always-tier case. A safety-critical failure SHALL cause a hard fail regardless of aggregate score.

#### Scenario: Aggregate score drops below threshold
- **WHEN** the current aggregate score is 0.82 and the baseline is 0.90 (delta = -0.08)
- **THEN** the eval report SHALL set `regression: true` and list the regressed cases

#### Scenario: Aggregate score within noise threshold
- **WHEN** the current aggregate score is 0.88 and the baseline is 0.90 (delta = -0.02)
- **THEN** the eval report SHALL set `regression: false`

#### Scenario: Score improves
- **WHEN** the current aggregate score is 0.95 and the baseline is 0.90
- **THEN** the eval report SHALL list the improved cases

#### Scenario: Safety-critical per-case failure
- **WHEN** a single always-tier eval case scores 0 on Layer 4 (faithfulness) or Layer 5 (risk disclosure), even if the aggregate score is above threshold
- **THEN** the eval report SHALL set `regression: true` and flag the specific case as a safety-critical failure

### Requirement: Baseline update workflow
Baselines SHALL be updated explicitly via a CLI command (`npx oc-eval --update-baseline`). Baselines SHALL NOT auto-update after eval runs.

#### Scenario: Manual baseline update
- **WHEN** a developer runs the baseline update command after reviewing eval results
- **THEN** `baseline.json` SHALL be overwritten with current per-case scores

#### Scenario: No accidental baseline update
- **WHEN** a standard eval run completes
- **THEN** `baseline.json` SHALL remain unchanged

### Requirement: Eval report format
Each eval run SHALL produce an `EvalReport` containing: per-case scores with layer detail, aggregate weighted score, baseline comparison (delta, regression flag), and lists of improved/regressed/unchanged cases.

#### Scenario: Report with baseline comparison
- **WHEN** an eval run completes with an existing baseline
- **THEN** the report SHALL include `delta`, `regression` flag, and per-case categorization (improved/regressed/unchanged)

#### Scenario: Report output
- **WHEN** an eval run completes
- **THEN** the report SHALL be written to stdout in a human-readable format and optionally to a JSON file for programmatic consumption
