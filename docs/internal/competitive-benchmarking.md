# Competitive Benchmarking

Use this loop to compare OpenCandle against Claude, Codex, and Gemini as generic no-tool finance agents and identify where OpenCandle should improve.

The goal is not to prove that OpenCandle is always better. The prompt set should include broad finance questions where either side may win:

- current-market questions where tools may help
- general education questions where Claude or Codex may explain more clearly
- portfolio and risk questions that need judgment as well as data
- macro, options, sentiment, filing, and company-research questions
- ambiguous prompts where routing, clarification, or synthesis quality matters

When Claude or Codex wins, the report should explain why and name concrete OpenCandle improvements. Common outcomes might be poor routing, missing tools, weak synthesis, too much workflow ceremony, stale or incomplete evidence, or another agent simply giving a clearer explanation.

## Prompt Wording

Competitive prompts should read like questions from a regular retail investor using the product, not like benchmark tasks.

Use average-user wording:

- "I'm thinking about buying NVDA today. Would you buy, wait, or avoid it?"
- "I have $50k for about 3 years. Build me a balanced portfolio."
- "What's the mood around GME on Reddit, X/Twitter, and news?"
- "I own 200 shares of NVDA after a big run. What's a reasonable protective put?"

Avoid harness-aware wording in the user-facing prompt:

- Do not mention OpenCandle, generic agents, judges, evals, benchmarks, routing, providers, APIs, or tools.
- Do not ask for "source-by-source tool status" unless that is how a normal user would ask.
- Do not phrase prompts around "testing coverage" or "tools we missed."
- Do not over-specify answer formatting just to make the judge easier.

It is fine for `OPENCANDLE_COMPETITIVE_PROMPT_FOCUS` to mention the evaluation target, because that field goes to the judge metadata. Keep the actual `OPENCANDLE_COMPETITIVE_PROMPT` natural.

The competitor answer cache is keyed by exact prompt text. If you change a prompt to make it more natural, the prompt text must change enough to force fresh Claude/Codex/Gemini answers; do not judge a naturalized prompt against cached answers from harness-aware wording.

## Saved-State Prompts

Set `OPENCANDLE_COMPETITIVE_SEED_STATE=1` to benchmark personalization. The runner seeds the disposable eval home with the deterministic `COMPETITIVE_STATE_FIXTURE` (portfolio lots, watchlist theses, one open prediction), asks the prompt generator to make about two prompts reference the user's saved holdings naturally, gives the generic agents the same facts inline (fairness: a real user could paste their holdings into any chat), and tells the judge to verify both sides against the saved state — penalizing ignored or misquoted positions. The report records `seededState: true`. Judge scores are anchored on a 0-10 scale, and judged winners are validated against the allowed winner set so summaries cannot misattribute wins.

## How It Works

`npm run eval -- competitive` runs `tests/scripts/run-competitive-finance-eval.ts`. This front door is the only supported competitive eval route.

The runner:

1. Generates fresh finance prompts at runtime.
2. Runs each prompt through OpenCandle with the shared in-process harness in `tests/harness/opencandle-runner.ts`.
3. Runs the same prompt through Claude, Codex, and Gemini as generic no-tool finance agents via `acpx`.
4. Uses a judge prompt to compare usefulness, correctness, evidence, clarity, and honesty about uncertainty, using the benchmark run date as the as-of date for current-data checks.
5. Writes a JSON report under `tests/evals/runs/`.

Reports are ignored by git. Commit reusable code and benchmark design, not one-off run transcripts or screenshots.

## Frozen Release Panel

Generated competitive prompts remain the discovery tool. Release preparation should also rerun the frozen historical-loss panel:

```bash
npm run eval -- competitive:frozen
```

