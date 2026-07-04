# Findings

## E2-001: Saved numeric lot summary is not exposed in `opencandle-route-context`

Both live seeded harness traces show that saved portfolio state reaches the final prompt path, but the `opencandle-route-context` custom entry does not include the saved numeric lot summary required by E2. The rates trace route context does not contain `480`, even though the final answer uses saved symbols.

Impact: deterministic trace assertions cannot prove the saved-state summary was injected without inspecting final answer behavior indirectly.

Narrow layer: trace/context observability.

## E2-002: SPY cost-basis lookup answers correctly but does not classify as portfolio review

The SPY lot prompt produced the correct final values: 60 shares, $480.00 average cost, and $28,800.00 cost basis. Its route context was `watchlist_or_tracking` and planning task family was `stateful_tracking_update`, while the E2 expected path is portfolio review/fallback and not portfolio builder.

Impact: answer fidelity is good for this prompt, but route/workflow-path fidelity does not match the acceptance contract.

Narrow layer: routing/planning.

