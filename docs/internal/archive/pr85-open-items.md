> NOTE (2026-07-04): moved from `docs/internal/pr-evidence/` when that tree
> was pruned from git (26 MB of point-in-time run artifacts). Sibling artifact
> paths referenced below (logs, traces, screenshots) no longer exist in the
> repo; their contents are summarized in the surrounding text.

# PR #85 Open Items Triage

Date: 2026-07-04
Branch: `feat/pr85-open-items`
Workspace: `/Users/kahtaf/Documents/workspace/oc-pr85-open-items`

Scope excludes the `/analyze opencandle-workflow` item and the current-output
validation review comment.

## Summary

| Item | Status | PR #85 action |
| --- | --- | --- |
| Gemini exact-contract rate is 87.5% on widened contract | Pragmatically closable as documented residuals | Do not edit prompts or add broad product work. The hard invariant, zero route-kind flips across repeated Gemini runs, holds. Residual exact diffs are stable same-route-kind carryover/preference omissions documented in `docs/internal/archive/router-gemini-triage-table.md`. |
| E7 full live competitive run | Blocked by judge/OpenCandle model auth plus Claude acpx quota | The competitive baseline agents are driven by `acpx`; the captured frozen-run failure happened before those baselines, while resolving the shared judge/OpenCandle model through Pi `AuthStorage`/`ModelRegistry`. A direct Claude acpx preflight now reaches Claude but fails on the account monthly spend limit. |
| Real two-session concurrency evidence | Closed | Existing browser artifact proves two session/action IDs, concurrent sends, and targeted stop. Re-ran the focused browser test locally with the GUI server. |
| Claude-family router baseline pending Pi-auth model resolution | Blocked for credentialed baseline; non-credentialed script output captured | Pi auth has no Anthropic auth. `eval:router-live` can produce a fast fallback-shaped 4/32 result, but that is not acceptable as a credentialed Claude-family baseline. |

## Evidence Added In This Folder

- `gui-server.log`: local GUI server startup for the focused browser run.
- `gui-concurrency-focused.log`: `npm run test:gui:browser -- -t "drives two routed sessions concurrently"` passed once the GUI server was running.
- `competitive-focused-vitest.log`: competitive eval unit coverage passed, 33 tests.
- `router-focused-vitest.log`: router unit/fixture coverage passed, 151 tests.
- `frozen-competitive-live.log`: E7 frozen competitive live attempt failed before model calls with `No API key available for google/gemini-2.5-flash`.
- `acpx-claude-preflight.log`: direct Claude acpx preflight reached Claude but failed on the account monthly spend limit.
- `pi-auth-probe.log`: Pi `AuthStorage`/`ModelRegistry` reports no Google or Anthropic auth in this environment.
- `router-live-claude-pi-auth-attempt.log`: Claude-family router eval attempt exited nonzero at 4/32 exact; treat as non-credentialed/fallback-shaped evidence, not a valid baseline.

## Real Two-Session Concurrency

This item can be closed for PR #85.

Existing runtime evidence:

- `docs/internal/pr-evidence/feat-gui-session-scoped-actions/browser-concurrent-stop-log.json`
- `docs/internal/pr-evidence/feat-gui-session-scoped-actions/browser-desktop-1440x960-session-a-stopped.png`
- `docs/internal/pr-evidence/feat-gui-session-scoped-actions/browser-desktop-1440x960-session-b-complete.png`
- `docs/internal/pr-evidence/feat-gui-session-scoped-actions/browser-mobile-390x844-session-a-stopped.png`
- `docs/internal/pr-evidence/feat-gui-session-scoped-actions/browser-mobile-390x844-session-b-complete.png`

The JSON artifact was generated at `2026-07-04T03:34:39.064Z` and contains two
viewport runs:

- Desktop: `desktop-1440x960-session-a` used action
  `chat-daabb05d-9c83-49de-afa3-0df0fad562c8` and was aborted; concurrent
  `desktop-1440x960-session-b` used action
  `chat-4449f59e-be5f-41f5-bad9-641084deed3b` and was not aborted.
- Mobile: `mobile-390x844-session-a` used action
  `chat-ad42719e-ab4b-43a9-8c50-194a81a03bc5` and was aborted; concurrent
  `mobile-390x844-session-b` used action
  `chat-a60e57ea-6205-4fe0-a582-3cf86e11b016` and was not aborted.

Focused rerun:

```bash
npm run gui
npm run test:gui:browser -- -t "drives two routed sessions concurrently"
```

Result: passed, 1 test passed / 24 skipped.

## Gemini 87.5% Widened Contract

