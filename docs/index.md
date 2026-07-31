---
title: OpenCandle Docs
description: Documentation for the open source financial investigator.
---

# OpenCandle Docs

OpenCandle is an open source financial investigator with a local browser GUI and an equally complete terminal interface. Both fetch real market data before the model writes an answer.

It is read-only research software. It does not place trades, route orders, or provide financial advice.

## How OpenCandle Works

1. You ask a financial question in the GUI or terminal.
2. OpenCandle classifies the investigation and asks a follow-up only if a missing detail changes the answer.
3. Tools fetch quotes, filings, options, macro data, and sentiment. Gaps and stale data are surfaced.
4. The model writes an answer that separates facts from judgment and names the risks.

[Pi](https://github.com/earendil-works/pi) is the bundled agent runtime (model setup, sessions, terminal shell). OpenCandle adds the finance tools, workflows, providers, and local state on top. No separate Pi install needed.

For a quick feel of the product, watch the [launch video](https://github.com/user-attachments/assets/334956b1-18b4-4d6f-92b5-3f739824cd29).

## Start here

- [Why OpenCandle](./comparisons.md): how it compares to chatbots, finance sites, and spreadsheets.
- [Getting Started](./getting-started.md): install to a first market answer in five minutes, plus troubleshooting.
- [GUI Quickstart](./gui-quickstart.md): the local browser workbench.
- [Hosted PWA](./hosted-pwa.md): install and use OpenCandle without keeping a local server running.

## Guides and reference

- [Terminal (TUI)](./tui.md): terminal usage, slash commands, sessions.
- [Investigation Recipes](./investigation-recipes.md): repeatable research paths.
- [Data Sources](./data-sources.md): provider coverage and optional keys.
- [Configuration](./configuration.md): env vars, file config, state files.

## Build on it

- [System Architecture](./system-architecture.md): how questions become investigations and answers.
- [Build a Tool](./build-a-tool.md): first-party tools and add-on npm packages.
- [Testing and Evals](./testing-and-evals.md): tests, session quality, benchmarking.

## Operating Principles

- Evidence first. Show the data used; avoid unsupported conclusions.
- Tools fetch and format. The model synthesizes.
- Provider gaps stay visible: missing keys, stale data, degraded sources.
- Local state stays local, under `~/.opencandle/`.

OpenCandle gathers and organizes evidence. Judgment and risk stay with you.
