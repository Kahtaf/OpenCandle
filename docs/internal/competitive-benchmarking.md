# Competitive Benchmarking

Use this loop when checking whether OpenCandle beats generic no-tool agents on investor prompts.

## What This Measures

Competitive evals should focus on prompts where OpenCandle has a structural advantage:

- fresh market data
- exact SEC/EDGAR evidence
- live options chains and Greeks
- computed backtests
- macro data plus current market-implied pricing
- portfolio risk and correlation checks

Generic agents may produce useful frameworks, so the eval should not only ask whether OpenCandle writes a plausible answer. It should check whether OpenCandle routes to the right workflow, calls the tools that generic agents cannot call, preserves user constraints, and surfaces concrete evidence.

## Where Cases Live

Reusable competitive prompts live in `tests/evals/competitive-finance-cases.ts`.

Each case includes:

- `prompt`: the user prompt
- `assertions`: existing OpenCandle eval assertions for workflow, tools, args, and response requirements
- `competitive.genericAgentLimitation`: what a generic no-tool agent cannot verify
- `competitive.openCandleAdvantage`: the concrete advantage OpenCandle should demonstrate
- `competitive.evidenceExpectation`: what the answer must show to count as useful

## Running The Loop

Run only the competitive suite:

```bash
npm run test:evals:competitive
```

The normal `npm test` run validates that competitive cases are well-formed, but it does not execute the expensive agent loop. The competitive suite is intentionally separate from `npm run test:evals:usually` because live agent runs are slower and should execute serially.

## Adding Cases

Add new prompts to `competitiveFinanceCases`. Prefer prompts that are harder than simple routing checks and require current evidence. For each case, include at least:

- expected workflow
- required tools
- optional response requirements when the evidence is stable enough to assert
- metadata describing the generic-agent limitation and OpenCandle advantage

Do not commit one-off run transcripts, screenshots, or dated competitive evidence unless they are needed to explain a bug. The durable artifact should be the reusable eval case.
