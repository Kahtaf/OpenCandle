---
title: Benchmarking
description: How OpenCandle compares full finance-agent behavior against generic agents.
---

# Benchmarking

OpenCandle benchmark runs are designed to answer a product question: when does a finance-native agent with market tools, routing, workflows, and traceable evidence produce a more useful answer than a generic agent answering without tools?

The benchmark is not meant to prove OpenCandle always wins. Generic agents can be stronger on concise education, broad explanations, or clean synthesis when live data is unnecessary. OpenCandle should shine when the user benefits from finance-specific workflow selection, fresh market evidence, explicit tool traces, risk framing, and honest disclosure of missing data.

## Competitive Finance Benchmark

Before running this, expect live model/API usage, local baseline-agent requirements, and multi-minute runs. OpenCandle needs model credentials for its own run. The judge model uses `OPENCANDLE_COMPETITIVE_PROVIDER` and `OPENCANDLE_COMPETITIVE_MODEL` when set; otherwise it prefers configured Google auth with `gemini-2.5-flash`, then the first configured model. Claude, Codex, and Gemini baselines run through `acpx`; unavailable baselines are recorded as skipped unless `OPENCANDLE_COMPETITIVE_REQUIRE_ALL=1`.

Run:

```bash
npm run test:evals:competitive
```

The runner:

1. Generates or accepts finance prompts for the run date.
2. Runs each prompt through OpenCandle with the shared in-process harness.
3. Runs the same prompt through Claude, Codex, and Gemini as generic no-tool finance agents through `acpx`.
4. Uses a configured judge model to compare usefulness, correctness, evidence, clarity, and uncertainty handling.
5. Writes a timestamped `*_competitive-finance.json` report under `tests/evals/runs/`.

The committed docs should describe durable benchmark design and public summaries. Do not commit raw internal transcripts or one-off run reports.

## Useful Commands

Run the default generated prompt set:

```bash
npm run test:evals:competitive
```

Run a small generated set:

```bash
COMPETITIVE_PROMPT_COUNT=1 npm run test:evals:competitive
```

Rerun a fixed prompt after a product or harness change:

```bash
OPENCANDLE_COMPETITIVE_PROMPT_ID=fixed-rates-growth \
OPENCANDLE_COMPETITIVE_PROMPT_TOPIC=macro \
OPENCANDLE_COMPETITIVE_PROMPT_COMPLEXITY=complex \
OPENCANDLE_COMPETITIVE_PROMPT="How should falling rates affect growth stocks over the next year?" \
npm run test:evals:competitive
```

## Configuration

Prompt selection:

- `COMPETITIVE_PROMPT_COUNT`: number of generated prompts. Defaults to `5`.
- `COMPETITIVE_PROMPT_SEED`: seed text for reproducible generation. Defaults to the current date.
- `OPENCANDLE_COMPETITIVE_PROMPT`: fixed user prompt. When set, prompt generation is skipped.
- `OPENCANDLE_COMPETITIVE_PROMPT_ID`: id for a fixed prompt. Defaults to `fixed-prompt`.
- `OPENCANDLE_COMPETITIVE_PROMPT_TOPIC`: topic for a fixed prompt. Defaults to `fixed prompt`.
- `OPENCANDLE_COMPETITIVE_PROMPT_COMPLEXITY`: `simple`, `moderate`, or `complex`. Defaults to `moderate`.
- `OPENCANDLE_COMPETITIVE_PROMPT_FOCUS`: optional judge focus for the fixed prompt.

Judge model:

- `OPENCANDLE_COMPETITIVE_PROVIDER`: provider for prompt generation and judging.
- `OPENCANDLE_COMPETITIVE_MODEL`: model id for prompt generation and judging.

Generic-agent baselines:

- `OPENCANDLE_COMPETITIVE_ACPX_COMMAND`: override the `acpx` command. Defaults to the repo-local binary.
- `OPENCANDLE_COMPETITIVE_CLAUDE_AGENT_COMMAND`: override the Claude ACP adapter command.
- `OPENCANDLE_COMPETITIVE_CODEX_AGENT_COMMAND`: override the Codex ACP adapter command.
- `OPENCANDLE_COMPETITIVE_GEMINI_AGENT_COMMAND`: override the Gemini ACP adapter command.
- `OPENCANDLE_COMPETITIVE_CODEX_MODEL`: Codex baseline model. Defaults to `gpt-5.3-codex-spark/medium`.
- `OPENCANDLE_COMPETITIVE_AGENT_CWD`: isolated working directory for baseline agents. Defaults to a temp directory.
- `OPENCANDLE_COMPETITIVE_AGENT_TIMEOUT_SECONDS`: `acpx` timeout for each baseline call. Defaults to `900`.
- `OPENCANDLE_COMPETITIVE_AGENT_TIMEOUT_MS`: process timeout for each baseline call. Defaults to `900000`.
- `OPENCANDLE_COMPETITIVE_PREFLIGHT`: set to `0` to skip one-time baseline smoke calls.
- `OPENCANDLE_COMPETITIVE_REQUIRE_ALL`: set to `1` to fail if any baseline is unavailable. By default, unavailable baselines are recorded as skipped and the run continues.
- `OPENCANDLE_MANUAL_RUN_SETTLE_GRACE_MS`: settle window for OpenCandle traces. Defaults to `30000` in this runner.
- `OPENCANDLE_ROUTER_MODE`: defaults to `llm`; set to `rules` to compare against the legacy keyword router.

## Where OpenCandle Should Shine

OpenCandle should outperform generic no-tool agents when the answer depends on:

- current quote, options, technical, sentiment, filing, macro, or crypto data
- choosing the right finance workflow before answering
- combining several evidence types into one investment decision
- preserving a trace of tool calls, workflow dispatch, disclaimers, and degradation notes
- asking for missing risk tolerance, horizon, budget, or objective only when that information changes the answer
- naming downside scenarios and uncertainty instead of presenting unsupported conviction

Generic agents may still win when a prompt is purely educational, needs no current data, or rewards a shorter explanation over trace-backed evidence. Those outcomes are useful benchmark signal: they show where OpenCandle should reduce workflow ceremony, improve synthesis, or avoid fetching data that does not change the answer.
