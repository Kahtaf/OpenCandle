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
- `npm run eval -- router-live` (not wired in CI) runs the same fixtures against the real LLM and reports pass/fail + p50/p95 latency.

## When to run live

- Before PRs that touch `src/routing/router-prompt.ts`, `src/routing/router.ts`, or router model choice.
- On model upgrades.

A "regression" is defined as a drop in pass-rate below the committed `BASELINE.json` `passRate`. Route-mismatches are always treated as regressions even if pass-rate is nominally within bounds.

## PII hygiene

- Strip account balances, real names, exact dollar holdings. Replace with bucketed placeholders (e.g. `$500k-$1M`) or `<ANONYMIZED_BALANCE>`.
- Preserve classification-relevant signal (tickers, horizons, risk phrasing, workflow type).
- Tickers are NOT PII and are preserved as-is.
- Multi-turn fixtures SHALL anonymize consistently within a single fixture: if a ticker or bucketed placeholder stands in for an entity in one turn, every other turn of that same fixture SHALL use the exact same anonymized form for that entity. Different fixtures may independently choose different anonymizations — no suite-wide mapping is required.

## Multi-turn fixtures

Multi-turn fixtures populate `priorTurns` with the last few `{role, text}` entries of a synthetic conversation, then set `input` to the current turn. See `013-coreference-price.json` for a worked example: the prior turn establishes NVDA as the subject, the current turn says "what about at $500?", and the router is expected to resolve the coreference.

Rules for authoring multi-turn fixtures:

- **Prior-turn-derived entity values populate `expectedRouterOutput.entities`, NOT `expectedRouterOutput.slots`.** The slot source enum is `user | preference | default` — there is no valid source value for prior-turn provenance, so these values live in `entities` only. For example: if NVDA comes from a prior turn, write `entities.symbols: ["NVDA"]` and do NOT emit a `symbol` slot for it.
- **`missing_required` consults `entities` first.** A required slot name SHALL NOT appear in `missing_required` when the value is present in `entities` (whether from the current turn, prior turns, or profile). Only values that remain absent after the entity lookup are flagged.
- **Intra-fixture anonymization consistency.** See the PII Hygiene bullet above — the same ticker/bucket SHALL be reused across every turn of a single fixture so coreference assertions stay valid.
- **Synthetic multi-turn fixtures SHALL carry the `synthetic-multi-turn` tag** in the fixture's `tags` array. This lets reviewers distinguish synthesized fixtures from sampled-real fixtures at a glance and flags them for future replacement once real multi-turn samples are available.

Fixtures 013–018 cover the six required classes from the router-evals spec:

- `013-coreference-price.json` — coreference
- `014-carried-budget.json` — carried context
- `015-topic-shift.json` — topic shift
- `016-ticker-correction.json` — correction
- `017-pref-conflict.json` — preference conflict
- `018-dollar-phrase.json` — dollar-phrase preservation

## Acronym disambiguation fixtures

Fixtures 019-025 cover the finance-acronym dictionary and signal rules from
`src/routing/symbol-disambiguator.ts`.

- `019-iv-as-volatility.json` — drops bare IV in a compare prompt after prior implied-volatility context.
- `020-sec-as-regulator.json` — keeps TSLA while treating SEC as the regulator.
- `021-fed-as-bank.json` — keeps TLT while treating FED as macro policy context.
- `022-cpi-as-metric.json` — keeps SPY while treating CPI as a macro metric.
- `023-iv-with-positive-signal.json` — keeps IV when written as `$IV`.
- `024-iv-bare-list-dropped.json` — drops bare IV even inside `KO, IV, PEP`.
- `025-iv-local-ticker-phrase.json` — keeps IV when the local phrase says `IV ticker`.

Bare comma-list or `and`-list adjacency is not enough to retain a dictionary
token. Use a cashtag or local ticker phrase when a dictionary token really is
the intended symbol.

## Privacy notes

Conversational text in `priorTurns` is NOT governed by `src/memory/types.ts::NEVER_TRUST_FROM_MEMORY`. That set controls market-sensitive *structured* memory keys (`stock_price`, `target_price`, `entry_price`, `stop_loss`, `crypto_price`, `market_thesis`) — it does not cover free-form conversational text that the router sees via `priorTurns`.

The designated follow-up for scrubbing `priorTurns` is a future `/forget` command, which will remove or mask matching message entries from the session branch so they no longer reach the router. Until `/forget` ships, fixture authors SHALL treat `priorTurns` as they would any checked-in conversation text: no account balances, no real names, no exact dollar holdings, and apply the intra-fixture anonymization rule above.
