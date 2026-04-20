# Router fixtures

Deterministic fixtures for the LLM intent router (see `openspec/changes/llm-intent-router/specs/router-evals/spec.md`).

## Fixture file format

Each fixture is a JSON file with the following shape:

```jsonc
{
  "input": "Give me entry levels on ASTS for a 6 month horizon",
  "priorTurns": [
    { "role": "user", "text": "..." },
    { "role": "assistant", "text": "..." }
  ],
  "profileSnapshot": {
    "risk_profile": "aggressive"
  },
  "expectedRouterOutput": {
    "route": "fallback",
    "entities": {
      "symbols": ["ASTS"],
      "timeHorizon": "6mo"
    },
    "slots": {
      "symbol": { "value": "ASTS", "source": "user", "confidence": "high" },
      "timeHorizon": { "value": "6mo", "source": "user", "confidence": "high" },
      "risk_profile": { "value": "aggressive", "source": "preference", "confidence": "high" }
    },
    "preference_updates": [],
    "missing_required": [],
    "reasoning": "ignored in comparisons"
  },
  "tags": ["fallback-entry-levels", "asts"]
}
```

## Running

- `npm test` includes the deterministic suite (`tests/unit/routing/router-fixtures.test.ts`). The runner loads each fixture, constructs a mock LLM client that returns `expectedRouterOutput`, runs `route()`, and asserts structural equality (the `reasoning` field is exempt from exact match).
- `npm run eval:router-live` (not wired in CI) runs the same fixtures against the real LLM and reports pass/fail + p50/p95 latency.

## When to run live

- Before PRs that touch `src/routing/router-prompt.ts`, `src/routing/router.ts`, or router model choice.
- On model upgrades.

A "regression" is defined as a drop in pass-rate below the committed `BASELINE.json` `passRate`. Route-mismatches are always treated as regressions even if pass-rate is nominally within bounds.

## PII hygiene

- Strip account balances, real names, exact dollar holdings. Replace with bucketed placeholders (e.g. `$500k-$1M`) or `<ANONYMIZED_BALANCE>`.
- Preserve classification-relevant signal (tickers, horizons, risk phrasing, workflow type).
