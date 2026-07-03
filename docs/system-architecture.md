---
title: System Architecture
description: How OpenCandle turns a financial question into evidence, tool output, and an answer.
---

# System Architecture

OpenCandle is a local financial research workbench. You ask a question in the terminal or the browser GUI; OpenCandle figures out what kind of investigation it is, gathers evidence from finance tools, keeps the trace visible, and produces an answer that names risks and data gaps.

It is not an automated trading system and it is not a financial advisor. It is research software built to make the evidence path inspectable.

![OpenCandle architecture diagram showing how a prompt flows through OpenCandle internals, a configured AI model, evidence trace, saved market state, and external data sources.](./images/opencandle-architecture.png)

## The Everyday Flow

```text
User question
  |
  v
Understand the financial task
  - symbols, companies, assets, portfolio details
  - time horizon, risk profile, budget, strategy, or missing details
  - whether this is education, comparison, portfolio review, options, sentiment, filings, macro, or state tracking
  |
  v
Choose an investigation path
  - use a structured workflow when the user asks for one
  - otherwise prepare a finance-specific evidence plan for the question
  - ask a focused follow-up only when the missing detail changes the answer
  |
  v
Gather tool-backed evidence
  - quotes, histories, options chains, fundamentals, filings, macro data
  - sentiment, web/news context, portfolio state, risk, correlations, backtests
  - provider freshness, missing credentials, stale cache, or degraded data
  |
  v
Produce the answer
  - cite what was actually checked
  - separate facts from judgment
  - call out uncertainty and downside scenarios
  - answer directly when the user asks for a decision or tradeoff
```

## User Interfaces

OpenCandle has two main surfaces.

The terminal UI is the fastest keyboard loop. It supports normal chat, slash commands, model setup, provider connection, and saved [Pi](https://github.com/earendil-works/pi) sessions.

The local GUI is a browser workbench at `http://127.0.0.1:14567`. It shows chat, session history, provider setup, a tool and workflow catalog, a financial context panel, and visual result cards for market data, options, macro, filings, sentiment, and portfolio facts.

Both surfaces use the same OpenCandle session and finance tools. The GUI adds richer rendering and easier discovery; it is not a separate agent.

## Workflows And Regular Questions

Some prompts map cleanly to visible workflows:

| Workflow | Use it for |
| --- | --- |
| Comprehensive Analysis | A broad single-asset investigation such as `/analyze NVDA`. |
| Compare Assets | Side-by-side comparison of stocks, ETFs, crypto assets, or funds. |
| Portfolio Builder | Building a proposed allocation from goals, budget, horizon, and risk preference. |
| Options Screener | Looking at calls, puts, covered calls, protective puts, expirations, and Greeks. |

Regular chat questions still get structure. For example:

- "Does adding NVDA make sense if I already own AAPL and TSLA?"
- "Is this SPY/MSFT retirement portfolio too risky?"
- "Is ARMH still the right ticker for Arm?"
- "Should I keep cash in HYSA, T-bills, CDs, or a bond ETF?"

Those are not just freeform replies. OpenCandle still extracts the relevant entities, chooses useful evidence, asks for clarification when needed, and applies the right answer shape for the task.

## Clarifying Questions

OpenCandle should ask a follow-up only when the missing information materially changes the investigation.

Good examples:

- An unknown ticker appears in an earnings-risk question.
- An options request is missing the underlying position.
- A portfolio-construction request has no budget, horizon, or risk preference.

In the GUI, these appear as question cards in the chat. After you answer, OpenCandle continues the investigation and uses tools; it should not stop at a generic response.

## Tools And Providers

Tools are small finance capabilities. They fetch and format data. They should not invent market facts or make the final investment conclusion. Provider helpers add caching, rate limiting, fallback behavior, and degraded-state metadata; if a provider is missing, stale, or unavailable, that shows up in the result instead of being hidden.

The full domain-by-domain map of tools and providers lives in [Data Sources](./data-sources.md).

## Evidence And Answer Quality

OpenCandle answers should be useful because the evidence is visible and the answer shape matches the question.

Expected behavior:

- A current-price question should show the quote source and freshness.
- A portfolio-risk question should discuss concentration, horizon, drawdown, and simple adjustments.
- An options question should distinguish per-share option quotes from standard 100-share contract cost.
- A ticker mismatch should be treated as a red flag before discussing social hype.
- A filing question should separate SEC filing evidence from news or market context.
- A pure education question should avoid unnecessary tool calls.

The model synthesizes after evidence is gathered. It should answer directly, name risks, disclose gaps, and avoid unsupported certainty.

## GUI Runtime And Local State

The GUI server serves the built browser app, reads the current Pi session, and streams chat/session updates. Browser and terminal surfaces coordinate through authenticated local forwarding, session-scoped action IDs, and stale-lock recovery so supported actions can stay attached to the active session without exposing ownership roles in the UI. See [GUI Quickstart](./gui-quickstart.md) for local usage and Tailscale access.

Useful local endpoints:

- `GET /health` returns whether the process is alive plus diagnostic coordination metadata.
- `GET /api/bootstrap` returns the initial catalog, setup state, sessions, prompts, and current snapshot.
- `GET /api/sessions` lists saved sessions.
- `GET /api/session/events` returns the current projected chat events.
- `POST /api/chat/run` streams one chat run.
- `GET /ws` provides live updates for setup, catalog, session, and ask-user events.

## Local State

OpenCandle state defaults to `~/.opencandle/`; the state files and env overrides are documented in [Configuration](./configuration.md).

Common files:

- `config.json` for provider keys and file-backed settings.
- `state.db` for memory, workflow state, and durable user market state such as instruments, watchlists, portfolio lots, alerts, report runs, and import provenance.
- `sentinel.db` for sentiment trend state.
- `onboarding.json` for provider setup, snooze, never-ask, and welcome state.

OpenCandle does not treat `watchlist.json` or `portfolio.json` as supported state sources.

Pi owns its own runtime config and session storage separately. OpenCandle should not depend on repo-local `.pi/extensions/` artifacts.

## Validation

OpenCandle uses layered validation:

- Unit tests for deterministic logic, mocked providers, and GUI state helpers.
- End-to-end tests for CLI, credential flows, and live provider/tool behavior when needed.
- Browser smoke tests for the local GUI.
- Full-session evals that check whether the agent chose the right investigation path, used relevant tools, disclosed gaps, framed risk, and answered the user directly.
- Competitive evals that compare OpenCandle against generic agents on realistic finance prompts.

See [Testing and Evals](./testing-and-evals.md).
