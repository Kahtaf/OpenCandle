# OpenSpec Backlog Cleanup Plan

**Date:** 2026-07-03
**Status of decisions:** Final. Product owner confirmed the three open product questions on 2026-07-03 (see "Product decisions" below). Everything else was decided by the architecture review; do not re-litigate decisions here — execute them. If you hit a genuine contradiction between this plan and the repo, STOP and report; do not improvise.

**Audience:** an implementation agent executing spec/document edits, archival, and — in WP7 only — test code. This plan involves **no production code changes** and **no feature implementation**: WP7 authorizes new *test* files to close verification gates, nothing more. Outside WP7, if you find yourself editing anything under `src/`, `gui/`, or `tests/` (other than reading), you have left the scope of this plan. Feature implementation for the two changes that survive this cleanup (`forget-command`, `gui-session-scoped-action-cleanup`) is owned by `docs/internal/high-leverage-improvements-plan.md` items I4 and I7, whose completing PRs also archive those changes — so the backlog reaches zero active changes at the end of that plan, not this one.

---

## Branching & PR policy

All cleanup work funnels through a single integration branch so one branch contains every OpenSpec update at the end:

- **Integration branch:** `feat/openspec-backlog-cleanup`, cut from `main`. This plan document lives on it. Do not commit WP work directly to it.
- **Per-package branches:** cut each WP branch FROM the integration branch (not from `main`), named `feat/openspec-wp<N>-<slug>`:
  - `feat/openspec-wp1-archive-finished`
  - `feat/openspec-wp2-router-rebaseline`
  - `feat/openspec-wp3-archive-market-state-ux`
  - `feat/openspec-wp4-gui-concurrent-rebaseline`
  - `feat/openspec-wp5-coordinator-closeout`
  - `feat/openspec-wp6-forget-spec`
  - `feat/openspec-wp7-coordinator-verification`
- **PR target:** every WP PR targets `feat/openspec-backlog-cleanup`, NOT `main`. **Merge order follows the dependency table at the end of this plan, not strict numeric order** (amended 2026-07-03): WP1, WP3, and WP5 have no dependencies and merge as soon as green; WP2/WP4/WP6 merge after WP1; WP7 merges after WP5. After each merge, in-flight WP branches rebase onto the updated integration branch before review.
- **Final step:** after WP7 merges, one PR from `feat/openspec-backlog-cleanup` → `main` delivers all OpenSpec updates together. Its description links each WP PR and includes the aggregate `openspec validate --strict` output.
- Note: `npm run review:pr` auto-detects the PR base via `gh`, so it will review WP diffs against the integration branch correctly — run it per WP PR as usual.

## Ground rules

1. Read `AGENTS.md` first and follow it.
2. Work on a branch per work package (WP1–WP7 below) per the Branching & PR policy above, one PR each, in the listed order. Later packages assume earlier ones merged into the integration branch.
3. Use the `openspec` CLI for validation and archival. Before archiving anything, run `openspec validate --strict` for that change and fix what it reports.
4. **Critical OpenSpec mechanic:** archiving a change applies its `specs/**` deltas to the baseline specs in `openspec/specs/`. Therefore a change whose deltas describe behavior that no longer matches `main` MUST have its deltas corrected **before** archival, or the baseline specs will be corrupted with stale requirements. Several packages below exist precisely for this reason.
5. Every PR: run `npm test` (should be untouched/green — these are doc edits), `npx biome ci .` if it covers markdown, and `openspec validate --strict` for every change directory you touched. Add a CHANGELOG `[Unreleased]` entry only for WP4 and WP6 (they create/rewrite change proposals users may care about); pure archival needs no changelog entry.
6. Do not delete anything outside `openspec/changes/`. Archival moves changes to `openspec/changes/archive/` — use the CLI, don't move directories by hand.

## Background (why each decision was made)

A 2026-07-03 architecture review of all seven active changes found:

