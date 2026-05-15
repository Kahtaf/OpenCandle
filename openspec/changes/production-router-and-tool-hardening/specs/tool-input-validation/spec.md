## ADDED Requirements

### Requirement: Pre-Flight Symbol Validation in Workflow Templating

Multi-symbol workflow prompts SHALL validate every candidate symbol against `searchTicker` before being templated into the LLM prompt. Symbols that fail validation SHALL be dropped from the templated symbol list and annotated in the rendered prompt so the main agent and downstream tools can see the drop. Validation results SHALL be cached per turn to avoid duplicate lookups within a single workflow.

This requirement applies to: `compare_assets` workflow, `analyze_correlation`-bearing workflow templates, peer-comparison screens, and any future workflow whose template substitutes a `${symbolList}` of length ≥ 2.

#### Scenario: All symbols valid

- **WHEN** the workflow templater receives `["AAPL","MSFT"]` and both pass `searchTicker`
- **THEN** the rendered prompt contains exactly `["AAPL","MSFT"]` with no drop annotation

#### Scenario: One symbol invalid

- **WHEN** the workflow templater receives `["AAPL","XXFAKEXX"]` and `XXFAKEXX` fails `searchTicker`
- **THEN** the rendered prompt substitutes `["AAPL"]` and prepends a `[Pre-flight: dropped 1 unknown symbol — XXFAKEXX (no matching ticker found via search-ticker)]` annotation
- **AND** an `opencandle-symbol-preflight-dropped` custom entry is appended

#### Scenario: Comparison workflow with too few survivors

- **WHEN** the workflow templater receives `["IV","XXFAKEXX"]` for a comparison workflow and both fail `searchTicker`
- **THEN** the workflow is NOT templated
- **AND** the templater returns a fallback prompt instructing the main agent to invoke `ask_user` with a clarifying question that names the dropped symbols
- **AND** an `opencandle-workflow-aborted` custom entry is appended with `{ reason: "preflight-insufficient-symbols", dropped: [...] }`

#### Scenario: Per-turn validation cache hit

- **WHEN** the workflow templater validates `AAPL` once during a turn, and a downstream prompt template within the same turn validates `AAPL` again
- **THEN** the second validation reads from the per-turn cache without making a second `searchTicker` call
