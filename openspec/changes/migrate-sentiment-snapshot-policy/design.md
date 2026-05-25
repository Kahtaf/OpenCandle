## Design

The migration follows the established slice pattern:

1. `observe_only`: sentiment planning metadata is recorded but no sentiment policy card is injected.
2. `dual_run`: the sentiment policy card can render while the legacy fallback sentiment-source clause remains present.
3. `replacement_active`: the sentiment policy card owns source-coverage answer shape, and only fallback playbook item 15 is omitted for `sentiment_snapshot` turns.

The slice keeps the existing sentiment route and tool-bundle behavior. Ticker-specific sentiment prompts still use the sentiment bundle and quote evidence when the existing tool path chooses it. The answer contract becomes active and requires source coverage and data-gap disclosure while avoiding analyst trade commitment requirements.

This change does not add new sentiment providers or source-depth improvements. The `sentiment_sample_depth` capability gap remains active so answers continue to disclose sparse or unavailable sources instead of overstating confidence.

## Validation

- focused policy-card, routing, answer-contract, and prompt-assembly tests
- focused strict manifest for `sentiment-source-coverage`
- focused ref parity against `3e3a039`
- full `npm test`
- `graphify update .`