This item is pragmatically closable without prompt changes.

The reviewer-restored widened contract made the 32-fixture runs stricter than
the earlier 26-fixture narrow-contract gate. The two post-fix widened runs are
both 28/32 exact, passRate 0.875, with zero route-kind flips. The residuals are
stable and same-route-kind:

- `012`: Gemini sometimes omits the `asset_scope` slot/preference entirely. A
  deterministic writer was rejected because false-positive preference writes
  are worse than a missed preference write.
- `018`/`030`: prior-turn/saved-state symbol carryover into entities.
- `031`: prior-turn share quantity plus strategy slot inference.

No production prompt edits are justified by this open item. Raising exactness
above 87.5% on the widened contract would require either a broader product
decision about carryover/preference writing or more model-specific prompt work,
both outside this triage scope.

Focused checks:

```bash
npx vitest run tests/unit/routing/router.test.ts tests/unit/routing/router-fixtures.test.ts
```

Result: passed, 151 tests.

## E7 Frozen Competitive Live Run

This remains blocked by judge/OpenCandle model auth plus Claude acpx quota in
this workspace.

The competitive baseline agents themselves are driven through `acpx`:

- Claude: `acpx` with `claude-agent-acp`
- Codex: `acpx codex`
- Gemini: `acpx gemini`

The captured frozen-run failure occurred before any of those baseline agents
were run. The startup path first resolves `judgeModel` through Pi
`AuthStorage`/`ModelRegistry` so it can generate prompts, judge comparisons,
and run OpenCandle's own live model path. That path is separate from the acpx
competitor baselines.

Attempt:

```bash
set -a; source .env; set +a
export GOOGLE_API_KEY="${GOOGLE_API_KEY:-${GEMINI_API_KEY:-}}"
npm run test:evals:competitive:frozen
```

Result: failed before model calls:

```text
Error: No API key available for google/gemini-2.5-flash.
Set OPENCANDLE_COMPETITIVE_PROVIDER and OPENCANDLE_COMPETITIVE_MODEL, plus the matching API key, or configure a model through the OpenCandle/Pi setup flow.
```

Direct Claude acpx preflight:

```bash
tmpdir=$(mktemp -d /tmp/oc-acpx-claude-preflight.XXXXXX)
printf 'Reply exactly: OK' | node_modules/.bin/acpx \
  --cwd "$tmpdir" \
  --format quiet \
  --deny-all \
  --non-interactive-permissions fail \
  --allowed-tools "" \
  --timeout 60 \
  --agent "$PWD/node_modules/.bin/claude-agent-acp" \
  exec
code=$?
rm -rf "$tmpdir"
exit $code
```

Result: `acpx` reached Claude, then failed with the account-side quota error:

```text
Internal error: You've hit your monthly spend limit · raise it at claude.ai/settings/usage
```

Rerun note: once Claude quota clears, no acpx-specific code change is required
for the Claude competitive baseline. The run still needs a configured
judge/OpenCandle model path, such as Pi auth for the selected
`OPENCANDLE_COMPETITIVE_PROVIDER`/`OPENCANDLE_COMPETITIVE_MODEL`.

Pi auth probe:

```bash
npx tsx - <<'TS'
import { AuthStorage, ModelRegistry } from '@earendil-works/pi-coding-agent';
import { registerBuiltInApiProviders, getModel } from '@earendil-works/pi-ai/compat';
registerBuiltInApiProviders();
const auth = new AuthStorage();
const registry = new ModelRegistry(auth);
console.log('has google auth', auth.hasAuth('google'));
console.log('has anthropic auth', auth.hasAuth('anthropic'));
for (const [p,m] of [['google','gemini-2.5-flash'], ['anthropic','claude-haiku-4-5']] as const) {
  const model = getModel(p as any, m as any) as any;
  const res = await registry.getApiKeyAndHeaders(model);
  console.log(`${p}/${m}`, res.ok ? (res.apiKey ? 'api-key' : 'no-api-key') : `error:${res.error}`);
}
TS
```

Result:

```text
has google auth false
has anthropic auth false
google/gemini-2.5-flash no-api-key
anthropic/claude-haiku-4-5 no-api-key
```

Focused non-live checks:

```bash
npx vitest run tests/unit/evals/competitive-finance.test.ts tests/unit/evals/competitive-finance-planning.test.ts
```

Result: passed, 33 tests.

## Claude-Family Router Baseline

This remains blocked for a valid credentialed baseline.

Attempt:

```bash
set -a; source .env; set +a
OPENCANDLE_ROUTER_PROVIDER=anthropic OPENCANDLE_ROUTER_MODEL=claude-haiku-4-5 npm run eval:router-live
```

