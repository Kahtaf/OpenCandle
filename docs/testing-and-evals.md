---
title: Testing and Evals
description: How OpenCandle validates tools, workflows, GUI behavior, and full agent runs.
---

# Testing and Evals

OpenCandle has four validation layers:

- deterministic unit tests for pure logic, request-understanding fixtures, providers with mocked fetch, and GUI state helpers
- focused end-to-end tests for CLI, credential flows, and live provider/tool behavior
- browser smoke tests for the local GUI
- evals that run full OpenCandle sessions through the shared agent harness and score product behavior, task selection, evidence use, or competitive performance

## Baseline Checks

Run these before treating a checkout as healthy:

```bash
npm test
npm run gui:web:build
npm run docs:site:build
```

`npm test` runs the [Vitest](https://vitest.dev) suite. Unit tests should be fixture-backed and should not call live APIs.

For release-facing changes, run the same local gate that release and publish paths use:

```bash
npm run release:check
```

That command runs typecheck, Biome CI, unit tests, docs build, package-content validation, packed-install smoke, and public-doc link checks.

## First-Run Release Smoke

Before a public release or broad announcement, exercise the fresh-user path separately from default CI:

1. Set a fresh `OPENCANDLE_HOME`.
2. Start `opencandle` and complete terminal model setup, including sign-in if that path is part of the release claim.
3. Start `opencandle gui`, open the browser, and verify the model setup state is ready or complete API-key setup in the panel.
4. Ask one keyless prompt such as `What is AAPL trading at?`.
5. If release scope touched providers, run one provider-backed prompt with available credentials.

Do not commit generated traces or local market-state files from this smoke.

## End-to-End Tool Tests

```bash
npm run test:e2e
npm run test:e2e:cli
npm run test:e2e:credential-prompt
npm run test:e2e:credential-snooze
npm run test:e2e:credential-soft-fallback
npm run test:e2e:credential-per-workflow-cap
```

`npm run test:e2e` intentionally hits live APIs through focused tool checks. The provider matrix is broader and also live:

```bash
npm run test:e2e:providers
```

Only run these when live network/API behavior is part of the validation goal.

## Eval Commands

OpenCandle separates deterministic tests from opt-in evals because evals may depend on model credentials, live data, local agent CLIs, or longer-running traces.

```bash
npm run eval
npm run eval -- <suite> [options]
npm run eval -- release
```

`npm run eval` lists the available suites and the env flags the front door can set. Before each run, the front door prints the delegated command plus the env flags it resolved, then appends a JSONL record to `tests/evals/runs/index.jsonl` after completion.

| Suite | Delegates to | Key options |
|-------|--------------|-------------|
| `cases` | `vitest run --config vitest.config.evals.ts` | `--tier usually`, `--known-fail e1`, `--known-fail e2` |
| `product` | `tests/scripts/run-product-evals.ts` | `--case <id>`, `--family <name>`, `--include-opt-in`, `--limit <n>` |
| `competitive` | `tests/scripts/run-competitive-finance-eval.ts` | `--provider <id>`, `--model <id>`, `--count <n>`, `--seed <seed>` |
| `competitive:frozen` | `tests/scripts/run-competitive-finance-eval.ts` with `OPENCANDLE_COMPETITIVE_PANEL=frozen` | `--provider <id>`, `--model <id>` |
| `competitive:analyze` | `tests/scripts/analyze-competitive-finance-report.ts` | optional report path |
| `router-live` | `tests/scripts/run-live-router-eval.ts` | `--provider <id>`, `--model <id>` |
| `replay:product` | `tests/scripts/run-main-branch-product-replay.ts` | `--base-ref <ref>` |
| `replay:competitive` | `tests/scripts/run-main-branch-competitive-replay.ts` | forwards `--current-report`, `--base-report`, `--unsupported-base-reason`, `--current-ref`, `--base-ref` |
| `scorecard` | `tests/scripts/build-oc-superiority-scorecard.ts` | forwards `--product-replay`, `--competitive-replay`, `--prompt-policy` |
| `prompt-policy` | `tests/scripts/run-prompt-policy-manifest.ts` | `--ids <csv>`, `--limit <n>`, `--strict` |
| `prompt-policy:parity` | `tests/scripts/run-prompt-policy-ref-parity.ts` | `--base-ref <ref>`, `--current-ref <ref>` |
| `release` | `router-live`, `cases`, `product`, `competitive:frozen` | continues past failures and exits non-zero if any suite fails |

Legacy npm script names still work and route through the same front door:

```bash
npm run test:evals
npm run test:evals:usually
npm run eval:router-live
npm run test:evals:product
npm run test:evals:competitive
npm run test:evals:competitive:frozen
npm run eval:competitive:analyze
```

For release preparation, run the full manual eval cadence:

```bash
npm run eval -- release
```

This gate is deliberately not part of `release:check` or CI because it requires live credentials and can run external agent baselines.

Eval reports are written under `tests/evals/runs/` when a runner produces a JSON report. The front-door index at `tests/evals/runs/index.jsonl` records suite id, timestamps, exit code, argv, and report paths. Treat those run files as local evidence, not committed documentation.

## Product Evals

Product evals run curated prompts through `runOpenCandleSession()` and score the resulting trace for investigation fit, tool usage, directness, evidence use, risk framing, horizon fit, and honest handling of missing data.

Prompt families currently include:

- `single_asset`
- `compare_assets`
- `portfolio`
- `options`
- `sentiment`
- `macro`
- `education`

Run all product evals:

```bash
npm run eval -- product
```

Useful environment variables:

- `PRODUCT_EVAL_CASE`: run one case by id, such as `compare-assets-aapl-msft-6mo`.
- `PRODUCT_EVAL_FAMILY`: run one family, such as `portfolio` or `macro`.
- `PRODUCT_EVAL_LIMIT`: run only the first N selected cases.

Example:

```bash
npm run eval -- product --family options --limit 1
```

Each run writes a timestamped `*_product-evals.json` report under `tests/evals/runs/`.

## Competitive Benchmarking

The competitive benchmark answers a product question: when does a finance-native agent with market tools and traceable evidence produce a more useful answer than a generic agent answering without tools? It is not meant to prove OpenCandle always wins — generic agents can be stronger on concise education or clean synthesis when live data is unnecessary, and those losses are useful signal.

Expect live model/API usage and multi-minute runs. OpenCandle needs model credentials for its own run. Claude, Codex, and Gemini baselines run as generic no-tool agents through `acpx`, an [Agent Client Protocol](https://agentclientprotocol.com) runner bundled in the repo; unavailable baselines are recorded as skipped unless `OPENCANDLE_COMPETITIVE_REQUIRE_ALL=1`.

```bash
npm run eval -- competitive
```

The runner generates (or accepts) finance prompts, runs each through OpenCandle and the baselines, judges usefulness, correctness, evidence, clarity, and uncertainty handling with a configured judge model, and writes a timestamped `*_competitive-finance.json` report under `tests/evals/runs/`.

For release preparation, rerun the frozen competitive panel:

```bash
npm run eval -- competitive:frozen
```

The frozen panel keeps generated prompt discovery separate from regression tracking. It covers portfolio-review-not-builder, requested DTE preservation, protective-put-not-bullish-call, unknown-ticker-no-dead-end, and hedge sizing with share count. Its hard assertions live in `docs/internal/prompt-to-policy-migration-manifest.json` so benchmark literals stay out of production prompts.

Useful knobs (all optional):

- `COMPETITIVE_PROMPT_COUNT` / `COMPETITIVE_PROMPT_SEED`: size and reproducibility of the generated prompt set.
- `OPENCANDLE_COMPETITIVE_PANEL=frozen`: rerun the fixed historical-loss panel instead of generating prompts.
- `OPENCANDLE_COMPETITIVE_PROMPT` (with `_ID`, `_TOPIC`, `_COMPLEXITY`, `_FOCUS`): pin one fixed prompt instead of generating.
- `OPENCANDLE_COMPETITIVE_PROVIDER` / `OPENCANDLE_COMPETITIVE_MODEL`: judge and prompt-generation model. Defaults prefer configured Google auth with `gemini-2.5-flash`, then the first configured model.
- `OPENCANDLE_COMPETITIVE_ACPX_COMMAND` and per-baseline `*_AGENT_COMMAND` / `*_MODEL` overrides, timeouts, and `OPENCANDLE_COMPETITIVE_PREFLIGHT=0` to skip baseline smoke calls.
- `OPENCANDLE_MANUAL_RUN_SETTLE_GRACE_MS`: legacy-named settle window used by the competitive eval runner when it calls the shared OpenCandle harness. The old manual-run harness is gone; this env var remains only to avoid renaming an established benchmark knob.

Do not commit raw transcripts or one-off run reports; treat run files as local evidence.

## GUI Browser Smoke

Run the GUI in one terminal:

```bash
npm run gui
```

Then run the browser smoke in another terminal:

```bash
npm run test:gui:browser
```

Set `OPENCANDLE_GUI_URL` to target a non-default local URL. GUI smoke testing should cover desktop and mobile widths when UI behavior changes.

For visual or GUI behavior changes, also build the web bundle:

```bash
npm --workspace @opencandle/gui-web run build
```

At minimum, exercise prompts that render stock quotes, quote comparison, options chains, SEC filings, macro/FRED data, and news/search so the matching tool cards and financial context panel render from saved session state.

## Agent Harness

The file-based harness lets another coding agent drive OpenCandle as a simulated user and inspect the resulting trace.

```bash
npx tsx tests/harness/cli.ts run --prompt "What is AAPL trading at?" --ipc /tmp/oc-test &
npx tsx tests/harness/cli.ts wait --ipc /tmp/oc-test
npx tsx tests/harness/cli.ts trace --ipc /tmp/oc-test
```

If the run asks a question:

```bash
npx tsx tests/harness/cli.ts answer --ipc /tmp/oc-test --value "Moderate"
```

The final `trace.json` includes tool calls, results, interactions, final text, duration, and OpenCandle custom entries such as workflow dispatch, request-understanding output, disclaimers, and degradation notes.

## Request-Understanding Fixtures

Request-understanding fixtures live in `tests/fixtures/router/` and are included in `npm test`.

Use them when changing:

- `src/routing/router-prompt.ts`
- `src/routing/router.ts`
- task-selection model choice
- multi-turn context handling
- preference extraction or slot resolution

The live fixture eval is opt-in:

```bash
npm run eval -- router-live
```

It uses `OPENCANDLE_ROUTER_PROVIDER` and `OPENCANDLE_ROUTER_MODEL` when set. Defaults are `anthropic` and `claude-haiku-4-5`, so it requires matching live model credentials unless you override those env vars.

Treat task-selection mismatches as regressions even when the aggregate pass rate looks acceptable.

## Test Data Rules

- Mock `globalThis.fetch` in unit tests.
- Store response fixtures under `tests/fixtures/<provider>/`.
- Do not commit real account balances, names, or exact holdings in fixtures.
- Preserve classification-relevant signal such as tickers, horizons, and risk phrasing.
- Keep live API checks out of the default unit test path.
