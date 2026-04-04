# Changelog

## [Unreleased]

- Add three-level error recovery for provider failures: circuit breaker (Level A), stale cache fallback (Level B), cross-provider fallback for quotes and daily history (Level C)
- All tools now return degraded text responses instead of crashing when providers are unavailable
- Add `withFallback()` utility — stock quotes fall back from Yahoo to Alpha Vantage; daily history does the same with an interval guard (intraday stays Yahoo-only)
- Add stale-while-error cache with domain-specific limits (15min quotes through 7-day fundamentals)
- Wire existing `ProviderTracker` circuit breaker into tool execution via module-level run context bridge
- Add `getGlobalQuote()` and `getDailyHistory()` to Alpha Vantage provider
- Add adversarial bull/bear debate phase to comprehensive analysis — 3 new workflow steps (bull researcher, bear researcher, self-gating rebuttal) between analysts and synthesis, producing debate-aware verdicts with reversal conditions
- Add agent test harness with file-based IPC — any coding agent can drive OpenCandle via CLI, answer follow-up questions, and get structured traces of every tool call and interaction
- Add injectable `askUserHandler` to `createOpenCandleSession()` for non-UI contexts
- Add trace collector that captures tool calls, results, text, and interactions from session events
- Add `IpcChannel` class for atomic file-based question/answer exchange with `fs.watch` + polling fallback
- Add CLI entry point (`tests/harness/cli.ts`) with `run`, `wait`, `answer`, `trace` subcommands

## [0.1.2] - 2026-04-01

- Add `ask_user` clarification tool — agent now asks targeted follow-up questions for vague or broad requests instead of making assumptions
- Add data-first response playbooks — after clarification, agent fetches live market data (fear & greed, macro indicators, benchmark ETFs) before responding
- System prompt guidance for when to ask vs. proceed with defaults

## [0.1.1] - 2026-03-30

- Use npm trusted publishing for releases
- Avoid duplicate publish workflow runs

## [0.1.0] - 2026-03-30

- Initial OpenCandle release baseline before public npm packaging work.
