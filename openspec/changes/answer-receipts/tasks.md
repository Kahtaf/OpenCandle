# Tasks

Follow AGENTS.md (TDD, CHANGELOG, `graphify update .`). Extend the existing machinery in `src/runtime/numeric-claims.ts` / `validation.ts` / `session-coordinator.ts` — do not fork a second extractor. No prompt edits. Observe-only end to end.

## 1. Binding pass (TDD)

- [ ] 1.1 Failing unit tests for the new extraction/collection in `src/runtime/numeric-claims.ts`: `extractAnswerNumbers` inclusion/exclusion table per the spec (currency, percent, ≥3-sig-fig decimals in; years, inline code, "100-share"/"per contract", list markers out); per-call collection keyed `${tool}#${callIndex}.${path}` — two same-tool calls do not collide; bound claim (rounding tolerance, thousands separators — reuse the existing matcher fixtures); unbound claim recorded with `binding: null`; freshness copied from the call's `details.freshness` when present.
- [ ] 1.2 Failing unit tests for the pass wiring, then implement in the extension's `turn_end` handling (`src/pi/opencandle-extension.ts` ~:305 — ask-first area, authorized by this proposal): read `currentRouteToolContext.routeKind` BEFORE `restoreRouteToolScope()` (~:310); workflow turns detected from workflow-dispatch state; pass-through turn emits nothing; tool-less routed turn emits nothing; tool numbers collected from the exchange's session tool-result entries (full `details`), never from truncated evidence digests. Keep the existing `opencandle-validation` synthesis entry unchanged (both emit for `/analyze`; they answer different questions).
- [ ] 1.3 Harness visibility: `opencandle-receipts` appears in trace `customEntries` (covered by the wildcard capture; add one assertion to the custom-entries test).

## 2. Milestone 0 — measurement (STOP gate)

- [ ] 2.1 Run ≥10 live routed sessions via the harness across families (2× single-asset, 2× compare, 2× options, 2× macro, 2× portfolio-review with seeded state); collect every receipts entry.
- [ ] 2.2 Hand-classify unbound claims and mismatches (true/false positive); record the table + per-family precision in the PR description.
- [ ] 2.3 DECISION POINT: if false-unbound > 1 in 10, STOP — file the findings, fix extraction in a follow-up, do not start section 3.

## 3. GUI rendering (TDD; only after 2.3 passes)

- [ ] 3.1 Failing client tests: footer line from a seeded receipts entry; expandable table rows (bound with as-of; unbound neutral label); absent entry → no UI.
- [ ] 3.2 Implement: surface the receipts entry through the existing chat-event adapter path; footer + expandable table component in the chat message renderer; wire the context drawer Receipts panel to the same per-turn data if `composer-attach-and-context-receipts` has landed.
- [ ] 3.3 Screenshots 1440x960 + 390x844 (footer collapsed; table expanded) for the PR.

## 4. Verification

- [ ] 4.1 `npm test`, `npx tsc --noEmit`, `npx biome ci .` green; React Doctor clean on changed GUI files.
- [ ] 4.2 Live evidence: one `/analyze` and one fallback finance turn with receipts entries in the trace; GUI screenshot of a real bound answer.
- [ ] 4.3 CHANGELOG `[Unreleased]` entries (binding pass; GUI receipts).
- [ ] 4.4 `graphify update .`; `npx openspec validate answer-receipts --strict`.