- Two changes are complete and archive-ready (`consolidate-public-site-design-system` 25/25, `router-context-and-observability` 29/31 with only non-gating tasks open).
- `production-router-and-tool-hardening` (48/51) has a stale spec: its `intent-routing` delta says the router default "remains `rules`", but v0.11.0 shipped the LLM router as the **only** production path (`OPENCANDLE_ROUTER_MODE=rules` now fails startup). Its own section-1 gate tasks are unchecked — but **the promotion WAS gated elsewhere** (discovered 2026-07-03 during readiness review): the archived `2026-07-03-product-audit-downscope` change amended the intent-routing removal-gate requirement to a classified-evidence gate (now in the baseline spec at `openspec/specs/intent-routing/spec.md`, "Deterministic safety nets survive rules-router removal" section) and satisfied it in `openspec/changes/archive/2026-07-03-product-audit-downscope/router-live-eval-evidence.md` — a live `gemini-2.5-flash` run with 25/26 route-kind agreement and every failure classified (classes A–D). That change also absorbed `remove-rule-router` (archived same day; its gate tasks are unchecked because superseded, not skipped). WP2 is therefore delta correction + honest cross-referencing, NOT evidence creation.
- `refine-gui-market-state-ux` (0/28) specs a deleted feature (Predictions/Thesis Tracker, removed in 0.11.0 with the v8 schema migration), deleted controls (manual "Refresh prices" buttons, removed in 0.6.0-era work), and retired UX language (follower/read-only mode, prohibited by the shipped transparent-local-session-coordinator). Implementing it as written would reintroduce removed behavior.
- `gui-concurrent-session-runtime` (32/67) conflicts with the shipped coordinator change on the same `pi-synced-gui` capability (visible follower/takeover vs. neutral language), has a competing idempotency scheme (`requestId` vs the shipped `actionId`), and has closing verification tasks checked while implementation tasks above them are unchecked.
- `transparent-local-session-coordinator` (39/44) is shipped per CHANGELOG but its open tasks are the safety-critical verifications; its spec still contains an un-narrowed TUI-follower requirement its own design says must be narrowed, and its timing constants are unresolved "open questions" even though the implementation has concrete values.
- `forget-command` (0/8) defers its own core semantics (matching rules, mask-vs-delete, persistence) to implementation and omits two leak surfaces entirely (GUI transcript, saved market-state prompt context).

## Product decisions (confirmed by product owner, 2026-07-03)

These are binding on WP6 and on the later implementation change:

- **P1 — `/forget` and saved market state:** `/forget ASTS` suppresses ASTS from AI-visible context (router input, prompt context, memory retrieval, saved market-state summaries) but does **not** delete watchlist/portfolio rows. The data stays visible and manageable in the GUI.
- **P2 — `/forget` and transcripts:** v1 scrubs AI context only. The visible GUI/TUI transcript is untouched; this is a documented limitation with transcript redaction as a possible follow-up. Do not delete or rewrite Pi session entries.
- **P3 — gui-concurrent remainder:** re-baseline into a slim follow-up change; archive the stale original.

---

## WP1 — Archive the two finished changes

**Changes:** `consolidate-public-site-design-system`, `router-context-and-observability`.

