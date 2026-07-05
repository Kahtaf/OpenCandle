# Design — Eval Entry-Point Consolidation

Decisions are made; do not redesign.

## 1. Front door: `tests/scripts/run-evals.ts`

A dispatch table, not a framework. Each suite entry declares: `name`, `description`, the command to spawn (or module to import), which CLI options it accepts, and how options map to the existing env flags. The front door NEVER reimplements suite logic — it spawns/invokes the existing runners verbatim.

Suite table (exhaustive):

| Suite id | Delegates to | Notes |
|---|---|---|
| `cases` | `vitest run --config vitest.config.evals.ts` | `--tier usually` → `EVAL_TIER=usually`; `--known-fail e1\|e2` **implies `--tier usually`** (both known-fail cases are additionally gated on `EVAL_TIER=usually`): e1 → `EVAL_TIER=usually` + `OPENCANDLE_LIVE_MULTI_TURN_EVAL=1` + `OPENCANDLE_RUN_KNOWN_FAIL_EVALS=1`; e2 → `EVAL_TIER=usually` + `OPENCANDLE_EVAL_KNOWN_FAIL_E2=1` |
| `product` | `tsx tests/scripts/run-product-evals.ts` | `--case`, `--family`, `--include-opt-in`, `--limit` → `PRODUCT_EVAL_*` |
| `competitive` | `tsx tests/scripts/run-competitive-finance-eval.ts` | passes `OPENCANDLE_COMPETITIVE_*` through |
| `competitive:frozen` | same, with `OPENCANDLE_COMPETITIVE_PANEL=frozen` | |
| `competitive:analyze` | `tsx tests/scripts/analyze-competitive-finance-report.ts` | positional report path |
| `router-live` | `tsx tests/scripts/run-live-router-eval.ts` | `--provider`, `--model` → `OPENCANDLE_ROUTER_PROVIDER/MODEL` |
| `replay:product` | `tsx tests/scripts/run-main-branch-product-replay.ts` | `--base-ref` → `PRODUCT_REPLAY_BASE_REF` |
| `replay:competitive` | `tsx tests/scripts/run-main-branch-competitive-replay.ts` | pure argv passthrough, NO env mapping: requires `--current-report <path>` plus `--base-report <path>` OR `--unsupported-base-reason <reason>`; optional `--current-ref`/`--base-ref`. The front door forwards these verbatim and surfaces the script's usage error on missing args |
| `scorecard` | `tsx tests/scripts/build-oc-superiority-scorecard.ts` | forwards its existing `--product-replay/--competitive-replay/--prompt-policy` args |
| `prompt-policy` | `tsx tests/scripts/run-prompt-policy-manifest.ts` | `--ids`, `--limit`, `--strict` → `PROMPT_POLICY_*` |
| `prompt-policy:parity` | `tsx tests/scripts/run-prompt-policy-ref-parity.ts` | `--base-ref`, `--current-ref` |
| `release` | sequence: `router-live`, `cases` (default tier), `product`, `competitive:frozen` | continues past failures; prints an aggregate table; exit 1 if any failed |

Behavior:
- `npm run eval` with no args prints the suite table with one-line descriptions and each suite's key env flags.
- Before spawning, print the resolved command and every env flag it sets (auditability; no hidden state).
- After each run, append to `tests/evals/runs/index.jsonl`: `{suite, startedAt, finishedAt, exitCode, reports: [paths], argv}`. Report paths are discovered by diffing the `tests/evals/runs/` directory listing before/after the run (robust to the six existing filename suffixes without touching writers).
- Spawn with `stdio: "inherit"`; the front door adds no output buffering.

## 2. npm script rewiring (`package.json`)

- New: `"eval": "tsx tests/scripts/run-evals.ts"`, `"eval:release": "tsx tests/scripts/run-evals.ts release"`.
- Rewire as aliases (behavior-identical): `test:evals` → `... run-evals.ts cases`, `test:evals:usually` → `... cases --tier usually`, `test:evals:product` → `... product`, `test:evals:competitive` → `... competitive`, `test:evals:competitive:frozen` → `... competitive:frozen`, `eval:router-live` → `... router-live`, `eval:competitive:analyze` → `... competitive:analyze`.
- `release:check` is NOT modified.

## 3. Manual-run retirement

Order matters:
1. Migrate `tests/e2e/harness-dcf.test.ts` from `spawnSync(npx tsx tests/harness/manual-run.ts ...)` to the IPC harness: spawn `cli.ts run --prompt ... --ipc <tmpdir>`, poll `cli.ts wait`, read the trace via `cli.ts trace`. The two harnesses emit DIFFERENT trace shapes — rewrite the assertions to the `AgentTrace` fields with identical semantics: `trace.toolCalls.map(c => c.name)` → `trace.toolSequence` (or `turns[].toolCalls`), `trace.text` → `trace.finalText`. `customEntries` is the same field in both.
2. Migrate `tests/e2e/harness-custom-entries.test.ts` the same way; its assertions touch only `customEntries` and port directly.
3. Update the comment in `tests/e2e/credential-prompt.test.ts` that references manual-run defaults (comment-only).
4. Verify `OPENCANDLE_MANUAL_RUN_SETTLE_GRACE_MS` readers (`grep -rn`): after deletion the only reader is `run-competitive-finance-eval.ts` (which passes it into `runOpenCandleSession` options — the shared settle code itself never reads the env var); the flag name is grandfathered and documented as legacy in `docs/testing-and-evals.md`.
5. Update `tests/harness/README.md`: remove manual-run sections; point one-shot usage at `cli.ts`.
6. Delete `tests/harness/manual-run.ts`.
7. The `test-harness-observability` spec delta in this change makes the capture requirement runner-neutral (see spec file).

If step 1 or 2 reveals a capability `cli.ts` lacks (it should not — `cli.ts` already writes `customEntries` in traces), STOP and report rather than re-adding a bespoke runner.

## 4. Docs

- `docs/testing-and-evals.md`: replace the per-script instructions with the front-door table; keep a short "legacy script names still work" note.
- `tests/AGENTS.md`: add an `evals/` + `scripts/` section (structure, `npm run eval`, tier semantics, known-fail flag conventions, `// PROMOTE:` convention, runs index).
- The release checklist reference for the cadence: `eval:release` in `docs/testing-and-evals.md`'s release section.