Observed result: nonzero, 4/32 exact, p50 1ms / p95 2ms. Because Pi
`AuthStorage` reports no Anthropic auth and the latencies are fallback-shaped,
this should not be treated as a valid live Claude-family model baseline. It is
kept as evidence of the current blocker and failure mode.

Exact blocker: configure Anthropic/Claude auth in Pi's production auth storage
(`~/.pi/agent/`) or add the planned Pi-auth model-resolution path to the router
eval script. Do not use `acpx` for this baseline; it drives a full agent CLI,
not the router prompt-to-JSON `completeSimple` path.

## E7 Frozen Competitive Live Runs (2026-07-04, feat/high-leverage-improvements)

The E7 blocker is resolved. Two full frozen runs completed end to end on this
machine with `.env`-only credentials (no Pi AuthStorage auth). Claude acpx
quota had cleared, so the Claude baseline ran live in run 1.

Fixes landed before/between the runs (one commit each):

- `d6109fb` fix(evals): import completeSimple in frozen competitive eval
  script — the script used `completeSimple` without importing it and would
  have crashed at the first judge call; added a unit-level ts.Program
  typecheck guard (`tests/unit/evals/competitive-eval-script-typecheck.test.ts`)
  because `tsc --noEmit` excludes tests/.
- `9b43315` fix(evals): resolve competitive judge model from env api keys —
  Pi `ModelRegistry.getApiKeyAndHeaders` resolves AuthStorage credentials
  with `includeFallback: false`, so an exported/`.env` `GEMINI_API_KEY`
  never reached judge/OpenCandle model resolution (the previously captured
  "No API key available for google/gemini-2.5-flash" failure). The script
  now seeds the provider env key as a runtime AuthStorage override and
  re-resolves; the override also reaches the OpenCandle session runner.
  Production auth paths unchanged.
- `cf6978b` fix(evals): update default Codex baseline model to advertised
  id — the codex ACP agent advertises `gpt-5.3-codex-spark` (plus gpt-5.5,
  gpt-5.4, gpt-5.4-mini); the old `gpt-5.3-codex-spark[medium]` default was
  rejected at preflight ("did not advertise that model").
- `6e17cd8` fix(routing): explicit week-range DTE outranks catalyst
  event-week inference — root cause of the run-1 hard-assertion failure
  "preserves requested 1-2 week DTE" (see below).
- `f09f733` fix(evals): skip failed baseline answers in competitive cache
  reuse — cached failure placeholders (answers with `error` set) are no
  longer reusable as baseline answers in later runs.

### Run 1 (live baselines): 2026-07-04T15-14-09-510Z