### WP1.1 `consolidate-public-site-design-system`
1. In its `design.md`, append a short "Resolution of open questions" section answering the two open questions with what actually shipped (verify by reading the repo, don't guess):
   - Client-side hydration for mobile nav: state what `website/` actually does today (check `website/` source for any hydration/JS for the nav drawer).
   - Shiki in first slice: it was deferred; state that it remains deferred and is not tracked by any active change.
2. Also verify and note whether the old `website/build.mjs` markdown pipeline was fully removed (search for the old functions `stripFrontmatter`, `inlineMarkdown`, `renderTable` under `website/`). If remnants exist, do NOT remove them — record the fact in the resolution note so it becomes a visible follow-up.
3. `openspec validate --strict`, then archive via the archival skill/CLI.

### WP1.2 `router-context-and-observability`
0. **Delta-section fix (verified against baseline 2026-07-03; required or archival validation fails).** In the change's `specs/intent-routing/spec.md`, the `## MODIFIED Requirements` section lists three requirements, but only `Prior-Turn Context Window` exists in the baseline (`openspec/specs/intent-routing/spec.md`). Move BOTH `Prior-Turn Shape` AND `Prior-Turn Privacy and Forget Integration` into an `## ADDED Requirements` section (requirement text unchanged); leave `Prior-Turn Context Window` under MODIFIED. The `router-evals` delta is correct as-is (both its MODIFIED entries exist in baseline).
1. Task 4.7 (author 4–9 more router fixtures) is being moved, not dropped: it is now owned by the eval-expansion work item in `docs/internal/high-leverage-improvements-plan.md` (item I5). Edit `tasks.md`: mark 4.7 with a note "Moved to docs/internal/high-leverage-improvements-plan.md (I5 — eval expansion); candidate list preserved there." Do the same for optional task 7.3 (live router eval run): note it is superseded by the mandatory baseline run in WP2 of this plan.
2. In `design.md`, close the recorded open questions (customEntries `id`/`parentId`, turn-shape v2 location, `buildPriorTurns` placement) with one-line "resolved as implemented" notes pointing at the current code locations (`src/runtime/session-coordinator.ts`, `src/routing/router-prompt.ts`).
3. Validate strictly, then archive.

**Acceptance for WP1:** both directories moved under `openspec/changes/archive/` with a date prefix; `openspec validate --strict` clean; baseline specs under `openspec/specs/` updated by the archival and still internally consistent (spot-read the `intent-routing` and `test-harness-observability` specs afterward).

---

## WP2 — Re-baseline and close out `production-router-and-tool-hardening`

This is the highest-priority spec-integrity fix: the change's `intent-routing` delta contradicts shipped v0.11.0 behavior.

1. **Correct the stale delta.** In `openspec/changes/production-router-and-tool-hardening/specs/intent-routing/spec.md`, the requirement "Router Default Remains Gated" (and its scenario asserting `getConfig().routerMode === "rules"`) must be rewritten to match shipped reality:
   - The LLM router is the default and only production routing path.
   - `OPENCANDLE_ROUTER_MODE` accepts only `llm` or unset; `rules` fails startup with migration guidance.
   - Deterministic safety nets (acronym disambiguation via `symbol-disambiguator`, symbol preflight, compare clarification aborts, router validation-failure recovery) remain active on LLM router output.
   Cross-check the wording against the CURRENT baseline `openspec/specs/intent-routing/spec.md` (already updated to llm-only with the classified-evidence removal gate by the `product-audit-downscope` archival), `AGENTS.md` "ENV FLAGS", and CHANGELOG 0.11.0 "Removed" — the corrected delta must describe what `main` does today and must not regress the baseline when applied.
2. **Cross-reference the promotion evidence in a design.md addendum.** Record, factually: (a) the LLM-only default shipped in 0.11.0 via `product-audit-downscope`, which amended the removal gate to a classified-evidence requirement and satisfied it in `openspec/changes/archive/2026-07-03-product-audit-downscope/router-live-eval-evidence.md` (`gemini-2.5-flash` — the maintainer's production daily-driver model — 6/26 exact-contract match, **25/26 route-kind agreement**, failure classes A–D, one explained route-kind gap on fixture 017); (b) this change's own original numeric gate (>= 90% exact match, p95 <= 1500 ms, defined against `claude-haiku-4-5`) was SUPERSEDED by that amended requirement — mark tasks 1.1–1.3 "[superseded by the product-audit-downscope classified-evidence gate — see design addendum]", not checked; (c) `remove-rule-router` was created and absorbed by the downscope change (archived 2026-07-03 with its gate tasks unchecked because superseded).
3. **Cite the second baseline and the variance finding (no new eval run in this package).** A second live run is archived at `tests/fixtures/router/eval-baselines/2026-07-03-gemini-2.5-flash.txt` (9/26 exact, p50 1924ms / p95 2184ms). Record in the addendum the cross-run variance that matters for triage: fixture 022 (`cpi-as-metric`) held its route kind in the downscope evidence run (classified Class-A benign) but flipped to `workflow_dispatch`/`compare_assets` with `CPI` surviving in `slots.symbols` in the second run — same model, temperature 0. Improvements item I9 (Gemini router-contract hardening) owns closing exact-match drift and cross-run instability; an optional Pi-auth Claude-family comparison baseline is improvements item I5 work. (acpx was evaluated and rejected as a router-eval transport: it drives a full agent CLI, not the router's raw prompt→JSON `completeSimple` path.)
4. **Evidence paths.** Tasks in section 8 reference `/tmp/...` trace paths that no longer exist. Add a one-line note to `tasks.md` section 8 that the runtime evidence was ephemeral and the durable equivalents are the unit/fixture suites (name the specific test files covering IV-drop, zero-quote, preflight behaviors — find them under `tests/unit/routing/` and `tests/unit/providers/` by grepping for `symbol-disambiguator`, `InvalidSymbolError`, `preflight`).
5. Validate strictly, then archive. (The evidence requirement is satisfied by the two recorded runs cited in steps 2–3; this package neither runs new evals nor re-litigates the recorded gate decision.)

---

## WP3 — Archive `refine-gui-market-state-ux` as superseded

Decision: archive without implementing. Rationale in Background above. Its still-valid intent (state-first management surfaces, restrained motion, React Doctor gating) either already shipped through other work or can be re-proposed fresh if wanted.

1. Append a "Superseded" section to its `proposal.md` listing exactly what overtook each requirement group:
   - Symbol-centric market-state redesign, mobile-first layouts, bottom-sheet create/edit: shipped (CHANGELOG 0.6.0-era "GUI market-state pages were redesigned around symbol-centric layouts...").
   - Predictions / "Thesis Tracker": feature removed entirely in 0.11.0 (tool, GUI page, `prediction_records` table dropped by v8 migration). Requirements targeting it are void.
   - "Refresh prices" button requirements: manual refresh buttons were removed in favor of background quote snapshots and an "Updated Xm ago" freshness line. Void.
   - Follower/read-only mode requirements: superseded by `transparent-local-session-coordinator` neutral-language requirement ("SHALL NOT show 'writer', 'follower', 'read-only follower', or 'take over' as the primary user-facing state").
   - React Doctor gating: shipped via the autoreview pipeline changes (React Doctor pinned, diff-scoped scanning, error-level blocking).
2. **Archive with `--skip-specs`; leave the delta file untouched.** Because archival normally applies deltas to baseline specs, and these deltas describe removed features, the `specs/gui-market-state-ux/spec.md` delta must not land in the baseline. **Verified (openspec CLI 1.4.1): `openspec archive --skip-specs` exists** ("Skip spec update operations"). Use it, say so in the PR, and do NOT rewrite or neutralize the delta file — it is syntactically valid as authored, and replacing its contents with prose breaks `openspec validate --strict` (a prior instruction to do so was retracted 2026-07-03 after exactly that failure). The proposal.md "Superseded" section is the archival record.
3. Leave `tasks.md` at 0/28 — do not check anything off. The Superseded section is the record.

**Acceptance:** change archived; `openspec/specs/` contains NO new `gui-market-state-ux` capability (verify after archival); no baseline spec references Predictions/Thesis Tracker or Refresh-prices buttons.

---

## WP4 — Re-baseline `gui-concurrent-session-runtime` into a slim follow-up

Product decision P3: archive the stale change; create a new, narrow change for what is still real.

### WP4.1 Correct and archive the original
1. In its `tasks.md`, fix the integrity problem: the closing verification tasks (`Run npm test`, `Run openspec validate --strict`, `Run browser verification`) are checked while implementation tasks above them are unchecked. Uncheck them and add a note: "Unchecked 2026-07-03: these were ticked mid-flight while implementation was incomplete; change is being re-baselined, see <new-change-name>."
2. Rewrite its spec deltas to describe **only what actually shipped**, so archival records truth:
   - Shipped (verify each against CHANGELOG 0.9.0/0.11.0 and the code): per-route-session independent chat runs; `POST` run requests carrying expected session id with `session_changed` 409 handling; session-scoped chat event rendering; skeleton-on-load; the transcript scroll behaviors that were implemented (check `gui/web/src/features/chat/` for which of the anchoring/auto-follow behaviors exist — only spec what you find).
   - NOT shipped, remove from deltas: user-visible follower/read-only composer states and takeover-flow scenarios (contradict the shipped coordinator — these must not enter baseline specs); the `requestId` idempotency scheme (superseded by the coordinator's `actionId` envelope); writer-lock lifecycle requirements that the coordinator change now owns (its lock-metadata/recovery spec is the canonical one).
3. Validate strictly, archive.

### WP4.2 Create the slim follow-up change
Create a new change (suggested name: `gui-session-scoped-action-cleanup`) via the propose flow, containing ONLY:

- **Requirement group A — single send path.** Remove the legacy "active session" mutation path from the GUI server and client so every mutation (chat run, stop, retry/regenerate, ask_user answer/cancel, tool.invoke) targets an explicit `sessionId` and flows through the coordinator's `actionId` envelope (retry reuses id, repeat mints fresh). Acceptance: grep-level proof that no server route or client call site resolves "the active session" implicitly for mutations; unit tests for stop/retry/ask_user scoped to a non-focused session; the old route(s) removed or returning 410.
- **Requirement group B — cross-session concurrency guarantees.** One active run per session, N sessions concurrently; stop/cancel affects only its session; ask_user answers route to the owning session even when the browser is focused elsewhere. Acceptance: GUI-server unit tests plus one browser test driving two sessions concurrently (extend `tests/e2e/gui-browser.test.ts`).
- **Requirement group C — parity confirmation.** A scripted check that a GUI-created session can be resumed in the TUI. **Decision procedure (discover-and-record, do not choose freely):** read `src/pi/` and the Pi runtime docs to determine which of exactly two behaviors the current code supports: (1) opening a session by exact session file path, or (2) the GUI-created session appearing in the TUI session list and being continuable from there. Spec whichever one the code actually supports today (if both, spec both). Do NOT spec a capability the code lacks, and do NOT propose building new resume capability — that would be a scope change requiring escalation. Confirm-no-schema-change task carried over.
- **Non-goals section:** no queued same-session prompts; no follower/takeover UX (coordinator owns presentation language); no lock-format changes.

Reference the coordinator change's `local-session-coordination` spec as the authority for envelopes/locks. Keep the task list under ~20 items. Implementation is NOT part of this cleanup plan — the change just needs to exist, validated, so the improvements plan can schedule it.

---

## WP5 — Spec closeout edits for `transparent-local-session-coordinator`

Do NOT archive this change in this package. The open verification tasks (1.8 long-stream-survives-grace, 5.4 TUI+GUI convergence smoke, 6.4 gate) involve writing tests and are owned by WP7 below, which archives the change once they land. This package does only the spec/document edits:

1. **Codify the implemented constants.** Read the actual values from code and write them into `design.md` as the resolution of its open question ("What heartbeat interval, stale grace, and action dedupe retention values..."):
   - Stale grace: `DEFAULT_STALE_GRACE_MS` in `src/pi/session-writer-lock.ts` (expected 15s — verify).
   - Heartbeat interval: find the writer heartbeat timer (same file or `gui/server/` writer-lock service).
   - Action dedupe retention: `gui/server/local-session-coordinator.ts` (expected 10 minutes — verify).
   State the derived invariant explicitly: dedupe retention must be >= the retry/recovery horizon, and with auto-retry-after-recovery disabled (see next point) the current values satisfy it.
2. **Resolve task 3.4 by decision, not implementation.** The decision: automatic retry across owner recovery stays DISABLED in v1; durable action-id persistence is deferred until someone actually wants auto-retry. Edit the spec scenario ("Accepted action may be retried after owner recovery...") to state the shipped behavior plainly: after owner recovery, non-owner surfaces surface a retryable error to the user; they do not auto-retry. Move task 3.4 to the Deferred section with the decision recorded. (A test asserting auto-retry is absent belongs to WP7.)
3. **Narrow the TUI-follower requirement.** Task 5.3 (TUI tailing of GUI-owned sessions) is unimplemented; the design says the spec must be narrowed to the supported topology. Edit the `local-session-coordination` spec's GUI-owned-topology scenario to what is actually supported today (verify in code: the TUI can open the session after the GUI releases it / can it read while GUI owns it? — read `src/pi/session-writer-lock.ts` follower behavior and state exactly that). Keep live TUI tailing as an explicit deferred follow-up bullet.
4. Leave tasks 1.8, 5.4, 6.4 unchecked. Add a pointer note on 6.4: "Verification owned by WP7 of docs/internal/openspec-backlog-cleanup-plan.md; this change must not be archived until WP7 lands."
5. Validate strictly. Do not archive (WP7 does).

---

## WP6 — Rewrite the `forget-command` spec (no implementation)

Replace the current underspecified spec with the following decided semantics. Rewrite `proposal.md` and `specs/intent-routing/spec.md` (and add a new capability spec `specs/conversation-privacy/spec.md` if validation prefers a dedicated capability — your call, keep it consistent with how other changes structure deltas). Regenerate `tasks.md` to match. All decisions below are final (product owner confirmed P1/P2 above; the rest were made by the architecture review).

### Decided semantics

**Command:** `/forget <topic>` where topic is a ticker, phrase, or free text.

**Matching rules (deterministic, testable):**
- Normalize the topic: trim, casefold, strip a leading `$`.
- **Ticker mode** (topic matches `^[A-Za-z]{1,5}$` after stripping `$`): match on word-boundary occurrences, case-insensitive, of the bare symbol or `$SYMBOL` cashtag. `/forget ASTS` matches "ASTS", "$asts", "asts calls" — but NOT "blasts" (word boundary) and NOT company-name aliases ("AST SpaceMobile" is NOT matched in v1; document this limitation in the spec).
- **Phrase mode** (anything else): case-insensitive substring match on the normalized phrase.
- The spec MUST include a decision table of at least these cases as scenarios: `ASTS` vs "blasts off" (no match), `$IV` vs "implied volatility (IV)" (matches the parenthesized IV token — word boundary — document that acronym collisions are user's responsibility), phrase with punctuation, phrase spanning a markdown code span.

**Storage — the forget list (durable):**
- New SQLite table in the memory database, e.g. `forget_entries(id, kind TEXT CHECK(kind IN ('ticker','phrase')), pattern TEXT, created_at)`. This is a schema bump (repo is at v8 → this is v9). The spec MUST require: additive migration, a migration test upgrading a real v8 fixture database, and no data loss. Per AGENTS.md, memory schema changes are ask-first: the proposal itself constitutes the ask; the PR description must link it.
- The forget list persists across sessions and processes (it must affect future router turns in any session).

**Suppression surfaces (all four, each with its own requirement + scenario):**
1. **priorTurns:** `buildPriorTurns` in `src/runtime/session-coordinator.ts` excludes any turn whose text matches an active forget entry (whole-turn exclusion, not masking — simpler and safer; spec this explicitly).
2. **Structured memory:** matching preference/memory rows are excluded from prompt-context assembly and memory retrieval. Rows are NOT deleted (consistent with P1's non-destructive posture); they are filtered at read time by the same matcher. Scenario: a saved preference mentioning the ticker no longer appears in the rendered prompt context.
3. **Saved market-state summaries:** the prompt-context builder that summarizes watchlists/portfolios/alerts/reports excludes entries for a forgotten ticker (P1: rows stay in SQLite and in the GUI; only the AI-visible summary is filtered). Scenario: with ASTS in the watchlist and ASTS forgotten, the serialized prompt context contains no "ASTS".
4. **Compaction/branch summaries:** if a Pi compaction summary entry's text matches, that summary is excluded from priorTurns derivation the same as a normal turn. (Deleting/regenerating compaction summaries is out of scope; excluding them is sufficient for the router surface.)

**Explicit non-goals / documented limitations (from P1, P2):**
- No deletion of watchlist/portfolio/alert rows.
- No transcript redaction: GUI and TUI continue to display historical turns containing the topic. State this verbatim as a limitation with transcript redaction listed as a possible follow-up change.
- No provider-side or model-side deletion implied.
- Forgetting does not prevent the user from re-introducing the topic; a new mention in a future turn is fresh context (the forget list filters HISTORY, not the live turn — spec this explicitly, it's the most likely implementer confusion).

**Confirmation contract:** on success, the session shows a confirmation that states the KIND and COUNT of suppressed items (e.g. "Forgotten: 1 ticker pattern. 3 prior turns and 1 saved preference will no longer be shared with the model.") and MUST NOT echo the matched text or the topic itself beyond the user's own typed command. `/forget` with no argument lists active forget entries (patterns are shown here — the user typed them — with a count of what each suppresses).

**Undo:** `/forget --remove <topic>` deletes the forget entry (decided — no new top-level command; `/remember` is rejected to keep the command surface small). Spec one requirement + scenario.

**Verification requirements to encode in tasks.md:**
- Unit tests for the matcher decision table.
- Migration test v8 → v9 on a fixture database.
- Extension-level test: after `/forget`, the serialized router prompt for the next turn contains no match (assert on the actual prompt string, not on intermediate structures).
- Harness e2e (uses the multi-prompt harness capability from improvements item I1): turn 1 mentions topic, turn 2 `/forget`, turn 3 unrelated question → `trace.json` router input clean.
- The eval case in improvements plan item I5/E4.

Keep implementation out: this WP delivers only the rewritten change directory, validated strictly.

---

## WP7 — Coordinator verification tests + archive `transparent-local-session-coordinator`

**The only package in this plan that writes code — test code only, no production changes.** Depends on WP5 (spec closeout merged into the integration branch). If any test below reveals a real defect in lock/coordinator behavior, that is a FINDING to report in the PR — do NOT change production code, constants, or grace windows to make tests pass.

1. **1.8 test — long stream survives stale grace.** Deterministic-timer test (the repo recently fixed a Node 24 flake by moving session-entry wait tests to fake timers — follow that pattern; no real sleeps): a writer holds the lock and its heartbeats stall past `DEFAULT_STALE_GRACE_MS` while the owning process is still alive (matching PID + process-identity discriminator); assert a second process treats the session as temporarily unreachable and does NOT steal the lock. Then simulate true death (PID gone / identity mismatch) and assert recovery proceeds. Place alongside the existing `session-writer-lock` tests.
2. **Auto-retry-disabled pinning test.** Per WP5's 3.4 decision: after simulated owner recovery, a previously-accepted action is NOT automatically resubmitted; the non-owner surface exposes a retryable error instead. Place with the `local-session-coordinator` tests under `tests/unit/gui-server/`.
3. **5.4 convergence smoke.** Scripted flow for the WP5-narrowed topology: GUI server owns a session, a prompt is sent via the coordinator path, then the TUI-side reader accesses the same session and the transcripts converge. Automate what is automatable (server + HTTP + reading the session file); if a step genuinely requires a human at the TUI, document that step precisely in the change's tasks.md and commit the run log as evidence under `docs/internal/pr-evidence/openspec-wp7/`.
4. **Close out and archive.** Check off tasks 1.8, 5.4, and 6.4 in the change's tasks.md with pointers to the tests/evidence. Run `openspec validate --strict`, then archive the change. (Its deltas were already reconciled by WP5, so archival is safe.)

**Likely wrong:** real-time sleeps; "verifying" 1.8 by shortening the grace window in the test setup below the production constant; a smoke whose "second process" is the same process; checking off 6.4 without the smoke evidence committed.

---

## Order, PRs, and reporting

| PR | Package | Risk | Depends on |
|----|---------|------|------------|
| 1 | WP1 archive finished changes | none | — |
| 2 | WP2 production-router re-baseline | low (spec text) | WP1 (baseline specs settled) |
| 3 | WP3 refine-gui archive | low | — |
| 4 | WP4 gui-concurrent re-baseline + slim change | medium (delta rewriting) | WP1 |
| 5 | WP5 coordinator spec closeout | low | — |
| 6 | WP6 forget-command spec rewrite | medium (new spec authoring) | WP1 (router-context archived; its spec statements about /forget become baseline) |
| 7 | WP7 coordinator verification tests + archive | medium (test code) | WP5 |

Each PR description must state: what was archived/edited, the `openspec validate --strict` output, and — for WP2 — the two evidence files cited in the design addendum.

**End state after the integration branch merges to `main`:** six of the seven previously-active changes are archived (`consolidate-public-site-design-system`, `router-context-and-observability`, `production-router-and-tool-hardening`, `refine-gui-market-state-ux`, `gui-concurrent-session-runtime`, `transparent-local-session-coordinator`). Exactly **two** active changes remain, both intentionally kept: `forget-command` (rewritten by WP6) and `gui-session-scoped-action-cleanup` (newly created by WP4.2). Their implementations are improvements-plan items I4 and I7, whose completing PRs archive them — taking the active backlog to zero.

**What you are likely to get wrong (checked by the reviewer):**
- Letting stale deltas reach `openspec/specs/` during archival (WP2/WP3/WP4 exist to prevent exactly this — re-read rule 4).
- "Fixing" checked/unchecked task states to look tidy instead of recording the truth with dated notes.
- Writing WP6 semantics that drift from the decided ones above (especially: deleting instead of filtering; masking instead of whole-turn exclusion; matching the live turn instead of history only).
- Re-litigating the router gate in WP2: the package cross-references existing recorded evidence; it does not run new evals, "fix" recorded numbers, or reopen the gate decision.
