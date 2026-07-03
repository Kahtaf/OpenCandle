> **Superseded:** implemented by `product-audit-downscope` (2026-07-03), which flips the default to the LLM router, removes the rules-mode dispatch path, and keeps `classifyWithLegacyRules` as the router's deterministic failure-recovery safety net. Spec deltas live in that change; this proposal is archived without applying its own delta.

## Why

The deterministic rules router remains the default while the LLM router acceptance gate is incomplete. Once the LLM router has passed the live fixture, latency, and cost gate for a release window, keeping two primary routing paths creates duplicated behavior and makes disambiguation/tool-scope bugs harder to reason about.

## What Changes

- Promote `OPENCANDLE_ROUTER_MODE=llm` to the only production routing path after acceptance evidence is green.
- Remove the legacy rules router as a primary input handler.
- Preserve targeted deterministic safety nets that still add value, such as acronym disambiguation and provider/tool validation.
- Remove or deprecate `OPENCANDLE_ROUTER_MODE=rules` after the rollback window.

## Impact

- **Code:** `src/config.ts`, `src/pi/opencandle-extension.ts`, `src/routing/legacy-rule-router.ts`, rule-router tests
- **Tests:** router eval gate, config default tests, extension dispatch tests
- **Dependencies:** no new package dependencies expected
