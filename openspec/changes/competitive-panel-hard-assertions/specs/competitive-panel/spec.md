## ADDED Requirements

### Requirement: Cached competitor answers expire

Cached competitor answers (sourced from past report JSONs under `tests/evals/runs/`) SHALL derive their age from the source report's `generatedAt`; answers older than a maximum age (default 7 days, `OPENCANDLE_COMPETITIVE_CACHE_MAX_AGE_DAYS` override) or from a source with no readable timestamp SHALL be treated as absent: the competitor is rerun live or skipped at preflight, and the outcome is recorded in the report. The existing rule that failed baseline answers (with a recorded `error`) are never reused is unchanged.

#### Scenario: Week-old cache does not compete

- **WHEN** a frozen rerun finds a cached Claude answer recorded 9 days ago
- **THEN** the cached answer is not used and the run either reruns Claude live or records it skipped

#### Scenario: Same-day rerun reuses cache

- **WHEN** a rerun finds a cached answer from earlier the same day
- **THEN** it is reused with its `[cached from ...]` label as today

### Requirement: Judge noise is disclosed, not tuned

The competitive report (which already records `judge: { provider, model }`) SHALL gain a `judgeFamilyConflict` flag, true when the judge's Pi provider id equals a live competitor's mapped family under the explicit map `acpx/gemini → google`, `acpx/claude → anthropic`, `acpx/codex → openai`. The printed summary SHALL label per-prompt judge win counts as single-run noisy and name the deterministic hard assertions as the gating signal. Judge prompts, rubric, and model selection logic are unchanged by this requirement.

#### Scenario: Same-family conflict is flagged

- **WHEN** the judge is `google/gemini-2.5-flash` and the Gemini baseline runs live
- **THEN** the report carries `judgeFamilyConflict: true`

### Requirement: Frozen panel covers the documented loss classes with deterministic checks

The frozen panel SHALL include prompts for these loss classes, each with at least two `finalAnswerHardAssertions` in the prompt-policy manifest and a registered deterministic checker: portfolio-review-not-builder; 1–2-week DTE preservation; protective-put-not-bullish-call; unknown-ticker-no-dead-end; hedge sizing with share count (all existing); ETF holdings overlap by weight; options per-share vs 100-share-contract pricing language; market-closed freshness framing for "what moved today" prompts (new). A frozen run SHALL fail on any hard-assertion failure and SHALL report zero "No deterministic checker registered" gaps. New assertions that fail against current behavior are recorded as findings; production code is not modified in this change to make them pass.

#### Scenario: ETF-overlap prompt is deterministically checked

- **WHEN** the frozen panel runs the ETF-overlap prompt
- **THEN** its hard assertions require holdings-overlap-by-weight content in the final answer and fail an answer that only offers correlation comparison

#### Scenario: Market-closed prompt requires freshness framing

- **WHEN** the frozen panel runs the weekend "what moved today" prompt
- **THEN** its hard assertions require as-of/market-closed framing and fail an answer presenting a price as live

### Requirement: The bottom-line lead assertion accepts enumerated structural equivalents

The "starts with a bottom-line structural portfolio read" assertion SHALL match an enumerated set of structural lead patterns (including the literal "bottom line") within the answer's opening, defined as the first 400 characters of the final answer text. The manifest's `finalAnswerHardAssertions` schema SHALL be extended to a union of the existing plain string and an object form `{ assertion, leadPatterns?: string[], justification?: string }`; the enumerated patterns and the relaxation justification live in that object (JSON carries no comments), and every manifest consumer currently typed `string[]` SHALL handle both forms. The enumeration is closed — extending it requires editing the manifest, not the checker. Note the current checker has no positional logic at all (plain substring anywhere); the opening-window check is new checker behavior driven by `leadPatterns`.

#### Scenario: Equivalent lead passes

- **WHEN** an answer opens with "Critical Evaluation … Structural Allocation Read" followed by portfolio risk content
- **THEN** the assertion passes under the enumerated patterns

#### Scenario: Buried lead still fails

- **WHEN** an answer's first 400 characters contain no lead pattern and a structural read appears only later in the text
- **THEN** the assertion fails

### Requirement: Frozen runs append to the benchmark history ledger

Each frozen-panel run SHALL append one row to a dedicated "## Frozen panel runs" table in `docs/internal/competitive-benchmark-history.md` (columns: Date | Prompts run | Hard assertions | Judge summary | Report paths; the section is created on first append). The existing improvement-loop narrative table is untouched — its Before/After/Gap columns do not fit per-run records. Non-frozen runs do not append.

#### Scenario: Run leaves a ledger row

- **WHEN** a frozen run completes
- **THEN** the history ledger's newest row references that run's report and hard-assertion outcomes
