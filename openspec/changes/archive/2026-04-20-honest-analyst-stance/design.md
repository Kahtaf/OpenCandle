## Context

OpenCandle's current system prompt (`src/system-prompt.ts` and `src/prompts/context-builder.ts`) opens with "financial advisory agent" and closes with "This is not financial advice. Users should consult qualified financial advisors." The model reads both as instructions and picks the safer interpretation — refusing to commit to specific numbers. An annotated transcript showed this concretely: asked for 6-month entry levels on ASTS with tools available (`get_technical_indicators`, `compute_dcf`), the agent repeatedly hedged that calculating entry levels "constitutes financial advice."

The refusal is not a missing-data bug. `WORKFLOW_RELEVANT_CATEGORIES["unclassified"]` already includes `investor_profile`, so preferences are hydrated even when routing falls through. The refusal is a stance bug in prompt content: instructions that tell the model it is an advisor AND that it must not give advice.

A coherent, well-understood alternative exists: the **research analyst** posture. Analysts (sell-side, Morningstar, published research newsletters) give specific numeric views, published reasoning, price targets, and ratings, and they are legally distinct from fiduciary advisors who have obligations to individual clients. OpenCandle should adopt the analyst posture explicitly.

## Goals / Non-Goals

**Goals:**
- System prompt reliably commits to specific numeric outputs (entry zones, price targets, stops, allocations) when asked, backed by tool-fetched data.
- Each committal response includes reasoning chain, confidence band, and invalidation level.
- Disclaimer text remains visible to users but no longer steers model behavior.
- Single, universal stance — identical posture across portfolio, options, compare, fallback, unclassified, and any future route.

**Non-Goals:**
- Legal compliance audit. Product stays non-fiduciary by position, not by legal opinion in this change.
- Removing the user-facing disclaimer entirely.
- Routing or workflow changes (those live in `llm-intent-router`).
- Implementing a beginner-vs-sophisticated mode toggle. One stance with calibrated depth from conversational signals.

## Decisions

### 1. Disclaimer renders outside the LLM's instruction context

- **Considered**: (a) keep inside system prompt with softened wording, (b) remove entirely, (c) render outside the LLM instruction context (mechanism TBD).
- **Chosen**: (c), but the mechanism is deliberately left open to be resolved by a spike in task 1.
- **Why**: model-instructions and user-facing text should be decoupled. Softening wording (a) still puts refusal-adjacent language in the model's context and the current failure mode shows that's enough to trip refusals. Removal (b) loses a user-visible cue that may matter for trust.
- **Mechanism options** (to be decided by the spike):
  1. **Post-response Pi hook** — if `@earendil-works/pi-coding-agent` exposes an extension point that can mutate assistant text before display (e.g., a `message_after` or equivalent), append the footer there. Verify by reading `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/`.
  2. **Custom display message** — have the extension call `pi.sendMessage({customType: "opencandle-disclaimer", display: true, ...})` after every assistant turn. Keeps the disclaimer a first-class transcript entry without mutating model output.
  3. **Marker-and-strip fallback** — instruct the model to emit a `<<<OC_FOOTER>>>` marker at the end of every response. The extension intercepts the output, strips the marker, and replaces it with the canonical disclaimer block. Works even if Pi has no post-response mutation hook. The marker approach reintroduces a minor instruction in the LLM context, but it's a single structural token, not behavioral steering.
- **Default preference**: option 2 if viable (cleanest separation), falling back to 1, then 3 only if neither 1 nor 2 is workable. The spec is written to allow any of these so the spec doesn't have to change based on the spike outcome.

### 2. Universal stance, not per-workflow

- **Considered**: per-workflow stance overrides so e.g. "compare_assets" is more conservative.
- **Chosen**: single stance in `BASE_ROLE` or a new section always present.
- **Why**: per-workflow stance creates drift risk and weakens fallback paths. Router fallback needs the same commit posture as the portfolio builder. One source of truth also means future workflows inherit it for free.

### 3. Commit with invalidation, not with hedges

