## ADDED Requirements

### Requirement: Memory is organized into typed categories
The memory system SHALL organize stored data into four categories: `investor_profile` (risk tolerance, goals, account types), `interaction_feedback` (corrections, confirmed approaches), `workflow_history` (past workflow runs and outcomes), and `references` (external links, data source notes).

#### Scenario: Preference is categorized as investor profile
- **WHEN** the system stores a user's risk tolerance as "aggressive"
- **THEN** it is stored in the `investor_profile` category

#### Scenario: Workflow run is categorized as workflow history
- **WHEN** a portfolio builder run completes
- **THEN** the run summary is stored in the `workflow_history` category

### Requirement: Memory retrieval is selective based on workflow context
The `MemoryManager` SHALL retrieve only memory categories relevant to the current workflow and query context, not all stored memory.

#### Scenario: Portfolio workflow retrieves investor profile and relevant history
- **WHEN** memory is retrieved for a `portfolio_builder` workflow
- **THEN** `investor_profile` and recent `workflow_history` for portfolio workflows are included
- **THEN** `interaction_feedback` about portfolio workflows is included
- **THEN** unrelated workflow history (e.g., options screener runs from weeks ago) is excluded

#### Scenario: General query retrieves minimal memory
- **WHEN** memory is retrieved for a `general_finance_qa` query about "what is RSI"
- **THEN** only basic `investor_profile` (if any) is retrieved, not workflow history or feedback

### Requirement: Memory entries have staleness rules per category
Each memory category SHALL define staleness thresholds. The retrieval system SHALL exclude entries that exceed their category's staleness threshold.

#### Scenario: Investor profile persists for months
- **WHEN** a risk tolerance was recorded 2 months ago
- **THEN** it is still included in retrieval (investor profile staleness threshold is long)

#### Scenario: Market thesis decays within days
- **WHEN** a stored market thesis ("tech sector is overvalued") was recorded 2 weeks ago
- **THEN** it is excluded from retrieval or flagged as stale

#### Scenario: Specific prices are never trusted from memory
- **WHEN** memory contains a stored price ("AAPL was $185" from 3 days ago)
- **THEN** it is never injected into prompt context — prices must always be fetched live

### Requirement: Retrieved memory includes freshness metadata
Each memory entry returned by retrieval SHALL include its `recordedAt` timestamp and category so the prompt builder can contextualize it appropriately.

#### Scenario: Memory entry includes age context
- **WHEN** an investor profile entry from 30 days ago is retrieved
- **THEN** the entry includes `recordedAt: "2026-03-03T..."` and `category: "investor_profile"` so the prompt can indicate "recorded 30 days ago"

### Requirement: Overridden slots suppress corresponding memory
When current-turn user input overrides a slot value, the corresponding memory entries SHALL be suppressed from retrieval to avoid conflicting provenance signals. This preserves the existing behavior in `buildMemoryContext()`.

#### Scenario: User-specified risk profile suppresses stored preference
- **WHEN** the user says "build me an aggressive portfolio" (specifying risk profile)
- **THEN** any stored `investor_profile` entry for risk tolerance is excluded from the memory context for this turn
