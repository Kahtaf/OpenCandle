# Tasks

Follow AGENTS.md (TDD, CHANGELOG, `graphify update .`). Memory-schema authorization is scoped to exactly the `analysis_reflections` table. Prompt integrity: reflection injection is an additive data block in prompt/context assembly only — no instruction edits anywhere. The two halves (ledger, daemon) are independent; implement as separate PRs if convenient.

## 1. Ledger schema (TDD)

- [ ] 1.1 Follow the EXISTING migration-test convention (`tests/unit/memory/sqlite.test.ts` constructs old-schema databases programmatically in temp dirs via SQL, then reopens with `initDatabase` — there are no committed binary fixture files; do not introduce one): build a seeded v8 database in a temp dir.
- [ ] 1.2 Failing migration test: programmatic v8 database → v9 keeps all rows; `analysis_reflections` exists with the spec's columns (no `invalidation_level`).
- [ ] 1.3 Implement: add the table to `CURRENT_SCHEMA` in `src/memory/sqlite.ts`, bump `CURRENT_SCHEMA_VERSION` to 9, add `migrateV8ToV9`, extend the cascade and `resetSchema`. Add a coordination note to `openspec/changes/forget-command/proposal.md` (its future migration is v9 → v10).

## 2. Reflection writes (TDD)

- [ ] 2.1 Failing unit tests: completed analysis with parsed steps + a matching `get_stock_quote` tool-result entry → full row; degraded run (`<2` parsed, no quote entry) → row with NULLs and `parsed_analyst_count`; price read from the session tool-result entry's full `details` (a >500-char result whose digest truncates `details` must still yield the price); symbol from `WorkflowDefinition.metadata.symbol`; no model call in the write path (assert by construction — the writer takes only already-captured data).
- [ ] 2.2 Implement: extend `WorkflowDefinition` with optional `metadata?: { symbol?: string }` set by `buildComprehensiveAnalysisDefinition`; `MemoryStorage.insertAnalysisReflection` (+ `listAnalysisReflections(symbol, limit)`); write from the synthesis-step completion branch in `SessionCoordinator.startWorkflowRun` (beside `emitSynthesisValidation`), gated on `workflowType === "comprehensive_analysis"`, session id from the coordinator's Pi session context there.

## 3. Reflection injection (TDD)

- [ ] 3.1 Failing unit tests: symbol with 4 reflections → block contains the most recent 3 with date/tally/price-then (price ALWAYS rendered with its date, per the selective-memory delta); zero reflections → no section or header anywhere in assembled context; pass-through turn → nothing; block is capped and data-only; note the memory-context section character budget — the block participates in it, it does not bypass it.
- [ ] 3.2 Implement in the prompt-context assembly path (`session-coordinator.ts` / `src/prompts/context-builder.ts`), gated by the same finance-turn gating as saved market-state context; inject for `comprehensive_analysis` dispatch and single-asset routed turns whose entities include the symbol.
- [ ] 3.3 Prompt snapshot check: existing prompt output snapshots change only by the additive data block for seeded-reflection cases; zero-reflection snapshots are byte-identical.

## 4. Daemon (TDD where testable; live evidence for the rest)

- [ ] 4.1 Failing unit tests for unit-file generation: plist and systemd unit contents invoke the monitor entry DIRECTLY (`process.execPath` + resolved `tsx/cli` + `<packageRoot>/src/monitor.ts` — never the `opencandle` CLI proxy) with paths resolved at install time (temp-dir generation, no system mutation in unit tests); Windows guidance path exits non-zero.
- [ ] 4.2 Implement `install|uninstall|status` intercepted in `src/cli-main.ts` BEFORE the existing tsx proxy spawn (the plain `monitor` command keeps its current behavior); create `~/.opencandle/logs/` with owner-only perms consistent with the hardened home-dir handling.
- [ ] 4.3 Doctor: add monitor-service state to the report (text + JSON) with remediation guidance; unit test with a stubbed status probe.
- [ ] 4.4 Live evidence (macOS, this machine): `install` → `status` running → log file receiving heartbeats → GUI open simultaneously without double-run (lease log excerpt) → `uninstall` clean. Paste excerpts into the PR.

## 5. Verification

- [ ] 5.1 Live ledger evidence: two `/analyze NVDA` runs via the harness; second run's trace shows the reflection data block with the first run's tally/price; a `/analyze TSLA` trace shows no reflection section.
- [ ] 5.2 `npm test`, `npx tsc --noEmit`, `npx biome ci .` green; CHANGELOG `[Unreleased]` entries (ledger; daemon; doctor).
- [ ] 5.3 `graphify update .`; `npx openspec validate close-the-loop --strict`.
