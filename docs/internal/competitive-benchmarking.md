# Competitive Benchmarking

Use this loop to compare OpenCandle against Claude, Codex, and Gemini as generic no-tool finance agents and identify where OpenCandle should improve.

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
2. Runs each prompt through OpenCandle with the shared in-process harness in `tests/harness/opencandle-runner.ts`.
3. Runs the same prompt through Claude, Codex, and Gemini as generic no-tool finance agents via `acpx`.
4. Uses a judge prompt to compare usefulness, correctness, evidence, clarity, and honesty about uncertainty, using the benchmark run date as the as-of date for current-data checks.
5. Writes a JSON report under `tests/evals/runs/`.

Reports are ignored by git. Commit reusable code and benchmark design, not one-off run transcripts or screenshots.

## Recording Improvement History

Raw JSON reports under `tests/evals/runs/` are local evidence only and are ignored by git. When a competitive run leads to a product or harness change, record a compact, committed summary in `docs/internal/competitive-benchmark-history.md`.

Add one row per improvement loop with:

- date
- prompt id and prompt text
- before report filename and winner/scores
- after report filename and winner/scores
- the relevant failure or gap
- the code or harness changes made
- remaining follow-up ideas that were intentionally not fixed

Do not paste full agent transcripts into the history file. Keep it readable enough for a future agent to see whether OpenCandle improved against generic Claude/Codex/Gemini baselines and why.

## Configuration

```bash
npm run test:evals:competitive
```

Useful environment variables:

- `COMPETITIVE_PROMPT_COUNT`: number of generated prompts. Defaults to `5`.
- `COMPETITIVE_PROMPT_SEED`: text seed for varying or reproducing prompt generation.
- `OPENCANDLE_COMPETITIVE_PROMPT`: fixed user prompt for rerunning the same case after a change. When set, prompt generation is skipped.
- `OPENCANDLE_COMPETITIVE_PROMPT_ID`: optional id for the fixed prompt. Defaults to `fixed-prompt`.
- `OPENCANDLE_COMPETITIVE_PROMPT_TOPIC`: optional topic for the fixed prompt. Defaults to `fixed prompt`.
- `OPENCANDLE_COMPETITIVE_PROMPT_COMPLEXITY`: optional `simple`, `moderate`, or `complex` value for the fixed prompt. Defaults to `moderate`.
- `OPENCANDLE_COMPETITIVE_PROMPT_FOCUS`: optional evaluation focus for the fixed prompt. Defaults to comparing OpenCandle against generic agents and identifying concrete improvements.
- `OPENCANDLE_COMPETITIVE_PROVIDER`: model provider for prompt generation and judging. Defaults to a configured provider, preferring Google when available.
- `OPENCANDLE_COMPETITIVE_MODEL`: model id for prompt generation and judging. Defaults to `gemini-2.5-flash` when using configured Google auth; otherwise uses the first configured model.
- Claude baseline runs through `acpx --agent <repo-local claude-agent-acp> exec`.
- Codex baseline runs through the `acpx codex exec` built-in.
- Gemini baseline runs through `acpx --agent "gemini --acp --skip-trust" exec`.
- `OPENCANDLE_COMPETITIVE_ACPX_COMMAND`: optional acpx command override. Defaults to the repo-local `node_modules/.bin/acpx`.
- `OPENCANDLE_COMPETITIVE_CLAUDE_AGENT_COMMAND`: optional Claude ACP adapter override. Defaults to the repo-local `node_modules/.bin/claude-agent-acp`.
- `OPENCANDLE_COMPETITIVE_CODEX_AGENT_COMMAND`: optional Codex ACP adapter override. Defaults to the acpx `codex` built-in.
- `OPENCANDLE_COMPETITIVE_GEMINI_AGENT_COMMAND`: optional Gemini ACP adapter override. Defaults to `gemini --acp --skip-trust`.
- `OPENCANDLE_COMPETITIVE_CODEX_MODEL`: Codex ACP baseline model. Defaults to `gpt-5.3-codex-spark/medium`.
- `OPENCANDLE_COMPETITIVE_AGENT_TIMEOUT_SECONDS`: acpx timeout in seconds for each baseline call. Defaults to `900`.
- `OPENCANDLE_COMPETITIVE_AGENT_TIMEOUT_MS`: process timeout in milliseconds for each baseline call. Defaults to `900000`.
- `OPENCANDLE_COMPETITIVE_PREFLIGHT`: set to `0` to skip one-time baseline smoke calls before running OpenCandle. Defaults to enabled so auth failures happen early.
- `OPENCANDLE_COMPETITIVE_REQUIRE_ALL`: set to `1` to fail when any baseline fails preflight. By default, unavailable local baselines are recorded under `skippedCompetitors` and the loop continues with the available agents.
- `OPENCANDLE_MANUAL_RUN_SETTLE_GRACE_MS`: settle window for OpenCandle traces. Defaults to `30000` in this loop.
- `OPENCANDLE_ROUTER_MODE`: defaults to `llm`; set `rules` to compare against legacy keyword routing.

`acpx` requires its ACP adapter binaries to be available on PATH or passed through `--agent`. The repo carries `acpx`, `@zed-industries/codex-acp`, and `@agentclientprotocol/claude-agent-acp` as dev dependencies so `npm run test:evals:competitive` can use the structured ACP path instead of raw CLI/PTTY scraping. Gemini uses the local `gemini --acp --skip-trust` command with `GEMINI_CLI_TRUST_WORKSPACE=true`.

The runner uses `--agent` for Claude and Gemini instead of relying only on acpx built-ins because acpx's project config is resolved against the benchmark agent cwd, which is an isolated temp directory. This also lets us pin or override adapter commands per provider without changing global `~/.acpx/config.json`.

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

## Iterating When OpenCandle Underperforms

When OpenCandle loses, or wins with obvious quality gaps, treat the result as the start of a focused improvement loop:

1. Read `competitorsDidBetter`, `openCandleImprovementIdeas`, OpenCandle classification, tool calls, ask-user transcript, and final text from the report.
2. Decide whether the gap belongs to the harness, routing, prompt assembly, tool selection, data transformation, or final synthesis. Keep the fix at that layer.
3. Add a targeted test for the reusable behavior when possible. Examples: preserve useful baseline output even if a CLI exits non-zero, avoid leaking fallback assumptions as user-visible scaffolding, or convert raw macro series into interpretable rates.
4. Rerun the exact prompt by setting `OPENCANDLE_COMPETITIVE_PROMPT` and the optional fixed-prompt metadata variables. Compare the new report against the prior report before broadening the change.
5. Only generalize after the rerun shows the target behavior improved, or after the failure recurs across multiple generated prompts.
6. If the loop caused any committed change, update `docs/internal/competitive-benchmark-history.md` before finishing.

Example rerun:

```bash
OPENCANDLE_COMPETITIVE_PROMPT_ID=fixed-macro-rerun \
OPENCANDLE_COMPETITIVE_PROMPT_TOPIC=macro \
OPENCANDLE_COMPETITIVE_PROMPT_COMPLEXITY=complex \
OPENCANDLE_COMPETITIVE_PROMPT_FOCUS="Check whether OpenCandle improved macro synthesis after the prompt fix." \
OPENCANDLE_COMPETITIVE_PROMPT="As of today, May 17, 2026, analyze the current macroeconomic environment..." \
npm run test:evals:competitive
```
