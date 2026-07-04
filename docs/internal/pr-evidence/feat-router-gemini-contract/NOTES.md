# feat/router-gemini-contract Evidence Notes

## Live Gemini Baselines

Model/provider for all four local runs:

```bash
set -a; source .env; set +a
OPENCANDLE_ROUTER_PROVIDER=google OPENCANDLE_ROUTER_MODEL=gemini-2.5-flash npm run eval:router-live
```

Pre-fix evidence:

- `router-live-gemini-2.5-flash-run-1-before.txt`: 9/26 exact, route-kind flips on 017 and 022.
- `router-live-gemini-2.5-flash-run-2-before.txt`: 9/26 exact, route-kind flip on 017; 022 changed to same-route-kind slot drift, so 022 was treated as unstable Class D.

Post-fix gate evidence:

- `router-live-gemini-2.5-flash-run-1-after.txt`: 25/26 exact, passRate 0.962, zero route-kind flips.
- `router-live-gemini-2.5-flash-run-2-after.txt`: 25/26 exact, passRate 0.962, zero route-kind flips.

The remaining miss in both post-fix runs is fixture 018: Gemini carries only the current-turn symbol (`QQQ`) and omits the prior-context comparison symbol (`SPY`). This is a same-route-kind entity carryover difference and not one of the unstable/D-class gate failures.

## Behavior-To-Test Map

| Behavior | Proof |
|---|---|
| Fixture 022: macro acronym `CPI` cannot force a `compare_assets` workflow dispatch after acronym cleanup leaves only `SPY`. | `tests/unit/routing/router.test.ts` test `corrects macro metric comparisons after acronym slot cleanup leaves one ticker`; post-fix live runs 1 and 2 both pass 022. |
| Fixture 010: `portfolio_builder` fills missing `risk_profile` slot from `profileSnapshot` without prompt changes. | `tests/unit/routing/router.test.ts` test `fills profile-backed portfolio risk slots when the model omits them`; post-fix live runs 1 and 2 both pass 010. |
| Fixture 017: conversational risk-profile updates with profile/prior-turn context recover from Gemini `pass_through`. | `tests/unit/routing/router.test.ts` test `recovers conversational risk preference updates from prior profile context`; post-fix live runs 1 and 2 both pass 017. |
| Fixture 025: locally marked acronym tickers such as `the IV ticker` are restored and ordered by user text. | `tests/unit/routing/router.test.ts` test `restores locally marked acronym tickers omitted by the model in text order`; post-fix live runs 1 and 2 both pass 025. |
| Class A/B/C live diffs do not dominate the Gemini exact score and cannot mask route-kind flips. | `tests/scripts/run-live-router-eval.ts` keeps `routeKind`, `route`, dispatch workflow, entities, and `missing_required`; strips only justified non-contract fields with inline comments. |

## Gates

- `npm test`: pass, 221 files / 2303 tests.
- `npx tsc --noEmit`: pass.
- `npx biome ci .`: pass exit code 0; reported pre-existing warnings outside this slice.
- `npx vitest run tests/unit/routing`: pass, 9 files / 330 tests.
- `graphify update .`: pass; AST graph rebuilt (`11111 nodes`, `16052 edges`, `842 communities`), HTML viz skipped because graph exceeds the default size limit.