This sets `OPENCANDLE_COMPETITIVE_PANEL=frozen` and reuses the competitive runner's exact-prompt cache for Claude, Codex, and Gemini baselines when previous reports contain matching answers. The panel covers portfolio-review-not-builder, requested 1-2 week DTE preservation, protective-put-not-bullish-call, unknown-ticker-no-dead-end, and hedge sizing with share count. The deterministic hard assertions for these prompts live in `docs/internal/prompt-to-policy-migration-manifest.json`; do not copy those literals into production prompt guidance.

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
npm run eval -- competitive
```

Useful environment variables:

- `COMPETITIVE_PROMPT_COUNT`: number of generated prompts. Defaults to `5`.
- `COMPETITIVE_PROMPT_SEED`: text seed for varying or reproducing prompt generation.
- `OPENCANDLE_COMPETITIVE_PANEL=frozen`: use the frozen release panel instead of generated prompts.
- `OPENCANDLE_COMPETITIVE_PROMPT`: fixed user prompt for rerunning the same case after a change. When set, prompt generation is skipped.
- `OPENCANDLE_COMPETITIVE_PROMPT_ID`: optional id for the fixed prompt. Defaults to `fixed-prompt`.
- `OPENCANDLE_COMPETITIVE_PROMPT_TOPIC`: optional topic for the fixed prompt. Defaults to `fixed prompt`.
- `OPENCANDLE_COMPETITIVE_PROMPT_COMPLEXITY`: optional `simple`, `moderate`, or `complex` value for the fixed prompt. Defaults to `moderate`.
- `OPENCANDLE_COMPETITIVE_PROMPT_FOCUS`: optional evaluation focus for the fixed prompt. Defaults to comparing OpenCandle against generic agents and identifying concrete improvements.
- `OPENCANDLE_COMPETITIVE_PROVIDER`: model provider for prompt generation and judging. Defaults to a configured provider, preferring Google when available.
- `OPENCANDLE_COMPETITIVE_MODEL`: model id for prompt generation and judging. Defaults to `gemini-2.5-flash` when using configured Google auth; otherwise uses the first configured model.
- Claude baseline runs through `acpx --agent <repo-local claude-agent-acp> exec`.
- Codex baseline runs through the `acpx codex exec` built-in.
- Gemini baseline prefers direct Google API mode when `GEMINI_API_KEY` or `GOOGLE_API_KEY` is available, avoiding the retired consumer Gemini CLI ACP path.
- `OPENCANDLE_COMPETITIVE_ACPX_COMMAND`: optional acpx command override. Defaults to the repo-local `node_modules/.bin/acpx`.
- `OPENCANDLE_COMPETITIVE_CLAUDE_AGENT_COMMAND`: optional Claude ACP adapter override. Defaults to the repo-local `node_modules/.bin/claude-agent-acp`.
- `OPENCANDLE_COMPETITIVE_CODEX_AGENT_COMMAND`: optional Codex ACP adapter override. Defaults to the acpx `codex` built-in.
- `OPENCANDLE_COMPETITIVE_GEMINI_AGENT`: set to `api` to force direct Google API mode or `acpx` to force the legacy Gemini CLI ACP path. Defaults to API mode when `GEMINI_API_KEY` or `GOOGLE_API_KEY` is present, otherwise ACP.
- `OPENCANDLE_COMPETITIVE_GEMINI_MODEL`: Gemini API baseline model. Defaults to `gemini-2.5-flash`.
- `OPENCANDLE_COMPETITIVE_GEMINI_AGENT_COMMAND`: optional Gemini ACP adapter override when using `OPENCANDLE_COMPETITIVE_GEMINI_AGENT=acpx`. Defaults to `gemini --acp --skip-trust`.
- `OPENCANDLE_COMPETITIVE_CODEX_MODEL`: Codex ACP baseline model. Defaults to `gpt-5.3-codex-spark`.
- `OPENCANDLE_COMPETITIVE_AGENT_TIMEOUT_SECONDS`: acpx timeout in seconds for each baseline call. Defaults to `900`.
- `OPENCANDLE_COMPETITIVE_AGENT_TIMEOUT_MS`: process timeout in milliseconds for each baseline call. Defaults to `900000`.
- `OPENCANDLE_COMPETITIVE_PREFLIGHT`: set to `0` to skip one-time baseline smoke calls before running OpenCandle. Defaults to enabled so auth failures happen early.
- `OPENCANDLE_COMPETITIVE_REQUIRE_ALL`: set to `1` to fail when any baseline fails preflight. By default, unavailable local baselines are recorded under `skippedCompetitors` and the loop continues with the available agents.
- `OPENCANDLE_MANUAL_RUN_SETTLE_GRACE_MS`: legacy-named settle window for OpenCandle traces. The old manual-run harness is gone; this env var remains to avoid renaming an established benchmark knob. Defaults to `90000` in this loop.
- `OPENCANDLE_ROUTER_MODE`: leave unset or set to `llm`. The legacy `rules` router mode has been removed and will fail startup with migration guidance.

`acpx` requires its ACP adapter binaries to be available on PATH or passed through `--agent`. The repo carries `acpx`, `@agentclientprotocol/codex-acp`, and `@agentclientprotocol/claude-agent-acp` as dev dependencies so `npm run eval -- competitive` can use the structured ACP path instead of raw CLI/PTTY scraping. The Gemini baseline does not require `acpx` when API mode is selected. If forced to ACP mode, it uses the local `gemini --acp --skip-trust` command with `GEMINI_CLI_TRUST_WORKSPACE=true`.

The runner uses `--agent` for Claude and for Gemini only when Gemini is forced to ACP mode instead of relying only on acpx built-ins because acpx's project config is resolved against the benchmark agent cwd, which is an isolated temp directory. This also lets us pin or override adapter commands per provider without changing global `~/.acpx/config.json`.

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
2. Decide whether the gap belongs to the harness, routing/planning selection, slot/entity extraction, tool capability, evidence normalization, answer contract, structured check, policy card, workflow prompt, or final synthesis. Keep the fix at that layer.
3. Add a targeted test for the reusable behavior when possible. Examples: preserve useful baseline output even if a CLI exits non-zero, avoid leaking fallback assumptions as user-visible scaffolding, or convert raw macro series into interpretable rates.
4. Rerun the exact prompt by setting `OPENCANDLE_COMPETITIVE_PROMPT` and the optional fixed-prompt metadata variables. Compare the new report against the prior report before broadening the change.
5. Only generalize after the rerun shows the target behavior improved, or after the failure recurs across multiple generated prompts.
6. If the loop caused any committed change, update `docs/internal/competitive-benchmark-history.md` before finishing.

## Regression Fix Protocol

Do not fix a competitive loss by appending benchmark-specific instructions to the fallback playbook or another broad prompt. The production fix must generalize beyond the one prompt that exposed the issue.

Before editing prompts, classify the root cause and choose the narrowest durable layer:

- `routing/planning selection`: the turn picked the wrong task family, workflow, policy card, or tool bundle.
- `slot/entity extraction`: the right facts were present in the user prompt but were not captured or were confused, such as owned underlying versus catalyst ticker.
- `tool capability`: OpenCandle needs a real provider/tool improvement, not more prose.
- `evidence normalization`: tool output needs clearer dates, stale-data labels, source coverage, or provider-gap metadata.
- `policy card`: the behavior is reusable for one task family and should render only for that selected family.
- `workflow prompt`: the behavior belongs to an existing tool-backed workflow's orchestration.
- `answer contract or structured check`: the answer shape, required disclosure, or no-fabrication rule should be enforced outside freeform prompt prose.
- `eval assertion or harness`: the benchmark is judging the wrong thing, missing trace data, or accepting false positives.

The fallback playbook is the last resort. Use it only for behavior that is universal across finance tasks, such as fetching data before stating current prices, labeling data gaps, or asking for genuinely missing required slots.

For every competitive or prompt-policy regression fix, leave enough evidence for review:

- failing prompt id and report path
- root cause
- chosen layer and why it generalizes
- focused test or manifest assertion
- exact rerun command and result
- confirmation that benchmark-specific literals were not copied into production prompt guidance

Benchmark-specific literals belong in eval manifests and tests, not in production prompt guidance. Good production wording uses reusable variables such as "the supplied debt rate", "the owned underlying", "the catalyst symbol", or "the user's stated horizon". Bad production wording copies a benchmark value such as a specific ticker, share count, cost basis, mortgage rate, or exact prompt phrase.

Local guard: `tests/unit/prompts/prompt-debt-guard.test.ts` scans prompt-policy manifest literals against production prompt guidance. Run it when fixing prompt-policy or competitive regressions:

```bash
npx vitest run tests/unit/prompts/prompt-debt-guard.test.ts
```

Example rerun:

```bash
OPENCANDLE_COMPETITIVE_PROMPT_ID=fixed-macro-rerun \
OPENCANDLE_COMPETITIVE_PROMPT_TOPIC=macro \
OPENCANDLE_COMPETITIVE_PROMPT_COMPLEXITY=complex \
OPENCANDLE_COMPETITIVE_PROMPT_FOCUS="Check whether OpenCandle improved macro synthesis after the prompt fix." \
OPENCANDLE_COMPETITIVE_PROMPT="As of today, May 17, 2026, analyze the current macroeconomic environment..." \
npm run eval -- competitive
```
