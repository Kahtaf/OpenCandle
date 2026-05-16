# Competitive Benchmarking

Use this loop to compare OpenCandle against generic no-tool finance agents and identify where OpenCandle should improve.

The goal is not to prove that OpenCandle is always better. The prompt set should include broad finance questions where either side may win:

- current-market questions where tools may help
- general education questions where a generic agent may explain more clearly
- portfolio and risk questions that need judgment as well as data
- macro, options, sentiment, filing, and company-research questions
- ambiguous prompts where routing, clarification, or synthesis quality matters

When the generic agent wins, the report should explain why and name concrete OpenCandle improvements. Common outcomes might be poor routing, missing tools, weak synthesis, too much workflow ceremony, stale or incomplete evidence, or a generic agent simply giving a clearer explanation.

## How It Works

`npm run test:evals:competitive` runs `tests/scripts/run-competitive-finance-eval.ts`.

The runner:

1. Generates fresh finance prompts at runtime.
2. Runs each prompt through OpenCandle with `tests/harness/manual-run.ts`.
3. Runs the same prompt through a generic no-tool finance agent.
4. Uses a judge prompt to compare usefulness, correctness, evidence, clarity, and honesty about uncertainty.
5. Writes a JSON report under `tests/evals/runs/`.

Reports are ignored by git. Commit reusable code and benchmark design, not one-off run transcripts or screenshots.

## Configuration

```bash
npm run test:evals:competitive
```

Useful environment variables:

- `COMPETITIVE_PROMPT_COUNT`: number of generated prompts. Defaults to `5`.
- `COMPETITIVE_PROMPT_SEED`: text seed for varying or reproducing prompt generation.
- `OPENCANDLE_COMPETITIVE_PROVIDER`: model provider for prompt generation, generic baseline, and judging. Defaults to a configured provider, preferring Google when available.
- `OPENCANDLE_COMPETITIVE_MODEL`: model id. Defaults to `gemini-2.5-flash` when using configured Google auth; otherwise uses the first configured model.
- `OPENCANDLE_MANUAL_RUN_SETTLE_GRACE_MS`: settle window for OpenCandle traces. Defaults to `30000` in this loop.
- `OPENCANDLE_ROUTER_MODE`: choose `rules` or `llm` for the OpenCandle run.

## Reading Results

Treat every generic-agent win as useful signal, not a benchmark failure. The important fields are:

- `winner`
- `reason`
- `openCandleDidBetter`
- `genericDidBetter`
- `openCandleImprovementIdeas`
- OpenCandle trace details: classification, tool calls, ask-user transcript, and final text

The next engineering loop should convert recurring improvement ideas into targeted regression tests or product changes.
