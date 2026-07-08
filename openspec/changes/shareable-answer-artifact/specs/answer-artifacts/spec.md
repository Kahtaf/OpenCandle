## ADDED Requirements

### Requirement: Deterministic artifact rendering from session entries

The system SHALL render a completed routed finance turn (or comprehensive-analysis run) into a markdown document and a self-contained HTML document as a pure function of the session's recorded entries — no model calls. The document order is: bottom line (final answer), assumptions (route-context slots with provenance), analyst breakdown (comprehensive-analysis only: per-stage signal/conviction, computed tally, rebuttal status), evidence appendix (tool calls with key arguments, result previews, and as-of/freshness when present; the receipts table when an `opencandle-receipts` entry exists; data-quality gaps from `opencandle-turn-gap` entries), and a footer with the OpenCandle version, generation timestamp, and the user-visible disclaimer text. A section whose source entries do not exist SHALL be omitted entirely — no placeholder or empty scaffolding. The HTML SHALL contain no external asset, script, or network reference.

#### Scenario: Full analysis exports with all sections

- **WHEN** a completed `/analyze` run with analyst-step, route-context, evidence, and receipts entries is rendered
- **THEN** the document contains all five sections in order, with the tally matching the analyst-step entries

#### Scenario: Sparse turn exports honestly

- **WHEN** a fallback finance turn with no analyst steps and no receipts entry is rendered
- **THEN** the document contains bottom line, assumptions, evidence appendix, and footer — and no analyst or receipts section

#### Scenario: Rendering is reproducible

- **WHEN** the same entries are rendered twice (generation timestamp injected)
- **THEN** the outputs are byte-identical

### Requirement: GUI export action

Assistant messages of routed finance turns (via a new minimal hover/focus action row containing only Export — the chat UI has no message actions today; this change introduces the affordance) and recent-research items SHALL offer an Export action that downloads the artifact (HTML default, markdown option) from `GET /api/sessions/{id}/artifact?message=<assistantMessageEntryId>&format=...`, protected by the standard trusted-session checks. The server slices from the preceding user message through the anchor assistant message, extending back to an `opencandle-workflow` entry when the span belongs to a workflow run; eligibility is derived client-side from the bootstrap payload's entries (`opencandle-route-context`/`opencandle-workflow` in the turn span). Files are named `opencandle-<workflow>-<SYMBOL>-<YYYY-MM-DD>.<ext>` (symbol omitted when unknown; `opencandle-answer-<date>` for non-workflow turns). When the turn's route context indicates saved market-state was included, the export flow SHALL state that the file contains saved positions before the download proceeds.

#### Scenario: Export downloads a self-contained file

- **WHEN** the user exports a completed NVDA analysis as HTML
- **THEN** the browser downloads `opencandle-comprehensive_analysis-NVDA-<date>.html` that opens correctly with no network access
- **AND** the artifact contains every analyst step of the run, not just the final message's turn

#### Scenario: Saved-state privacy notice

- **WHEN** the exported turn's route context has saved market-state included
- **THEN** the user sees the saved-positions notice before the file downloads

#### Scenario: Untrusted callers are rejected

- **WHEN** the artifact route is called without a trusted browser session
- **THEN** it is rejected exactly like other private GUI routes
