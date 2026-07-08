# Answer Receipts (I8 Phase 3): Bind Final-Answer Numbers to Evidence

## Why

The public homepage sells "the evidence receipt behind a sample answer"; the runtime should make that a guarantee. Phase 1 already exists and self-describes as such: `src/runtime/numeric-claims.ts` (claim extraction + tool-number flattening, header comment names the "answer-receipts direction"), `checkNumberMatch` in `src/runtime/validation.ts`, and the `opencandle-validation` entry from `emitSynthesisValidation` — but it runs only on comprehensive-analysis synthesis, its results bind to nothing user-visible, and unbound numbers vanish. Phase 2 (`freshness-ledger`) puts as-of stamps on evidence. Phase 3 links every numeric claim in a final answer to its evidence record and surfaces the binding — observe-only, no enforcement.

The high-leverage plan gated this phase on measuring the validator's real-world false-positive rate after the 2026-07-04 conservative-extraction fixes (whole-word metric matching, thousands separators, rounding tolerance — the 34-garbage-mismatches bug). That measurement is this change's first milestone and an explicit STOP gate.

## What Changes

**Milestone 0 — false-positive measurement (STOP gate).**
Run ≥10 live routed sessions across families (single-asset, compare, options, macro, portfolio review) with the binding pass in trace-only mode; hand-classify every unbound claim and mismatch as true/false positive; record the table in the PR. **If false-unbound precision is worse than 1 in 10 claims, STOP and report** — the fix belongs in extraction heuristics, and the GUI milestone must not proceed on noisy data.

**Milestone 1 — receipt binding pass (trace).**
- **Where it runs (verified 2026-07-05 — the session coordinator has no per-turn final-answer hook):** in the extension's `turn_end` handler (`src/pi/opencandle-extension.ts` ~:305, where `isFinalAssistantTurn` = assistant message with `stopReason === "stop"`). The pass must read `currentRouteToolContext` (the turn's `ResolvedTurnContext`, giving `routeKind`) **before** `restoreRouteToolScope()` clears it inside the same handler (~:310). Comprehensive-analysis turns bypass the router, so workflow runs are detected from the workflow-dispatch state, not `routeKind`. **`src/pi/` is an AGENTS.md ask-first area: this proposal is the authorization, scoped to exactly this turn_end addition.**
- **Evidence source:** fallback/general-finance turns produce **no** `EvidenceRecord`s today (evidence capture runs only inside workflow steps). The pass therefore collects tool numbers directly from the exchange's session tool-result entries (a new shared collector over `message.details` + result text in `numeric-claims.ts`), keyed **per tool call** — `${tool}#${callIndex}.${path}` — so repeated calls (e.g. two `get_stock_quote`s in a compare) don't overwrite each other and each binding identifies its exact call. Workflow turns use the same entry-based collector (evidence `resultDigest` previews are 500-char-truncated and unusable alone).
- **Claim extraction (new, defined here — the existing `extractNumericClaims` only finds numbers *near known tool metrics* and structurally cannot produce unbound claims):** add `extractAnswerNumbers(text)` to `numeric-claims.ts`. Candidate claims: currency amounts (`$`-prefixed), percentages (`%`-suffixed), and decimal numbers with ≥3 significant digits. Exclusions: standalone years 1900–2100, numbers inside inline code spans, ticker-adjacent share-multiplier phrasing ("100-share", "per contract"), and ordinal/list markers. The claim set is the union of the existing metric-anchored pass (which supplies `metric` labels) and this pass; binding attempts a value match against the per-call tool numbers using `checkNumberMatch`'s existing tolerance rules. Unbound = an extracted claim with no value match.
- Emit an `opencandle-receipts` session entry per such turn: for each claim `{ text, value, metric?, binding }` where `binding` is `{ tool, callIndex, valuePath, freshness? }` (freshness copied from the call's `details.freshness` when the `freshness-ledger` change has landed) or `null` for unbound; plus `boundCount`/`unboundCount`.
- Observe-only: no answer rewriting, no blocking, no re-prompting.

**Milestone 2 — GUI rendering (render-if-present).**
- Assistant messages whose turn has an `opencandle-receipts` entry get a footer line — "8 of 9 numbers matched to tool data" — expandable to the claim → tool/value/as-of table. Unbound claims render flagged, with neutral wording ("not matched to tool data"), not accusatory.
- The context drawer's Receipts panel (from `composer-attach-and-context-receipts`) links to the same data at turn level; no duplicate computation.

## Non-Goals

- No enforcement: an unbound number never blocks, rewrites, or fails a turn (enforcement is a future phase behind its own proposal).
- No non-numeric claim binding (dates, entity facts, qualitative claims).
- No TUI rendering in v1.
- No receipts for pass-through turns or turns with zero tool calls (an all-prose education answer has nothing to bind; emit no entry rather than an empty one).
- No prompt changes of any kind.

## Dependencies

- `freshness-ledger` for as-of data on bindings (degrades gracefully: binding works without freshness, the column just stays empty).
- Composes with `shareable-answer-artifact` (the artifact embeds the receipts table) and the context drawer.
