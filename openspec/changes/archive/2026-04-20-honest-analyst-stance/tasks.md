## 1. Spike: decide disclaimer surface mechanism

- [x] 1.1 Read `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/` and the Pi docs to identify which of these paths is viable: (a) a post-response hook that can mutate or append to final assistant text, (b) a `pi.sendMessage({customType: "opencandle-disclaimer", display: true})` pattern invoked from a `turn_end` or equivalent event, (c) marker-and-strip at render time
- [x] 1.2 Pick the mechanism in order of preference: custom display message > post-response hook > marker-and-strip. Document the decision in a short note under the change dir before writing any code
- [x] 1.3 If marker-and-strip is the only option, define the marker token and the strip/replace implementation point explicitly

## 2. Rewrite base prompt stance content

- [x] 2.1 Rewrite `src/system-prompt.ts::buildSystemPrompt` to adopt the analyst stance — remove all "financial advice" / "consult a qualified advisor" phrasing from instruction text
- [x] 2.2 Rewrite `BASE_ROLE` in `src/prompts/context-builder.ts` to frame OpenCandle as a research analyst committing to specific numbers
- [x] 2.3 Rewrite `SAFETY_RULES` to remove the narrow portfolio/options carve-out and adopt universal "commit + reason + confidence + invalidation" guidance
- [x] 2.4 Rewrite `OUTPUT_FORMAT` to remove the Disclaimer block and teach committal response structure (reasoning chain, confidence band, invalidation level)
- [x] 2.5 Add stance wording that forbids fiduciary framing ("tailored to your retirement", etc.) while permitting analyst framing ("our read", "the data suggests")
- [x] 2.6 Add stance guidance on adaptive explanation depth from conversational signals

## 3. Rewrite workflow prompts

- [x] 3.1 In `src/prompts/workflow-prompts.ts::buildPortfolioPrompt`, remove the "This is an educational sample allocation request. Build the draft portfolio and include the standard disclaimer instead of refusing." line and the "- Include the standard disclaimer." bullet; replace with commit-with-reasoning guidance consistent with the universal stance
- [x] 3.2 In `src/prompts/workflow-prompts.ts::buildOptionsScreenerPrompt`, audit and remove any disclaimer directives (none visible today, but check); ensure the stance is respected
- [x] 3.3 In `src/prompts/workflow-prompts.ts::buildCompareAssetsPrompt`, same audit
- [x] 3.4 In `src/workflows/portfolio-builder.ts` (and any other workflow files with inline step prompts in `src/workflows/*.ts`), remove the "End with the standard disclaimer." instruction from the synthesize step and any equivalents; rewrite the step to commit without re-introducing refusal or disclaimer language
- [x] 3.5 Grep `src/` for any remaining occurrences of "standard disclaimer", "Disclaimer", "not financial advice", "consult" to confirm zero remaining instruction-text references

## 4. Wire the disclaimer surface

- [x] 4.1 Implement the chosen mechanism from task 1 (hook / custom message / marker-and-strip)
- [x] 4.2 Confirm disclaimer text appears on every user-visible assistant response (workflow, direct, and unclassified paths alike)
- [x] 4.3 Place the disclaimer text as a single configurable constant (e.g., in `src/config.ts` or a dedicated module) so future wording updates are a one-line change

## 5. Tests

- [x] 5.1 Grep the test suite for assertions on refusal wording ("I cannot provide", "not financial advice", "consult a qualified advisor") and update them
- [x] 5.2 Add a system-prompt unit test asserting the absence of refusal vocabulary in the assembled prompt
- [x] 5.3 Add a system-prompt unit test asserting the analyst stance is present for every workflow type and for the unclassified path
- [x] 5.4 Add a unit test per workflow prompt builder (`buildPortfolioPrompt`, `buildOptionsScreenerPrompt`, `buildCompareAssetsPrompt`) asserting the assembled prompt contains no disclaimer/refusal directives
- [x] 5.5 Add a unit test asserting `buildPortfolioWorkflowDefinition` synthesis step does NOT contain "End with the standard disclaimer" or equivalent
- [x] 5.6 Add a harness integration test (or live-run check via `tests/harness/manual-run.ts`) that submits "Give me entry levels on ASTS for a 6 month horizon" and verifies the response contains specific numeric entry levels plus an invalidation level
- [x] 5.7 Add a harness test asserting the disclaimer text surfaces in the user-visible transcript on every assistant turn, via whichever mechanism task 1 picked

## 6. Verification

- [x] 6.1 Run `npm test` and confirm all unit tests pass
- [x] 6.2 Live-run the ASTS entry-levels query via `tests/harness/manual-run.ts` and visually verify a committal response
- [x] 6.3 Live-run a portfolio query (`"invest $50k diversified"`) and confirm the workflow still commits with the analyst stance intact and produces no disclaimer text inside the LLM response body
- [ ] 6.4 Live-run an unclassified query outside the current taxonomy and confirm stance holds in the fallback path (note: fallback playbook itself lands with change B; this change verifies stance alone doesn't regress the unclassified path)
