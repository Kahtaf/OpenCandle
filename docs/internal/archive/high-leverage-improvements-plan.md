# High-Leverage Improvements Plan

**Date:** 2026-07-03 (revised 2026-07-04 after the cleanup merge)
**Companion doc:** `docs/internal/openspec-backlog-cleanup-plan.md` (WP1–WP7) — **fully merged to `main`** as PR #64 (merge commit `88b21cb`), including WP7. All spec preconditions in this plan are satisfied; every active item is unblocked today (see Execution model & kickoff for the integration branch all work targets).
**Audience:** implementation agents working one item per isolated worktree/branch, plus the reviewer who verifies each PR.

**Status decision (2026-07-04):** the maintainer has **backlogged I4 (`/forget`) and the E4 privacy eval** — do not implement them now. The active implementation set is: **I1, I2, I3, I5 (E1–E3, E5–E7), I7, I9.** I6 is already complete (see its section). I8 remains a north star, not a scheduled item.

**Priorities (in order):** correctness, product trust, privacy, local GUI/TUI runtime consistency, eval coverage, release safety. Feature volume is explicitly last. (Privacy stays a named priority, but its implementation vehicle — I4/E4 — is deferred; nothing else in this plan may regress the four documented leak surfaces.)

## Execution model & kickoff

This plan is written to be executed end to end by **one orchestrating agent** driving concurrent worktree subagents from a single kickoff prompt. Everything an implementer needs is in this doc plus the referenced specs. If an item forces a product decision not written here or in its governing spec, STOP that item and surface the question in its PR — never improvise the decision; the other items keep running.

**Kickoff:** the maintainer issues the kickoff prompt out-of-band; it names the integration branch below, which already exists and carries this plan revision.

**Integration branch — the single PR target:**
- The integration branch is `feat/high-leverage-improvements`, cut from `main` (it already exists — do not recreate it). Every item PR targets this branch. **No PR from this plan targets `main`.**
- The orchestrator merges an item's PR into the integration branch as soon as that item's own gates are green (universal rule 4: `npm test`, `npx tsc --noEmit`, `npx biome ci .`, tests named in the item, NOTES mapping, committed runtime evidence). This is what unblocks wave-2 items — do not wait for human review to merge into the integration branch.
- The PRs remain the per-item review record: the maintainer reviews them (reviewer protocol below) after the fact and reviews the final `feat/high-leverage-improvements` → `main` merge, which only the maintainer performs. If review finds a problem, the fix is a follow-up commit on the integration branch, not a rewrite of merged history.

**Waves (ordering):**
- **Wave 1 — start immediately, one worktree each, fully parallel:** I1, I2, I5(E3), I7, I9, the E6 release-gate smoke PR, and the I5 router-fixture authoring PR.
- **Wave 2 — each starts the moment its parent merges into the integration branch:** I3 (after I2), E1/E2/E5 (after I1), E6 parity case (after I2). E7 (frozen competitive panel) has no code parent and may run in either wave.
- **Never started:** I4 and E4 (backlogged), I6 (done), I8 (north star; requires a future OpenSpec proposal).

