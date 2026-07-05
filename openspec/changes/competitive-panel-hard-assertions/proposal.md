# De-Noise the Competitive Panel: Hard Assertions, Not Judge Investment

## Why

The 2026-07-04 frozen-panel runs proved the design premise and exposed the residuals: the LLM judge flipped a winner between runs *against the same cached Claude answer* (prompt 1: OC 9–7 → Claude 9–6), the judge model shares a family with a potential Gemini baseline (untracked bias), and cached competitor answers have no age gating (`findCachedCompetitorAnswer` matches prompt text + competitor id only — a weeks-old answer would silently compete against a fresh one). The deterministic `finalAnswerHardAssertions` were the stable signal, catching a real DTE regression the judge missed. The maintainer's direction: expand the hard assertions; do not invest in the judge.

One assertion needs a decision, recorded here: "starts with a bottom-line structural portfolio read" fails on answers that lead with an equivalent structural read without the literal words "bottom line" (its current checker is a substring match anywhere in the answer — no positional logic exists at all). **Decision: relax that one assertion to an enumerated set of structural lead patterns evaluated positionally**, where "the answer's opening" is defined as the first 400 characters of the final answer text. Rationale: the assertion tests answer *shape*; the loss class it belongs to (portfolio-review-not-builder) is separately protected by route/content assertions, and the alternative — forcing the literal via prompt/answer-contract text — is prompt work behind the prompt-integrity gate and would overfit phrasing (an AGENTS.md "never" for benchmark phrases).

**Manifest schema decision (JSON has no comments; assertions are currently plain strings keyed to hardcoded checkers):** `finalAnswerHardAssertions` entries become a union — a plain string (existing behavior, unchanged) or an object `{ assertion: string, leadPatterns?: string[], justification?: string }`. Every manifest consumer typed `finalAnswerHardAssertions?: string[]` (`tests/scripts/run-competitive-finance-eval.ts`, `tests/scripts/run-prompt-policy-manifest.ts`, and the tests) is updated to handle both forms. The `justification` field is the "comment".

## What Changes

- **Cached-answer age guard:** cached competitor answers older than 7 days (override: `OPENCANDLE_COMPETITIVE_CACHE_MAX_AGE_DAYS`) are treated as absent — rerun live or skip at preflight, recorded in `skippedCompetitors`/report.
- **Judge-noise disclosure (no judge changes):** the report already records `judge: { provider, model }` — the new pieces are a `judgeFamilyConflict` flag and the summary labeling win counts as judge-noisy with the hard assertions named as the gate. Family mapping is explicit (competitor ids are acpx-namespaced): `acpx/gemini → google`, `acpx/claude → anthropic`, `acpx/codex → openai`; conflict when the judge's Pi provider id equals a live competitor's mapped family.
- **Three new frozen loss-class prompts**, each with ≥2 deterministic hard assertions in the prompt-policy manifest and a registered checker (the frozen run must keep reporting zero "No deterministic checker registered" gaps):
  1. **ETF-overlap** (2026-05-24 loss class): the answer must reference holdings overlap by weight, not generic correlation-only comparison.
  2. **Options per-share vs per-contract language** (2026-05 loss class): a covered-call/protective-put answer quoting premiums must carry per-share pricing with 100-share contract math.
  3. **Market-closed freshness** (recurring stale-data class; composes with `freshness-ledger`): a weekend "what moved today" prompt must carry as-of/market-closed framing and no live-price presentation.
- **Bottom-line assertion relaxation** per the decision above (enumerated structural lead patterns, justification comment in the manifest).
- **History discipline:** each frozen run appends a row to `docs/internal/competitive-benchmark-history.md` — into a **new dedicated "## Frozen panel runs" table** (columns: `Date | Prompts run | Hard assertions (pass/fail, failures named) | Judge summary (labeled noisy) | Report paths`), because the existing improvement-loop table's narrative columns (Before/After/Gap/Changes/Follow-ups) do not fit per-run records. The existing table is untouched.

## Non-Goals

- No judge prompt/rubric changes, no multi-judge panels, no judge model swap.
- No changes to generated-discovery mode (`test:evals:competitive` non-frozen) beyond the shared age guard.
- No production prompt/policy/routing changes: if a new hard assertion fails against current behavior, that is a FINDING recorded per the eval author ground rule — fixes are separate changes classified into their narrowest durable layer.
- No benchmark literals in production prompts (the prompt-debt guard stays green; literals live in the manifest/tests only).
