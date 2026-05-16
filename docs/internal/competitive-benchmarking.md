# Competitive Benchmarking

Use this loop to compare OpenCandle against Claude and Codex as generic no-tool finance agents and identify where OpenCandle should improve.

The goal is not to prove that OpenCandle is always better. The prompt set should include broad finance questions where either side may win:

- current-market questions where tools may help
- general education questions where Claude or Codex may explain more clearly
- portfolio and risk questions that need judgment as well as data
- macro, options, sentiment, filing, and company-research questions
- ambiguous prompts where routing, clarification, or synthesis quality matters

When Claude or Codex wins, the report should explain why and name concrete OpenCandle improvements. Common outcomes might be poor routing, missing tools, weak synthesis, too much workflow ceremony, stale or incomplete evidence, or another agent simply giving a clearer explanation.

## How It Works

`npm run test:evals:competitive` runs `tests/scripts/run-competitive-finance-eval.ts`.

The runner:

1. Generates fresh finance prompts at runtime.
2. Runs each prompt through OpenCandle with `tests/harness/manual-run.ts`.
3. Runs the same prompt through Claude and Codex as generic no-tool finance agents.
4. Uses a judge prompt to compare usefulness, correctness, evidence, clarity, and honesty about uncertainty, using the benchmark run date as the as-of date for current-data checks.
5. Writes a JSON report under `tests/evals/runs/`.

Reports are ignored by git. Commit reusable code and benchmark design, not one-off run transcripts or screenshots.

## Configuration

```bash
npm run test:evals:competitive
```

Useful environment variables:

- `COMPETITIVE_PROMPT_COUNT`: number of generated prompts. Defaults to `5`.
- `COMPETITIVE_PROMPT_SEED`: text seed for varying or reproducing prompt generation.
- `OPENCANDLE_COMPETITIVE_PROVIDER`: model provider for prompt generation and judging. Defaults to a configured provider, preferring Google when available.
- `OPENCANDLE_COMPETITIVE_MODEL`: model id for prompt generation and judging. Defaults to `gemini-2.5-flash` when using configured Google auth; otherwise uses the first configured model.
- Claude baseline runs through `claude -p` using the local Claude subscription. If `claude` is not on PATH, the runner falls back to `npx -y @anthropic-ai/claude-code -p`.
- `OPENCANDLE_COMPETITIVE_CLAUDE_COMMAND`: optional Claude CLI command override.
- Codex baseline runs through `codex exec` in an empty read-only temp directory.
- `OPENCANDLE_COMPETITIVE_CODEX_COMMAND`: optional Codex CLI command override. Defaults to `codex`.
- `OPENCANDLE_COMPETITIVE_CODEX_MODEL`: Codex CLI baseline model. Defaults to `gpt-5.3-codex-spark`.
- `OPENCANDLE_COMPETITIVE_PREFLIGHT`: set to `0` to skip the one-time Claude/Codex CLI smoke call before running OpenCandle. Defaults to enabled so auth failures happen early.
- `OPENCANDLE_MANUAL_RUN_SETTLE_GRACE_MS`: settle window for OpenCandle traces. Defaults to `30000` in this loop.
- `OPENCANDLE_ROUTER_MODE`: defaults to `llm`; set `rules` to compare against legacy keyword routing.

## Reading Results

Treat every Claude or Codex win as useful signal, not a benchmark failure. The important fields are:

- `winner`
- `reason`
- `openCandleDidBetter`
- `competitorScores`
- `competitorsDidBetter`
- `openCandleImprovementIdeas`
- OpenCandle trace details: classification, tool calls, ask-user transcript, and final text

The next engineering loop should convert recurring improvement ideas into targeted regression tests or product changes.
