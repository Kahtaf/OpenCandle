## ADDED Requirements

### Requirement: Composer plus button attaches context, not the catalog

The composer's plus button SHALL open an attach menu offering image attachments (PNG/JPEG/WebP, at most 4, at most 5 MB each) and saved-context attachments (portfolio, watchlist, latest report — not "recent analysis", which has no stable id or stored text in v1). Pending attachments SHALL render as removable chips/thumbnails above the textarea and clear on send and on session switch. The plus button SHALL no longer open the catalog; the ⌘K, empty-composer `/`, and top-bar catalog entry points are unchanged.

#### Scenario: Oversized image is rejected client-side

- **WHEN** the user picks a 9 MB PNG
- **THEN** the file is rejected with a visible message and no request is sent

#### Scenario: Catalog keyboard entry points survive

- **WHEN** the user presses ⌘K or types `/` in an empty composer
- **THEN** the catalog overlay opens exactly as before this change

### Requirement: Image attachments reach the model through the Pi session

Chat-run requests SHALL accept an optional `images` array (`{data, mimeType}`), validated server-side (mime allowlist, decoded size ≤5 MB, count ≤4; violations return 400 with a specific reason), and passed to the session layer as Pi `PromptOptions.images`. The cross-process chat-run forwarding proxy SHALL forward the new body fields.

#### Scenario: Image round-trips to the session prompt

- **WHEN** a chat run is submitted with one valid PNG attachment
- **THEN** the session receives `runSession.prompt(text, { images: [...] })` with that image
- **AND** the user bubble renders the typed text with an image thumbnail

#### Scenario: Forwarded run keeps its attachments

- **WHEN** a chat run with attachments is forwarded to another live GUI process that owns the session
- **THEN** the forwarded request carries the same `images`/`attachments` fields

### Requirement: Saved-context attachments expand server-side with user provenance

Saved-context attachments SHALL be resolved server-side through per-object summary formatters extracted into an exported `src/market-state/summaries.ts` (data lines only — the monolithic saved-state builder's LLM steering preamble MUST NOT appear in an attachment block; the builder is refactored to compose the extracted formatters with byte-identical output) and appended to the dispatched prompt as labeled "Attached by user" blocks. The transcript SHALL record and render the user's typed words plus attachment chips via a server-written `opencandle-user-input` marker that preserves the adapter's `original` key with `attachments` beside it; the extension's marker writer SHALL skip turns already covered by an unconsumed marker (so the expanded prompt can never win the last-marker-before-user-message race); and the live-stream adapter's `originalPrompt` and session auto-naming SHALL receive the typed text — never the expanded block, live or after reload.

#### Scenario: Attached portfolio reaches the prompt but not the bubble

- **WHEN** the user attaches their portfolio and sends "am I too concentrated?"
- **THEN** the dispatched prompt contains the portfolio summary in an "Attached by user" block
- **AND** the rendered user bubble shows only "am I too concentrated?" with a Portfolio chip, including after reload

### Requirement: The context drawer shows what the agent saw, with receipts

The context drawer (opened from the composer's eye icon, retitled "What the agent sees") SHALL show, above the existing sections, a Last-turn panel projected from the latest `opencandle-route-context` entry — route kind, workflow, resolved symbols, slot-provenance counts (from the `slots` record's `source` values), prior-turn count, and (when present in the entry) whether saved market-state context was injected — plus the attachment count folded from the turn's `opencandle-user-input` entry, and a Receipts panel from the latest `opencandle-validation` entry (passed / mismatch count) plus analyst-step progress for the active workflow. Every row SHALL render only when its source data exists; absence renders as an explicit "not run/not present" state, never a defaulted value. The drawer's per-tool-run counterpart (`ToolDrawerInline`) is unchanged; the two surfaces do not duplicate content.

#### Scenario: Routed turn populates the Last-turn panel

- **WHEN** a routed turn emits an `opencandle-route-context` entry with symbols and slot sources
- **THEN** the drawer shows the route kind, the symbols, and the provenance counts for that turn

#### Scenario: Validation absence is truthful

- **WHEN** the last turn produced no `opencandle-validation` entry
- **THEN** the Receipts panel shows that no validation ran, not a zero-mismatch claim

#### Scenario: Icon and title communicate the purpose

- **WHEN** the composer renders
- **THEN** the drawer trigger uses the eye icon with tooltip "What the agent sees"
- **AND** the GUI docs describe the drawer
