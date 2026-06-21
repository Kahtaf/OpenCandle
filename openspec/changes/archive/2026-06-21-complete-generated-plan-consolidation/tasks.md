## 1. Finish Incomplete Generated Plans

- [x] 1.1 Finish plan 009 by extracting GUI HTTP route and SSE internals out of `gui/server/server.ts`.
- [x] 1.2 Add a regression test that keeps `gui/server/server.ts` within the plan's composition-root size budget.
- [x] 1.3 Finish plan 010 Phase B with a no-output-change prompt-layer consolidation.
- [x] 1.4 Verify prompt snapshots do not change during consolidation.

## 2. Consolidate Plan Records Into OpenSpec

- [x] 2.1 Move the generated `plans/` folder under this OpenSpec change.
- [x] 2.2 Update the moved plan index to reflect that all generated plans are complete.
- [x] 2.3 Keep the change consolidation-only and archive it with `--skip-specs`.

## 3. Verification

- [x] 3.1 Run targeted GUI server tests for route guards, composition, session actions, model setup, WebSocket hub, and private API access.
- [x] 3.2 Run prompt snapshot and prompt debt guard tests.
- [x] 3.3 Run TypeScript no-emit.
- [x] 3.4 Run OpenSpec validation.
