## ADDED Requirements

### Requirement: Receipt binding runs on every routed finance answer

For every routed finance turn (workflow or fallback; never pass-through) that made at least one tool call, the system SHALL run a receipt-binding pass over the final assistant answer, in the extension's `turn_end` handling (`src/pi/` change authorized by this proposal, scoped to this addition): read the turn's `ResolvedTurnContext` before `restoreRouteToolScope()` clears it to determine `routeKind`; detect workflow turns from workflow-dispatch state (comprehensive analysis bypasses the router). Claim extraction is the union of the existing metric-anchored pass and a new `extractAnswerNumbers` pass in `numeric-claims.ts` (currency amounts, percentages, ≥3-significant-digit decimals; excluding standalone years 1900–2100, inline-code content, share-multiplier phrases, and list markers). Tool numbers are collected per tool call from the turn's session tool-result entries (full `details`, not truncated evidence digests), keyed `${tool}#${callIndex}.${path}`. Binding uses `checkNumberMatch`'s existing tolerance. The pass emits one `opencandle-receipts` entry: `claims: [{ text, value, metric?, binding: { tool, callIndex, valuePath, freshness? } | null }]`, `boundCount`, `unboundCount`. The pass is observe-only — it SHALL NOT modify, block, or re-prompt the answer. Turns with zero tool calls emit no entry.

#### Scenario: Quoted price binds to its tool call

- **WHEN** a routed turn's answer says "AAPL is trading at $197.14" and the turn's tool results contain a `get_stock_quote` call with price 197.13999938964844
- **THEN** the `opencandle-receipts` entry binds that claim to `get_stock_quote` with the matching call index and value path (rounding tolerance per the existing matcher)

#### Scenario: Repeated tool calls bind distinctly

- **WHEN** a compare turn calls `get_stock_quote` twice (AAPL then MSFT) and the answer quotes both prices
- **THEN** each claim binds to its own call index — the second call does not overwrite the first's numbers

#### Scenario: Unbound number is recorded, not punished

- **WHEN** the answer contains a numeric claim matching no tool number
- **THEN** the claim appears with `binding: null` and `unboundCount` reflects it
- **AND** the answer is delivered unchanged

#### Scenario: Pass-through and tool-less turns are silent

- **WHEN** a turn is pass-through, or routed but made no tool calls
- **THEN** no `opencandle-receipts` entry is emitted

#### Scenario: Freshness rides along when present

- **WHEN** the bound evidence record carries a freshness stamp
- **THEN** the binding includes it

### Requirement: False-positive measurement gates the GUI milestone

Before any GUI rendering lands, the implementation SHALL run at least 10 live routed sessions across prompt families with the binding pass emitting trace entries, hand-classify every unbound claim and mismatch as true or false positive, and record the classification table in the PR. If more than 1 in 10 unbound classifications is a false positive, the GUI milestone SHALL NOT proceed; the finding is reported and the fix goes into the extraction/matching layer first.

#### Scenario: Noisy extraction stops the rollout

- **WHEN** the measurement shows 3 of 20 unbound claims are false positives
- **THEN** the GUI milestone is not implemented and the PR records the finding and the affected claim shapes

### Requirement: GUI renders receipts render-if-present

Assistant messages whose turn produced an `opencandle-receipts` entry SHALL render a footer line stating how many numbers matched tool data ("N of M numbers matched to tool data"), expandable to a table of claim text → tool → tool value → as-of (when freshness is present). Unbound claims render with the neutral label "not matched to tool data". Messages without a receipts entry render exactly as today.

#### Scenario: Footer reflects the entry

- **WHEN** a turn's receipts entry has `boundCount: 8, unboundCount: 1`
- **THEN** the message footer reads "8 of 9 numbers matched to tool data" and expands to the 9-row table with the unbound row flagged neutrally

#### Scenario: Absence changes nothing

- **WHEN** a message's turn has no receipts entry
- **THEN** no footer or receipts UI renders for it
