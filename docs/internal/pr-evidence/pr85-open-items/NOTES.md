# PR #85 Open Items Triage

Date: 2026-07-04
Branch: `feat/pr85-open-items`
Workspace: `/Users/kahtaf/Documents/workspace/oc-pr85-open-items`

Scope excludes the `/analyze opencandle-workflow` item and the current-output
validation review comment.

## Summary

| Item | Status | PR #85 action |
| --- | --- | --- |
| Gemini exact-contract rate is 87.5% on widened contract | Pragmatically closable as documented residuals | Do not edit prompts or add broad product work. The hard invariant, zero route-kind flips across repeated Gemini runs, holds. Residual exact diffs are stable same-route-kind carryover/preference omissions documented in `docs/internal/pr-evidence/feat-router-gemini-contract/router-triage-table.md`. |
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
