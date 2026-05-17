---
title: Testing and Evals
description: How OpenCandle validates tools, routing, GUI behavior, and full agent runs.
---

# Testing and Evals

OpenCandle has three validation layers: deterministic unit tests, focused end-to-end tests, and manual or live evals for behavior that depends on real providers or a model.

## Baseline Checks

Run these before treating a checkout as healthy:

```bash
npm test
npm run gui:web:build
npm run docs:site:build
```

`npm test` runs the Vitest suite. Unit tests should be fixture-backed and should not call live APIs.

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

The final `trace.json` includes tool calls, results, interactions, final text, duration, and OpenCandle custom entries such as workflow dispatch, router output, disclaimers, and degradation notes.

## Router Fixtures

Router fixtures live in `tests/fixtures/router/` and are included in `npm test`.

Use them when changing:

- `src/routing/router-prompt.ts`
- `src/routing/router.ts`
- router model choice
- multi-turn context handling
- preference extraction or slot resolution

The live router eval is opt-in:

```bash
npm run eval:router-live
```

Treat route mismatches as regressions even when the aggregate pass rate looks acceptable.

## Test Data Rules

- Mock `globalThis.fetch` in unit tests.
- Store response fixtures under `tests/fixtures/<provider>/`.
- Do not commit real account balances, names, or exact holdings in fixtures.
- Preserve classification-relevant signal such as tickers, horizons, and risk phrasing.
- Keep live API checks out of the default unit test path.