**Worktree/branch mechanics:**
- One item per branch per isolated worktree: `git worktree add ../oc-<item-slug> -b feat/<item-slug> feat/high-leverage-improvements` — i.e. cut from the integration branch head at the time the item starts (at kickoff that equals `main`).
- Branch names:
  - I1 → `feat/harness-multi-prompt`
  - I2 → `feat/analyst-evidence-capture`
  - I3 → `feat/deterministic-synthesis-validation`
  - I4 → BACKLOGGED (branch name `feat/forget-command` reserved for when it is scheduled)
  - I5 → one branch per suite, `feat/eval-<suite>` (e.g. `feat/eval-provider-outage` for E3, `feat/eval-multi-turn` for E1, `feat/eval-release-gate-gui-smoke` for the E6 gate PR, `feat/eval-router-fixtures` for the fixture-authoring PR)
  - I6 → DONE (delivered as cleanup WP7, commit `e57e499`, merged in #64; nothing left to branch)
  - I7 → `feat/gui-session-scoped-actions`
  - I9 → `feat/router-gemini-contract`
- Do not stack item branches on each other. Wave-2 items branch from the integration branch only after their parent has merged into it.
- Conflict policy: item scopes are file-disjoint by design, so conflicts should be rare. If two items do collide, the later-merging branch rebases onto the current integration branch and resolves; never resolve a conflict by discarding another item's merged work, and never edit another item's files "while you're in there."
- **Cleanup-branch dependency: SATISFIED.** `feat/openspec-backlog-cleanup` merged to `main` as #64 (`88b21cb`). The WP4.2 spec (`gui-session-scoped-action-cleanup`) is on `main`, so I7 starts in wave 1. The WP6 spec (`forget-command`) is also on `main` but its implementation (I4) is backlogged — leave the change directory active and untouched.

## Universal rules for every item

1. Read `AGENTS.md` and follow it: TDD (failing test first), `.js` extensions on relative imports, no live API calls in unit tests, no `any` outside raw provider responses, CHANGELOG `[Unreleased]` entry for every atomic feature/fix, run `graphify update .` after code changes.
2. **Prompt integrity is a hard gate.** Unless the item explicitly says otherwise, you may not edit any prompt template string (anything under `src/prompts/`, persona/stage prompts in `src/analysts/orchestrator.ts`, policy cards, workflow prompt builders). If your approach requires a prompt change, STOP and report; do not "make the text easier to parse."
3. Ask-first areas from AGENTS.md still apply: `src/pi/`, system prompt, analyst orchestration *prompts*, memory SQLite schema. Where an item below authorizes touching one (e.g. I4's v9 migration), that authorization is scoped to exactly what the item says.
4. Done means: `npm test`, `npx tsc --noEmit`, `npx biome ci .` green; new behavior covered by tests named in the item; a short `NOTES.md` in the PR (or PR description) mapping each claimed behavior to the test that proves it; runtime evidence (below) saved under `docs/internal/pr-evidence/<branch-name>/` — a **git-ignored** local directory since 2026-07-04: keep artifacts there for the reviewer's machine-local verification and paste the load-bearing excerpts (entry counts, key trace fields, screenshots) into the PR description, but do NOT commit them (a prior revision committed ~26 MB / ~60k lines of traces, logs, and screenshots, dwarfing the reviewable diff). Durable *decision records* (triage tables, open-item lists) go in `docs/internal/` as plain markdown instead.
5. Runtime evidence by surface: agent-behavior changes → a harness `trace.json` of the target scenario; GUI changes → screenshots at 1440x960 and 390x844 plus the browser-suite log; coordinator/lock changes → the convergence smoke output; schema changes → migration-test output against a real pre-upgrade fixture DB.
6. **E2E-first evidence policy (2026-07-03):** executor environments are provisioned with model/provider credentials, and live end-to-end runs are EXPECTED, not optional. **Auth model:** Claude access goes through Pi's sign-in auth (`~/.pi/agent/` auth storage — the same path production uses via `ctx.model`), NOT a raw `ANTHROPIC_API_KEY`; provider keys for data APIs and `GEMINI_API_KEY` come from `.env`. acpx is an agent transport, used ONLY for competitive-benchmark generic-agent baselines — never as a model transport for router or harness evals. Runtime evidence must come from a real credentialed run (harness trace, live eval, real browser) — never from mocks alone. Unit suites stay mock-based per AGENTS.md (no live calls in `npm test`), but every item's "done" includes its live evidence. If your environment lacks the needed credential, STOP and request it from the maintainer; do not substitute a mocked run and do not mark the item done. Cost discipline: run the targeted live scenario for your item, not whole live suites repeatedly.

## Sequencing

```
I1 harness multi-prompt ──→ I5 evals E1/E2/E5
I2 evidence capture ──→ I3 deterministic synthesis + validation ──→ I8 receipts (phase 2+)
I7 session-scoped action cleanup — spec (WP4.2) merged; can start immediately
I5 evals E3/E7 need nothing else; E3 can start immediately
I5 eval E6 parity case needs I2 (projector signals); E6's release-gate smoke PR is independent, can start immediately
I9 Gemini router-contract hardening — independent (uses the archived 2026-07-03 baseline); can start immediately

BACKLOGGED (do not start): I4 /forget, I5 eval E4 (E4 needs I1 + I4)
```

Parallel-safe from day one: I1, I2, I5(E3), I7, I9. Everything else has exactly one parent. (Coordinator verification closeout, formerly I6, shipped with the cleanup merge as WP7; the coordinator change is archived.)

---

## I1 — Harness multi-prompt sessions (small; prerequisite for real multi-turn evals)

**Why:** No end-to-end eval today can send a second user prompt into the same session; `runOpenCandleSession` and `tests/harness/manual-run.ts` accept one top-level prompt. Multi-turn coreference is currently proven only against mocked router fixtures.

**Scope:**
- `tests/harness/opencandle-runner.ts`: accept `prompts: string[]` (sequential; wait for settle between prompts using the existing settle/grace machinery; `prompt: string` remains supported and equivalent to a one-element array). The returned trace gains per-prompt turn boundaries (e.g. each turn/toolCall/customEntry tagged with a `promptIndex`).
- `tests/harness/cli.ts`: new `send` subcommand — after a `run` reaches `done` or `waiting`, `send --ipc <dir> --prompt "<text>"` dispatches a follow-up prompt into the same live session and returns to `running`. `trace` output accumulates across sends.
- `tests/harness/ipc.ts` and harness types as needed.

**Out of scope:** anything under `src/`; `manual-run.ts` (legacy — leave untouched); changing default settle/grace values.

**Tests (TDD):**
1. Unit test with a mocked session: two prompts settle in order; `customEntries` accumulate across both; `promptIndex` tagging correct.
2. Unit test: single-`prompt` callers see byte-identical behavior to before (run an existing runner test unmodified).
3. Unit test for `send` IPC state transitions (`done`→`running`→`done`).

**Likely wrong:** breaking the single-prompt API; deleting a caller-provided `OPENCANDLE_HOME` (only self-created temp homes may be deleted — this is a previously-fixed bug, do not regress it); starting the second prompt before settle completes; leaking the settle-grace multi-step heuristic decision across prompts.

**Reviewer verification:** diff is additive in the harness only; run `npm run test:evals -- -t <one existing case>` (or the cheapest existing eval) to prove no behavior change; read the new unit tests for real assertions, not snapshots.

---

## I2 — Evidence capture + structured analyst outputs (the evidence spine, part 1)

**Spec anchor (discovered 2026-07-03):** the baseline capability spec `openspec/specs/structured-analysts/spec.md` ALREADY mandates this direction — typed analyst output contracts (signal/conviction/thesis/evidence), analyst steps receiving structured prior evidence instead of conversation history, and synthesis consuming typed outputs with a computed vote tally. The live code does none of it, so I2+I3 are compliance work, not new architecture. Run them as an OpenSpec change against `structured-analysts` (propose flow), not as spec-less PRs. One deliberate divergence to record in that change's proposal: the spec's "analyst prompts are generated from step contracts" requirement (replacing the static `ANALYST_PROMPTS`) is explicitly DEFERRED — I2/I3 are observe-only wiring with prompts untouched; do not let validation pressure prompt rewrites into this slice.

**Why (top-ranked item):** The comprehensive-analysis pipeline is free text end to end. Structured parsers (`parseAnalystOutput`, `parseDebateOutput` in `src/analysts/contracts.ts`), the evidence plumbing (`priorEvidence` in `src/runtime/workflow-runner.ts`), and the deterministic validator (`src/runtime/validation.ts`) all exist with **zero production callers**. The prompt-step executor returns `{ evidence: [] }` unconditionally (`src/runtime/prompt-step.ts:46-52` — "Evidence will be captured separately via tool call hooks", never wired). The GUI projector, lacking real signals, infers workflow progress from stop reasons and text regexes (`gui/server/projector.ts`; `analystsDone` hardcoded 0). This item activates the existing layer, observe-only.

**Scope:**
1. **Evidence capture.** During a workflow step, subscribe to the Pi session's tool-execution events and populate `StepOutput.evidence` with `{tool, args, resultDigest, startedAt, completedAt}` records scoped to that step. **Decided record shape (don't redesign it):** `args` = the tool-call args serialized to JSON, truncated to 500 chars; `resultDigest` = `{preview: string (first 500 chars of the serialized result), totalLength: number}`. No hashing, no full-result storage — the digest exists for validation lookups and trace readability, and `RuntimeValidator` consumers needing full numbers read them from the tool-result entries already in the session, not from the digest. (production executor lives in `SessionCoordinator.startWorkflowRun`, `src/runtime/session-coordinator.ts:445-465`). `priorEvidence` must now carry real records. Also emit the existing `tool_called` workflow events with the step linkage if not already done.
2. **Structured stage outputs.** On completion of each `analyst_*` and `debate_*` step, run the existing parser from `contracts.ts` over the step's final assistant text. Parsed → store the structured output on the step record AND `pi.appendEntry("opencandle-analyst-step", {stage, signal, conviction, parsed: true})`. Parse failure → send exactly ONE re-prompt restating the required output format (the format contract text already exists in the stage prompts — reference it, do not rewrite it); still failing → record `parsed: false`, append the entry with `parsed: false`, continue. **Never fail a step or run on parse failure.**
3. **Projector upgrade (small):** derive `analystsDone` in `gui/server/projector.ts` from `opencandle-analyst-step` entries instead of the hardcoded 0. Do not otherwise restructure the projector.

**Files:** `src/runtime/prompt-step.ts`, `src/runtime/session-coordinator.ts` (executor closure only), `src/analysts/orchestrator.ts` (entry emission wiring only — NOT prompt strings), `src/runtime/workflow-events.ts` if event payloads need the step linkage, `gui/server/projector.ts` (analystsDone only), tests.

**Out of scope:** parser logic in `contracts.ts` (use as-is; if a parser seems wrong, report, don't fix); all prompt text; `src/routing/`; SQLite schema; any enforcement/blocking based on parsed values (that is I3); answer-contract migration statuses.

**Tests (TDD):**
1. Failing unit test first: executor returns populated evidence from mocked tool events, scoped per step (tool calls during step 2 don't leak into step 1's evidence).
2. Unit: parse-success path stores structure + appends entry; parse-fail path re-prompts once then records `parsed: false`; skippable-step semantics unchanged.
3. Extend the LLM-free pattern in `tests/unit/harness/custom-entries.test.ts`: `opencandle-analyst-step` entries appear in `customEntries`.
4. Projector unit test: `analystsDone` counts entries.

**Runtime evidence:** one live `/analyze <ticker>` run via `npx tsx tests/harness/cli.ts run --prompt "analyze NVDA" --ipc <dir>`; commit the resulting `trace.json` (redact nothing — it's market data) showing >= 5 `opencandle-analyst-step` entries with `stage`/`signal`/`parsed` and step evidence referencing tools present in `toolCalls`.

**Likely wrong:** editing analyst prompts to make parsing easier (hard reject); blocking on parse failure; capturing evidence globally instead of per-step; subscribing to tool events once and never unsubscribing (leak across runs); needing a hook that only exists in `src/pi/opencandle-extension.ts` and improvising there — if you need an extension change, STOP and report which hook you need (`src/pi/` is ask-first).

**Reviewer verification:** the PR diff (against its integration-branch base) over `src/analysts/orchestrator.ts` and `src/prompts/` shows zero changes inside template literals; run the live harness check yourself and confirm entries exist in a real trace (if entries appear in tests but not live, the wiring is mock-only — reject); confirm no existing test assertions were weakened.

---

## I3 — Deterministic synthesis inputs + live validation (evidence spine, part 2; after I2)

**Why:** Today the synthesis model counts its own votes ("check the five analyst SIGNAL: lines above"), the rebuttal stage self-gates via prompt instruction ("REBUTTAL SKIPPED — consensus reached"), and the final "validation" stage is a skippable LLM self-check whose output nothing parses. `validation_passed/failed` workflow events have no live emitter.

**Scope:**
1. **Code-computed tally.** After the five analyst steps, compute the vote tally with the existing `tallyVotes` over I2's parsed outputs; inject the computed tally into the synthesis step's prompt as a structured facts block (this is an authorized, minimal prompt-assembly change: you are adding a data block to the synthesis prompt builder, not rewriting its instructions). Analyst free text remains in context — the tally supplements, never replaces.
2. **Programmatic rebuttal gating.** Use the existing `isAnalystSplit` (currently marked test-only) to decide the rebuttal step: no BUY+SELL split → skip via the runner's existing `skipped` status (the runner already supports skippable steps). Remove reliance on the model's self-gating; the "REBUTTAL SKIPPED" prompt instruction becomes dead and may be left in place (do not edit the prompt).
3. **Live validation, observe-only.** After synthesis, run `RuntimeValidator` (at minimum `checkNumberMatch`) against I2's captured evidence; emit `validation_passed` / `validation_failed` workflow events (their types already exist in `workflow-events.ts` with no emitter) and append `opencandle-validation` `{passed, mismatches: [...]}`. Unparsed analyst steps (`parsed: false`) are recorded as `skipped_unparsed`, not failures. **No enforcement:** validation failure changes nothing about the run's output in this item.
4. Degradation rule: if fewer than 2 analyst steps parsed, skip tally injection entirely (synthesis runs exactly as today) and record `tally_skipped` in the workflow events. Never let structured-path failures make output worse than the status quo.

**Out of scope:** auto-correction turns; changing verdict/step order; answer-contract enforcement; GUI rendering of validation results (follow-up).

**Tests:** unit for tally injection (present when >= 2 parsed, absent otherwise); unit for split-gating truth table (BUY+SELL → rebuttal runs; consensus → step `skipped`); unit for validator emission with seeded evidence mismatch; harness e2e asserting `opencandle-validation` appears on a live `/analyze`.

**Runtime evidence:** live `/analyze` trace showing the tally block in the synthesis step's dispatched prompt (the workflow events/entries should make this visible) and an `opencandle-validation` entry.

**Likely wrong:** replacing analyst text with the tally; treating validator false positives as run failures; editing the rebuttal prompt; resurrecting any debate on/off flag (the debate always runs — a removed env flag must not return).

**Reviewer verification:** same prompt-integrity gate as I2 plus: confirm the only prompt-builder change is additive data injection in the synthesis builder; check the degradation rule by forcing `parsed: false` in a test and confirming a byte-equivalent synthesis prompt to the pre-change baseline (the PR's integration-branch base).

---

## I4 — `/forget` implementation — **BACKLOGGED (2026-07-04 maintainer decision — do not implement)**

**Status:** deferred. The WP6 spec merged and `openspec/changes/forget-command/` stays **active and untouched** on `main` — do not implement it, do not archive it, and do not "clean it up" as stale backlog (it is deliberate). E4 below is deferred with it. When it is scheduled later it needs I1's multi-prompt harness support, which will already exist. The section below is preserved as the implementation brief for that future slice.

**Why:** Privacy is a named priority; four independent leak surfaces exist today (priorTurns, structured memory, saved market-state summaries, compaction summaries) with zero coverage; three source comments mark `/forget` as the designated scrubbing primitive (`src/runtime/session-coordinator.ts` ~217-220, `src/routing/router-prompt.ts` ~5-9, `src/pi/opencandle-extension.ts` ~709).

**Scope: implement exactly the WP6 spec.** Binding product decisions: suppress from AI context only (saved watchlist/portfolio rows untouched); no transcript redaction in v1; whole-turn exclusion, not masking; forget list filters history, not the live turn. Summary of the decided design (the WP6 spec text in the change directory is authoritative if they diverge):
- New `forget_entries` table; schema v8 → v9 additive migration with a migration test on a real v8 fixture DB. (Memory-schema authorization is scoped to exactly this table.)
- Matcher: ticker mode (word-boundary, case-insensitive, `$`-stripped) vs phrase mode (case-insensitive substring), with the spec's decision table as unit tests.
- Four suppression surfaces: `buildPriorTurns` exclusion; read-time filtering of structured memory in prompt-context assembly; market-state summary filtering in the prompt-context builder; compaction-summary exclusion from priorTurns.
- `/forget <topic>`, `/forget` (list), and the undo command per spec; confirmation must not echo matched text.
- **Closeout:** the completing PR checks off the change's tasks.md against the delivered tests/evidence and **archives the `forget-command` change** (`openspec validate --strict` first), so no separate archival PR is needed.

**Files:** `src/pi/opencandle-extension.ts` (command registration — the one authorized `src/pi/` touch), `src/runtime/session-coordinator.ts` (`buildPriorTurns`), `src/memory/` (table, migration, matcher module), `src/prompts/context-builder.ts` (market-state + memory filtering). **Out of scope:** GUI transcript/chat rendering, session-entry deletion, deleting any market-state or memory rows, router internals.

**Tests:** the WP6 verification list — matcher decision table; v8→v9 migration test; extension test asserting the **serialized router prompt** for the post-forget turn contains no match (assert on the final string, not intermediate structures); harness e2e using I1's multi-prompt support (turn 1 mentions topic → turn 2 `/forget` → turn 3 unrelated question → `trace.json` router input clean); eval E4 below.

**Likely wrong:** substring matching in ticker mode (scrubs "ASTS" out of "blasts"); scrubbing only one or two of the four surfaces; filtering the live turn (spec says history only); echoing the topic in the confirmation; O(entries x turns) rescans of the whole session per turn without caching the compiled matchers; deleting rows anywhere.

**Reviewer verification:** run the E4 flow yourself and grep the serialized router prompt in the trace for the forgotten token (and for the *lowercased* and `$`-prefixed variants); verify migration test uses a real fixture DB file, not `:memory:` schema-fresh; confirm zero deletions of user data in the diff.

---

## I5 — Eval expansion (the adversarial suite)

**Why:** Every recurring competitive-loss class and audit gap becomes a regression tripwire; all future delegation gets cheaper to verify. Current holes: no end-to-end multi-turn, no provider-outage injection, no ask-vs-guess case, no privacy eval (E4 — deferred with I4), GUI browser suite in no CI gate, router fixtures stopped at 26 with task 4.7's candidates unwritten.

**Ground rule for the eval author:** if a new case fails against current behavior, that is a FINDING — record it in the PR description and mark the case appropriately (skip/known-fail annotation consistent with the suite's conventions). **Never modify production code to make your own eval pass.** Deterministic suites must not make live API calls; keep benchmark literals in manifests/tests only (`tests/unit/prompts/prompt-debt-guard.test.ts` enforces this — respect it, don't fight it).

**Calibration rule (removes threshold judgment):** do not invent thresholds or scoring conventions. Copy the conventions of the nearest existing suite (router fixtures → structural equality with `reasoning` exempt; 7-layer cases → existing layer config and the always/usually tier split; product evals → the existing dimension/PASS_THRESHOLD scheme). Placement rule: a new deterministic case goes into a gating suite only if it passes on `main` today; any case that fails on `main`, or needs a live model, starts in the non-gating tier (`usually` / opt-in script) with a `// PROMOTE:` comment, and the reviewer decides promotion — never the author.

### E1 — Live multi-turn coreference (needs I1)
Three-turn session: "tell me about NVDA" → "what about at $500?" → (with seeded portfolio containing AMD) "and compare it to the one I hold".
- **Expected:** turn-2/3 `opencandle-router` entries carry prior-turn-derived symbols in `entities` (NOT `slots` — the `user|preference|default` provenance enum must survive); turn 3 resolves "the one I hold" from saved state.
- **Trace evidence:** `evalTrace.customEntries` → `opencandle-router.entities`, slot `source` fields, `opencandle-route-context` priorTurns presence.
- **Catches:** `buildPriorTurns` regressions across Pi upgrades (its implementation depends on vendored Pi internals — explicitly fragile), provenance corruption.

### E2 — Saved market-state fidelity (one wave-2 PR after I1; the seeded single-turn cases may be drafted earlier but land in the same PR)
Against the competitive seed fixture (`OPENCANDLE_COMPETITIVE_SEED_STATE` fixture or a purpose-built twin): "is my current portfolio too exposed if rates stay high?" (must route to portfolio review, NOT `portfolio_builder` — the exact documented 2026-06-17 competitive loss); "what's my cost basis on my SPY lot?" (must quote the stored lot, not estimate).
- **Trace evidence:** `opencandle-route-context` shows saved-state summary injected; routed workflow/agent path; final text contains fixture values (layer-4-style number check against the fixture).
- **Catches:** the dominant historical loss class (existing-portfolio prompts routed to construction), saved-state context gating regressions.

### E3 — Missing/stale provider data (fully deterministic; start immediately)
Fixture-mocked `fetch`: Yahoo returns 429/zero-filled payloads for one symbol mid-comparison; a second case with stale (weekend-dated) quote timestamps.
- **Expected:** explicit unavailability disclosure; no fabricated number for the missing symbol; compare proceeds on survivors with a dropped-symbol note; correlation computes a partial matrix; no `$0.00` presented as a price; `opencandle-turn-gap` entry present.
- **Catches:** regressions of the InvalidSymbolError/zero-quote heuristic and the "missing data became the thesis" failure class. Cheapest suite to keep in plain `npm test`.

### E4 — Privacy / `/forget` — **BACKLOGGED with I4** (needs I1 + I4; author alongside I4 when scheduled, TDD)
Turn 1: "I hold 4,000 shares of XYZ at $12" → turn 2: `/forget XYZ` → turn 3: "what should I buy this month?"
- **Expected:** turn-3 serialized router prompt and prompt context contain no "XYZ"/"$XYZ" (case-insensitive); structured memory and market-state summary surfaces clean; confirmation message does not echo "XYZ" beyond the user's typed command; turn-3 answer does not reference the position.
- **Catches:** any future context-assembly refactor re-leaking a scrubbed topic through any of the four surfaces.

### E5 — Ask-instead-of-guess boundary (needs I1 for context variants)
Paired cases: ambiguous ("should I sell my calls?" with two seeded option positions; "compare the banks" with no tickers) vs. resolvable twins (same prompts where saved state or prior turns disambiguate).
- **Expected:** ambiguous → exactly one focused `ask_user` (`expectedAskUserCount: 1` — the e2e scorer already supports this, currently unused); resolvable → zero `ask_user` and correct resolution. The pairing catches both over-asking and over-guessing.

### E6 — GUI/TUI parity (after I2 gives the projector real signals)
Same prompt through `runOpenCandleSession` (TUI path) and through the GUI server chat-run API (extend `tests/e2e/gui-browser.test.ts`); diff the `opencandle-*` entry sequences and assert the projector-derived dashboard state agrees with the entries (post-I2, `analystsDone` must match the analyst-step entry count).
- **Release-gate change (separate small PR):** promote a small credential-free slice of `test:gui:browser` plus a first-run smoke into `release:check`. First-run TUI/GUI exercise being absent from the gate is a standing audit finding. **Decided scope — no model round-trip and no model mocking:** the gate slice asserts only (a) GUI server boots and `/health` responds, (b) home route renders in a real browser, (c) first-run model-setup state renders using the real production status values (`ready` / `select_model` / `connect_auth` from `gui/server/model-setup.ts` — NOT the retired `needs_api_key` fixture value, a previously-flagged audit finding), and (d) the composer is disabled until setup is ready. Anything requiring a live or mocked model stays in the full opt-in browser suite, not the gate.

### E7 — Frozen competitive adversarial panel
Keep the generated 5-prompt benchmark for discovery; add a FROZEN panel rerun per release from the historical loss classes: portfolio-review-not-builder; "1-2 weeks" DTE preservation; protective-put-not-bullish-call; unknown-ticker-no-dead-end; hedge sizing with share count. Assert via `finalAnswerHardAssertions` in the prompt-policy manifest so literals stay out of production prompts. Frozen + cached baselines = trend line.

### Also in I5:
- Author the 4–9 router fixtures from archived task 4.7's candidate list (multi-symbol compare with prior context; fallback-from-general-qa shift; preference ECHO that must NOT become a `preference_update`; router misclassification recovery). Update `BASELINE.json` count, and run `npm run eval:router-live` after adding fixtures so the archived baseline in `tests/fixtures/router/eval-baselines/` covers the grown set (cleanup WP2 archives the pre-growth baseline; this refreshes it).
- Establish the live-eval cadence: `eval:router-live`, `test:evals` (always tier), and `test:evals:product` run per release as part of release preparation (documented in the release checklist), with the E7 frozen competitive panel. Live suites are not in per-PR CI, but they are not optional at release time.
- Optional (moved from cleanup WP2): add a Pi-auth model-resolution mode to `tests/scripts/run-live-router-eval.ts` (resolve via the Pi model registry + `~/.pi/agent/` auth storage — the same path production's `ctx.model` uses via `resolveRouterLlmClient` in `src/pi/opencandle-extension.ts`) to enable a Claude-family comparison baseline without any API key. Current state of the script for context: it resolves models through pi-ai's built-in API providers (`registerBuiltInApiProviders()` + `getModel`, default `anthropic`/`claude-haiku-4-5`, overridable via `OPENCANDLE_ROUTER_PROVIDER`/`OPENCANDLE_ROUTER_MODEL`) and therefore needs a raw API key today. acpx remains rejected as a router-eval transport: it drives a full agent CLI, not the router's raw prompt→JSON call.

**Reviewer verification for all of I5:** every case has explicit assertions on trace evidence (no vibes-only rubrics in deterministic suites); failed-against-current-behavior cases are flagged findings, not silently weakened; no live calls in deterministic suites; prompt-debt-guard still green.

---

## I6 — DONE (shipped as cleanup plan WP7)

Coordinator verification closeout (the 1.8 long-stream test, auto-retry pinning test, 5.4 convergence smoke, and archival of `transparent-local-session-coordinator`) shipped as cleanup WP7 (commit `e57e499`) and merged to `main` in #64; the coordinator change is archived at `openspec/changes/archive/2026-07-04-transparent-local-session-coordinator/`. Nothing remains. The item number I6 is retired to keep cross-references in both docs stable; nothing else renumbers.

---

## I7 — GUI session-scoped action cleanup (WP4.2 spec merged — can start now)

**Why:** The GUI currently has two send paths (legacy active-session + session-addressed), the exact "ambiguous ownership" state the original design forbade. Product decision: slim scope, aligned to the shipped coordinator's `actionId` envelope. Concretely (verified on `main` 2026-07-04): the legacy implicit-active-session path is `POST /api/chat/run` (`gui/server/http-routes.ts` ~line 235, calls `handleSseChatRun` with no session addressing); the session-addressed paths are `POST /api/local-coordinator/chat-run` / `tool-invoke` / `ask-user` (explicit `body.sessionId`) and `POST /api/sessions/{id}/runs`. Recent coordinator-hardening commits (owner-liveness helpers, lock-scope fail-closed, boot coordination from session locks) landed around these files but did NOT remove the legacy path — the WP4.2 tasks are all still open.

**Scope: implement the WP4.2 change:** remove the legacy active-session mutation path (routes removed or 410); every mutation (chat run, stop, retry/regenerate, ask_user answer/cancel, tool.invoke) carries explicit `sessionId` + coordinator `actionId` semantics; one active run per session with cross-session concurrency; parity confirmation of TUI resume per the spec's concrete expectation.

**Files:** `gui/server/http-routes.ts`, `gui/server/session-actions.ts`, `gui/server/local-session-coordinator.ts` (consumption only, not envelope semantics), `gui/web/src/` call sites, tests. **Out of scope:** lock/envelope format changes (coordinator owns them), follower/takeover UX, queued same-session prompts, market-state mutation coordination (explicitly deferred by the coordinator change).

**Tests:** GUI-server unit tests for scoped stop/retry/ask_user against a non-focused session; a two-session concurrent browser test in `tests/e2e/gui-browser.test.ts`; grep-level assertion (a real test, e.g. route-table snapshot) that no mutation route resolves an implicit active session.

**Closeout:** the completing PR checks off the change's tasks.md and **archives the `gui-session-scoped-action-cleanup` change** (`openspec validate --strict` first). This leaves `forget-command` as the only active OpenSpec change — that is intentional (I4 is backlogged), not a loose end.

**Runtime evidence:** browser screenshots/log of two sessions running concurrently with a stop issued to the background one; TUI resume transcript.

**Likely wrong:** leaving the legacy route alive "for safety" (the whole point is removing the second path); scoping stop by browser tab instead of session; breaking the home-composer fresh-session flow (`session_changed` 409 retry behavior is load-bearing and has history — read its tests first).

---

## I8 — North star: runtime answer receipts (claim-to-evidence binding)

**Status:** direction, not yet a scheduled item. Requires an OpenSpec proposal before implementation; phase 1 below is only viable after I2+I3 land. Recorded here so the sequence builds toward it deliberately.

**The idea:** every number and factual claim in a final answer is bound at generation time to a captured evidence record (tool, provider, as-of timestamp, freshness), checked deterministically by `RuntimeValidator`, and surfaced in the product — hover a price in the GUI, see the receipt; unverified numbers are visibly flagged. The public homepage already sells "the evidence receipt behind a sample answer"; this makes it a runtime guarantee instead of marketing copy. It attacks the codebase audit's #1 risk (incorrect analytics presented as reliable), is structurally unmatchable by no-tool chatbots, and every future tool inherits verifiability for free.

**Phasing:**
1. (= I2+I3) Evidence captured, validation observed, mismatches in traces.
2. Freshness ledger: a single as-of/market-status service (is the market open, what session is this price from, how stale is this cache hit) attached to every evidence record — the stale-data failure class recurs precisely because freshness is every tool's individual problem today.
3. Answer binding: final-answer post-processing links each numeric claim to its evidence record; unbound numbers flagged in the trace; eval layer-4 faithfulness becomes an every-trace invariant instead of a sampled test.
4. GUI receipts rendering + TUI footnote equivalents.

Write the OpenSpec proposal for phases 2–4 only after phase-1 trace data shows the validator's real-world false-positive rate.

---

## I9 — Gemini router-contract hardening

**Why:** Production routing follows the user's selected Pi model (`resolveRouterLlmClient` uses `ctx.model`), and Gemini is the maintainer's production daily driver. Two live `gemini-2.5-flash` runs from 2026-07-03 are on record: `openspec/changes/archive/2026-07-03-product-audit-downscope/router-live-eval-evidence.md` (6/26 exact, **25/26 route-kind agreement**, every failure classified into classes A–D — this run gated the rules-router removal) and `tests/fixtures/router/eval-baselines/2026-07-03-gemini-2.5-flash.txt` (9/26 exact). Exact-contract drift is large, and the runs disagree with each other at temperature 0: fixture 022 was Class-A benign in one and a route-kind flip (`CPI` → `compare_assets` dispatch with `CPI` in `slots.symbols`) in the other. This item makes the contract hold on `gemini-2.5-flash` — and hold *stably*.

**Scope (in order):**
1. **Triage using the evidence file's existing classification framework (A: benign extra slots, B: richer workflow label same route-kind, C: slot vocabulary synonyms, D: genuine quality differences) — do not invent a new taxonomy.** Re-run the eval twice, build a per-fixture table across all four recorded/new runs, and add a fifth dimension: cross-run stability (any fixture whose class changes between runs is treated as class D until fixed). Fixture 022's benign-vs-route-flip variance is the first entry.
2. **Fix class D (and any unstable fixture) in the deterministic layer** — `src/routing/router.ts` post-processing / `symbol-disambiguator` — never in prompts. The 022 lead suggests slot-level acronym filtering has a gap on outputs where the model routes directly to a workflow; extend the existing slot-sanitization path (CHANGELOG 0.6.0-era: "LLM-router acronym drops now also filter router slot symbols"). The known class-D residents (010 profile-preference copy, 025 symbol order, 017 conversational-preference pass_through) each get a deterministic fix, a justified exemption, or a documented-gap entry — never silence.
3. **Fix class A via canonicalization** in the same post-processor, and classes B/C via the eval's `stripNonContract` diff policy in `tests/scripts/run-live-router-eval.ts` — one-line justification per exemption; exemptions that could mask a route-kind change are rejected.
4. **Re-run twice and archive both** fresh `gemini-2.5-flash` baselines; target >= 90% exact-contract per run AND zero route-kind flips across the two runs. Also re-run the deterministic fixture suite (`npm test`) — post-processor changes must not break the 26 mocked fixtures.

**Files:** `src/routing/router.ts`, `src/routing/symbol-disambiguator.ts`, `tests/scripts/run-live-router-eval.ts`, `tests/unit/routing/`, new fixture variants if triage demands them. **Out of scope:** router prompt text (`src/routing/router-prompt.ts` instruction content — hard gate), workflow manifests, changing fixture `expectedRouterOutput` to match wrong behavior.

**Likely wrong:** "fixing" failures by widening `stripNonContract` until everything passes (each exemption needs a justification the reviewer will audit); editing fixtures to match Gemini output without classifying first; touching the router prompt; regressing Claude-family behavior (if a Pi-auth Claude baseline exists from cleanup WP2, re-run it after changes and attach both).

**Reviewer verification:** audit the triage table against the archived baseline line-by-line for at least the 5 acronym fixtures (019–025); confirm fixture 022's fix is deterministic-layer; diff `stripNonContract` exemptions against the justification list; require both fresh baselines committed.

## Do NOT spend implementation-agent budget on

- `refine-gui-market-state-ux` visual polish (archived as superseded; see cleanup WP3).
- Biome warning burn-down, GUI bundle-size, shiki/MDX, SBOM, GitHub-Actions SHA-pinning — real but mechanical; batch someday, never at the cost of the items above.
- Re-running the generated competitive benchmark repeatedly — cached-baseline reruns are confirmation, not discovery. E7's frozen panel replaces babysitting.
- Hand-tuning prompts to fix any individual eval failure — classification into the narrowest durable layer first (AGENTS.md), and prompt edits are gated anyway.
- The two remaining audit nits (DCF fallback net-debt formula in `src/tools/fundamentals/dcf.ts`; cumulative-vs-session VWAP labeling in `src/tools/technical/indicators.ts`) — fine one-file starter tasks for a new agent, but they don't move any priority; take them only as warm-ups.

## Reviewer protocol (applies to every PR from this plan)

Review model: item PRs target `feat/high-leverage-improvements` and are merged there by the orchestrator on green gates; the maintainer reviews each PR after the fact against this protocol, and the final `feat/high-leverage-improvements` → `main` merge is the maintainer's gate — nothing from this plan reaches `main` unreviewed. Review findings become follow-up commits on the integration branch.

1. **Scope containment:** diff touches only the item's listed files. Prompt-string edits in a non-prompt item → reject. Ask-first-area edits beyond the item's explicit authorization → reject or escalate.
2. **Spec conformance:** every scenario in the governing spec maps to a test; every checked task maps to evidence. Watch for the known anti-pattern: verification tasks ticked while implementation tasks are open.
3. **Trace-level truth:** don't trust the PR description — verify the claimed entries/fields against the evidence excerpts in the PR and the local git-ignored `docs/internal/pr-evidence/` artifacts (re-run the live scenario if the local artifacts are gone). If behavior is observable only via mocks, reject and require a live trace.
4. **Reject even if tests pass when:** tests/fixtures were edited to match new behavior without spec justification; an eval was "fixed" by special-casing its literals; assertions were weakened; error paths swallow provider failures into fabricatable defaults; idempotency/concurrency semantics changed without a concurrency test.
5. **Request an OpenSpec clarification instead of accepting code when:** the implementation had to invent semantics the spec deferred; two specs conflict on the touched requirement; the PR contradicts shipped reality; a "no schema change" assertion proved false mid-implementation. The reviewer's output in these cases is a spec-edit proposal, not an approval.
