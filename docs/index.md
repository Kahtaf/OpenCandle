---
title: OpenCandle Docs
description: Documentation for the open source financial investigator.
---

# OpenCandle Docs

OpenCandle is an open source financial investigator that runs three ways: the web app at web.opencandle.app, the local GUI, and the terminal (TUI). All three fetch real market data before the model writes an answer.

It is read-only research software. It does not place trades, route orders, or provide financial advice.

## How OpenCandle Works

1. You ask a financial question in the web app, the local GUI, or the terminal.
2. OpenCandle classifies the investigation and asks a follow-up only if a missing detail changes the answer.
3. Tools fetch quotes, filings, options, macro data, and sentiment. Gaps and stale data are surfaced.
4. The model writes an answer that separates facts from judgment and names the risks.

[Pi](https://github.com/earendil-works/pi) is the bundled agent runtime (model setup, sessions, terminal shell). OpenCandle adds the finance tools, workflows, providers, and local state on top. No separate Pi install needed.

For a quick feel of the product, watch the [launch video](https://github.com/user-attachments/assets/334956b1-18b4-4d6f-92b5-3f739824cd29).

## Start here

- [Why OpenCandle](./comparisons.md): how it compares to general chatbots.
- [Ways to Run OpenCandle](./ways-to-run.md): the web app, the local GUI, and the terminal compared.
- [Getting Started](./getting-started.md): install to a first market answer in five minutes, plus troubleshooting.

## Guides

- [Web App Quickstart](./hosted-pwa.md): use OpenCandle at web.opencandle.app with nothing to install.
- [GUI Quickstart](./gui-quickstart.md): the local browser workbench.
- [TUI Quickstart](./tui.md): terminal usage, slash commands, sessions.
- [Investigation Recipes](./investigation-recipes.md): repeatable research paths.

## Reference

- [Data Sources](./data-sources.md): provider coverage and optional keys.
- [Configuration](./configuration.md): env vars, file config, state files.

## Build on it

- [How the Web App Works](./how-the-web-app-works.md): what runs in your browser and where your data lives.
- [System Architecture](./system-architecture.md): how questions become investigations and answers.
- [Build a Tool](./build-a-tool.md): first-party tools and add-on npm packages.
- [Testing and Evals](./testing-and-evals.md): tests, session quality, benchmarking.

## Operating Principles

- Evidence first. Show the data used; avoid unsupported conclusions.
- Tools fetch and format. The model synthesizes.
- Provider gaps stay visible: missing keys, stale data, degraded sources.
- Your data stays on your device: under `~/.opencandle/` for the local GUI and terminal, in your browser for the web app.

OpenCandle gathers and organizes evidence. Judgment and risk stay with you.
