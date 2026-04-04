# Changelog

## [Unreleased]

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