- Report: `tests/evals/runs/2026-07-04T15-14-09-510Z_competitive-finance.json`
- Analysis: `tests/evals/runs/2026-07-04T15-14-09-510Z_competitive-finance-analysis.md`
- Baselines: Claude live (all 5 prompts), Codex live (all 5,
  `gpt-5.3-codex-spark`), Gemini skipped at preflight ("Failed to spawn
  agent command: gemini --acp --skip-trust" — gemini CLI not installed) and
  recorded in `skippedCompetitors`.
- Judge: google/gemini-2.5-flash. All verdicts valid winners with 0-10
  scores and rubric-shaped reasons.
- Per-prompt winners:
  - frozen-portfolio-review-not-builder: opencandle 9 vs claude 7 / codex 6
  - frozen-covered-call-dte-preservation: opencandle 8 vs claude 5 / codex 4
  - frozen-protective-put-not-bullish-call: opencandle 9 vs claude 6 / codex 5
  - frozen-unknown-ticker-no-dead-end: opencandle 9 vs claude 6 / codex 5
  - frozen-hedge-sizing-with-share-count: claude 9 vs oc 6 / codex 8
- Summary: OC 4 wins, Claude 1 win, 0 ties. Exit code 1 (correct: 2
  deterministic hard-assertion failures).
- Hard assertions: 16 evaluated, 14 PASS, 2 FAIL, no "No deterministic
  checker registered" gaps:
  - FAIL "starts with a bottom-line structural portfolio read" — the answer
    led with "Critical Evaluation ... Structural Allocation Read" but never
    used the literal "bottom line". Answer-contract/prompt layer; not fixed
    here (prompt edits out of scope for this pass).
  - FAIL "preserves requested 1-2 week DTE" — genuine product regression
    caught exactly as designed: the judge scored OC the winner (8 vs 5)
    while the deterministic check flagged that the analysis ran on an
    event-week 0-7 day horizon. Root cause: `extractDteHint` matched the
    "earnings ... today" catalyst pattern before the user's explicit
    "1-2 weeks out" range; the router's held-symbol correction then
    overwrote the model's correct `1-2 weeks` entity hint with that
    extraction (router slots showed `dte_target: 7_to_14_days` while
    `entities.dteHint` was `event_week`, and workflow dispatch re-derives
    from entities). Fixed in `6e17cd8` at the entity-extraction layer.

### Run 2 (cached baselines, after fixes): 2026-07-04T15-34-49-833Z

- Report: `tests/evals/runs/2026-07-04T15-34-49-833Z_competitive-finance.json`
- Baselines: Claude and Codex answers reused from run 1's report with
  honest `[cached from ...]` labels; only Gemini needed preflight (no cached
  answers) and was skipped again. No live baseline calls.
- Per-prompt winners:
  - frozen-portfolio-review-not-builder: claude 9 vs oc 6 / codex 7
  - frozen-covered-call-dte-preservation: opencandle 9 vs claude 6 / codex 5
  - frozen-protective-put-not-bullish-call: opencandle 9 vs claude 6 / codex 6
  - frozen-unknown-ticker-no-dead-end: opencandle 9 vs claude 7 / codex 6
  - frozen-hedge-sizing-with-share-count: claude 9 vs oc 6 / codex 8
- Summary: OC 3 wins, Claude 2 wins, 0 ties. Exit code 1 (correct: 1
  deterministic hard-assertion failure remaining).
- Hard assertions: 15 of 16 PASS. "preserves requested 1-2 week DTE" now
  PASSES live, verifying `6e17cd8` end to end. The only remaining FAIL is
  the "bottom line" literal on the portfolio-review prompt (answer-contract
  layer, open).

### Residual observations (not fixed, with reasons)

- "starts with a bottom-line structural portfolio read" fails when the
  answer opens with an equivalent structural read without the literal
  phrase "bottom line". Fixing the answer shape is prompt work (out of
  scope); loosening the checker to pass the run would defeat the gate.
  Leave to a deliberate answer-contract decision.
- Judge fairness: the judge model (google/gemini-2.5-flash) is also the
  OpenCandle session model, and would share a family with the Gemini
  baseline if it ever runs. Same-family judge/contestant bias is untracked.
- Judge variance: prompt 1 flipped opencandle(9-7) -> claude(9-6) between
  runs against the *same cached Claude answer* (OpenCandle's live answer
  differed). Single-run win counts on the frozen panel are noisy; the
  deterministic hard assertions are the stable signal.
- Cached answers have no as-of/staleness gating: `findCachedCompetitorAnswer`
  matches on prompt text + competitor id only, so a weeks-old cached answer
  would silently compete against a fresh OpenCandle answer. Acceptable for
  same-day reruns; worth an age guard later.
- `tests/scripts/run-main-branch-product-replay.ts` has 3 pre-existing type
  errors (TS2740/TS2322) visible under the same ts.Program check; out of
  scope here, not covered by the new typecheck guard (which is scoped to
  the competitive script).

### Frozen-run log tails

Run 1 (`/tmp/frozen-run.log`):

```text
--- Competitive Finance Summary ---
OpenCandle wins: 4
Claude wins: 1
Codex wins: 0
Gemini wins: 0
Ties: 0
Report: tests/evals/runs/2026-07-04T15-14-09-510Z_competitive-finance.json
Analysis: tests/evals/runs/2026-07-04T15-14-09-510Z_competitive-finance-analysis.md

Frozen panel FAILED 2 deterministic hard assertion(s):
- starts with a bottom-line structural portfolio read: expected final answer to include: /bottom line/, /portfolio/, /risk|reward|structural/
- preserves requested 1-2 week DTE: expected final answer to include: /1\s*[-–]\s*2|one\s+to\s+two|two[- ]week|weekly/, /dte|expiry|expiration/
FROZEN RUN EXIT: 1
```

Run 2 (`/tmp/frozen-run2.log`):

```text
--- Competitive Finance Summary ---
OpenCandle wins: 3
Claude wins: 2
Codex wins: 0
Gemini wins: 0
Ties: 0
Report: tests/evals/runs/2026-07-04T15-34-49-833Z_competitive-finance.json
Analysis: tests/evals/runs/2026-07-04T15-34-49-833Z_competitive-finance-analysis.md

Frozen panel FAILED 1 deterministic hard assertion(s):
- starts with a bottom-line structural portfolio read: expected final answer to include: /bottom line/, /portfolio/, /risk|reward|structural/
FROZEN RUN EXIT: 1
```