- The stance teaches: entry zone + reasoning + confidence band + invalidation. Uncertainty is expressed structurally — "our read, 50% confidence, invalidated if RSI falls below 30 with no fundamental change" — not by refusal.
- **Why**: falsifiable commitments are the analyst contract. They hold the model accountable without asking it to be omniscient.

### 4. One stance, adaptive explanation depth

- **Considered**: two prompts (beginner / sophisticated) or a user-configurable mode.
- **Chosen**: single stance, with a clause teaching the model to calibrate depth from the current turn's vocabulary, prior turns, and explicit asks ("explain it simply").
- **Why**: modes proliferate; conversational calibration is more natural and matches how humans adapt.

### 5. Keep existing `sections.ts` section list; replace content, not structure

- `BASE_ROLE`, `SAFETY_RULES`, `OUTPUT_FORMAT`, `TOOL_CATALOG` sections stay. Their bodies get rewritten. The memory-context and workflow-instructions sections are untouched.
- **Why**: the section architecture is sound; only the content is wrong. Minimal-surface changes reduce regression risk.

### 6. Workflow prompts must also adopt the stance

- `src/prompts/workflow-prompts.ts` currently injects instructions like `"This is an educational sample allocation request. Build the draft portfolio and include the standard disclaimer instead of refusing."` and `"Include the standard disclaimer."` into every portfolio/options/compare workflow prompt. `src/workflows/portfolio-builder.ts` adds `"End with the standard disclaimer."` to its synthesis step.
- These directives bypass the base-prompt stance and re-introduce disclaimer steering. The workflow builders must be rewritten in this change so that the universal stance actually holds universally. Leaving these as-is would mean the stance is inconsistent across workflow vs. unclassified paths — exactly the fragmentation `llm-intent-router` (change B) depends on being resolved.
- **Scope note**: this change rewrites the WORDING of workflow prompts to drop disclaimer instructions. It does NOT restructure the Assumptions block, does NOT change slot names, and does NOT touch routing. Those live in change B.

## Risks / Trade-offs

- **[Risk]** Model commits to clearly wrong numbers. **Mitigation**: confidence bands + invalidation levels make wrongness falsifiable; the existing "tool-first, no guessing financial numbers" guideline stays.
- **[Risk]** Users interpret committal analyst output as fiduciary advice. **Mitigation**: footer disclaimer + stance wording that uses "our read", "analyst view", "based on the data we pulled" — not "recommended for your situation." Stance must explicitly forbid fiduciary framing.
- **[Risk]** Tests asserting on refusal wording break. **Mitigation**: identify and update them as part of this change.
- **[Risk]** Pi extension API doesn't expose a post-response hook. **Mitigation**: fallback marker-and-strip approach; verified during implementation by reading `@earendil-works/pi-coding-agent` source.
- **[Trade-off]** Accepting more responsibility for committal output in exchange for being useful. The product stays non-fiduciary; it becomes honest.

## Migration Plan

1. Read `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/` to confirm a post-response text hook exists. If not, design the marker-and-strip fallback.
2. Rewrite `src/system-prompt.ts` and the relevant section bodies in `src/prompts/context-builder.ts` to adopt the analyst stance.
3. Move the disclaimer out of `OUTPUT_FORMAT` into the harness footer path.
4. Update tests asserting on refusal phrasing; add tests asserting on commit behavior for representative prompts (include the ASTS entry-levels case).
5. Live-run the `Give me entry levels on ASTS for a 6 month horizon` query via `tests/harness/manual-run.ts` and verify the agent commits with reasoning + confidence + invalidation.

**Rollback**: revert `src/system-prompt.ts` + `src/prompts/context-builder.ts` + harness footer change. No data or schema implications.

## Open Questions

- Does Pi expose a post-response text mutation extension point, or do we need the marker-and-strip approach? (Resolve during implementation.)
- Stance wording — does it need a legal-context review pass before landing? Suggested: a trusted reader familiar with financial publishing norms signs off on the final prompt copy.
- Should the footer text itself be configurable (env var / config file) so regional / future product variants can adjust it without code changes? (Leaning yes, but not blocking.)
