## Why

OpenCandle's system prompt tells the model it is a "financial advisory agent" and then instructs it that "This is not financial advice. Users should consult qualified financial advisors." The model resolves that contradiction by refusing — even when given specific tickers, horizons, and personal context, it declines to commit to entry levels, targets, or allocations, which is the agent's literal job. The refusal is not a missing-data or missing-profile bug; investor profile is already hydrated for unclassified queries. It's a stance bug in the prompt.

## What Changes

- Rewrite `src/system-prompt.ts` and `src/prompts/context-builder.ts` to teach a single, coherent "honest analyst, not advisor" posture:
  - Commit to specific numbers (entry zones, targets, stops, allocations) when asked
  - Back each commitment with the tools called, the reasoning chain, a confidence band, and an invalidation level
  - Flag downside and risks loudly — uncertainty is expressed through confidence + invalidation, not through refusal
- Remove the phrases "financial advice", "not financial advice", and "consult a qualified advisor" from the portion of the prompt read as instructions by the model. Replace them with analyst-posture framing.
- Rewrite the per-workflow prompt builders in `src/prompts/workflow-prompts.ts` and the inline step prompts in `src/workflows/*.ts` to drop "include the standard disclaimer" / "End with the standard disclaimer" instructions. Workflow prompts must not re-introduce refusal or disclaimer directives that the universal stance has removed.
- Render the user-facing disclaimer outside the LLM instruction context (mechanism TBD in design — either a Pi harness hook or a marker-and-strip fallback). The disclaimer is preserved for users; it just no longer steers model behavior.
- The stance is UNIVERSAL: injected into the base prompt on every turn, for every workflow (portfolio builder, options screener, compare assets, future trade setup), and for the fallback/unclassified path. There is no workflow in which the model is told "it's ok to refuse."
- Calibrate explanation depth (beginner-friendly vs. sophisticated shorthand) from conversational signals, not from two separate stances.
- **BREAKING (behavioral)**: response tone shifts from hedged/refusing to committal. Any tests or fixtures asserting on "I cannot provide financial advice" wording will need updating.

## Capabilities

### New Capabilities
- `analyst-stance`: the posture, commitment, and disclaimer-placement rules that govern every OpenCandle response regardless of workflow.

### Modified Capabilities
- (none — this is a new concern, no existing spec covers system-prompt stance)

## Impact

- `src/system-prompt.ts`: major rewrite.
- `src/prompts/context-builder.ts`: `BASE_ROLE`, `SAFETY_RULES`, `OUTPUT_FORMAT` sections rewritten; disclaimer removed from `OUTPUT_FORMAT`.
- `src/prompts/workflow-prompts.ts`: remove "include the standard disclaimer" and "educational sample allocation … include the standard disclaimer instead of refusing" language from `buildPortfolioPrompt`, `buildOptionsScreenerPrompt`, `buildCompareAssetsPrompt`; replace with commit-with-reasoning guidance consistent with the universal stance.
- `src/workflows/portfolio-builder.ts` (and any other workflow files with inline step prompts): remove "End with the standard disclaimer" directives; align synthesis steps with the analyst stance.
- `src/prompts/sections.ts`: no new sections (keep section list stable); stance content replaces existing section bodies.
- Pi harness layer: a mechanism to surface the disclaimer outside LLM instruction context (concrete mechanism decided in design.md after spiking Pi extension points).
- Tests: any unit/integration tests asserting on refusal wording; add tests asserting on committal behavior for representative prompts and on stance preservation across all workflow prompt outputs.
- No schema changes. No new dependencies.
- Sequencing: `llm-intent-router` (change B) depends on this change landing first, so the universal stance is available to every router-dispatched route including fallback.
