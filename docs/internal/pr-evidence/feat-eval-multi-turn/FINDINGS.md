# E1 Multi-Turn Coreference Findings

## FINDING: saved-state holding coreference does not resolve into router entities

A credentialed live run on 2026-07-04 seeded the eval home with an AMD portfolio lot and ran the three-turn E1 scenario. Turn 2 correctly carried prior-turn NVDA in `opencandle-router.entities`, and `opencandle-route-context.priorTurns` was present for turns 2 and 3.

Turn 3, "and compare it to the one I hold", did not add AMD from saved state into router entities. The observed turn-3 router symbols were only `["NVDA"]`. Per the eval author rule, this PR does not modify production routing or saved-state resolution to make the eval pass. The case is marked known-fail/usually/opt-in until a production fix lands.

## FINDING (added 2026-07-04 overnight review): two assertion defects fixed

1. `slotSymbolsFromRouterEntry` read slot values through a string-only
   extractor that missed the `{value, source, confidence}` slot shape, so
   the "prior-turn symbols not in slots" assertion was vacuous — the
   committed trace itself shows turn-2 `slots.symbol` carrying NVDA with
   `source: "prior_context"` while the assertion passed.
2. `slotSourcesFromContext` read `context.resolvedSlots`, a key that does
   not exist in `opencandle-route-context` entries (the key is `slots`), so
   those assertions failed unconditionally and hid inside the known-fail
   umbrella alongside the documented AMD gap.

Contract alignment: the shipped `SlotSource` union includes
`prior_context` by design (`src/routing/types.ts`, router prompt guidance),
so the eval now asserts prior-turn-derived slot values never claim `user`
provenance instead of asserting slot absence. The plan/changelog wording
about a three-value `user|preference|default` enum predates the shipped
five-value union.
