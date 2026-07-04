# E1 Multi-Turn Coreference Findings

## FINDING: saved-state holding coreference does not resolve into router entities

A credentialed live run on 2026-07-04 seeded the eval home with an AMD portfolio lot and ran the three-turn E1 scenario. Turn 2 correctly carried prior-turn NVDA in `opencandle-router.entities`, and `opencandle-route-context.priorTurns` was present for turns 2 and 3.

Turn 3, "and compare it to the one I hold", did not add AMD from saved state into router entities. The observed turn-3 router symbols were only `["NVDA"]`. Per the eval author rule, this PR does not modify production routing or saved-state resolution to make the eval pass. The case is marked known-fail/usually/opt-in until a production fix lands.
