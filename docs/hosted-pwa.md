---
title: Hosted PWA
description: Run OpenCandle as an installable browser app without an OpenCandle application server.
---

# Hosted OpenCandle PWA

The hosted PWA runs the Pi agent and OpenCandle runtime on your device. The published app is static. It does not send model keys, session transcripts, or saved market state to an OpenCandle application server. A small, open source Cloudflare Worker relays only allowlisted provider HTTP calls that browsers cannot make directly.

This is a smaller capability surface than the local GUI and terminal. Use the local interfaces when an investigation needs browser-cookie CLIs, background delivery, or closed-tab work.

## Requirements

- A current Chromium-based desktop browser with Web Locks, BroadcastChannel, OPFS, service workers, and cross-origin isolation.
- A network connection for model calls, providers, and the browser-hosted Node runtime.
- An API key from OpenAI, Anthropic, or Google. Hosted OpenCandle exposes the
  installed Pi model catalog for each browser-safe provider.

The in-browser Node process is provided by [WebContainer](https://webcontainers.io/) and depends on StackBlitz infrastructure. Privacy blockers that prevent that runtime from loading can also prevent hosted OpenCandle from starting.

## What works

- Pi's canonical `AgentSession`, including command dispatch, extension lifecycle, retries, context accounting, auto-compaction, thinking controls, and canonical Pi JSONL sessions.
- Pi's installed OpenAI, Anthropic, and Google model catalog through the same `ModelRuntime` used by the local GUI and TUI.
- The same React transcript, tool, source, session, watchlist, portfolio, alert, report, and diagnostics surfaces as the local GUI.
- Shared workflow metadata, interactive `ask_user` prompts, images, and saved portfolio, watchlist, and report attachments.
- Device-local SQLite market state and canonical session checkpoints in browser storage.
- HTTP-backed market, crypto, fundamentals, macro, options, technical, portfolio-calculation, web-search, and hosted sentiment-evidence tools. Tools without a negotiated direct or relay path are omitted and named in Diagnostics.
- Multiple open tabs. One tab owns the runtime; other tabs remain usable and forward actions to it.
- Versioned export, validated import, separate key clearing, and full device-data clearing.
- Installation as a standalone PWA and a read-only offline shell for previously saved research.

CoinGecko, Alpha Vantage, and Polymarket run directly from the browser after passing hosted Chromium CORS proofs. The relay policy covers Yahoo Finance, FRED, Brave, Exa, TradingView, and Alternative.me. The PWA negotiates the policy version at startup and fails closed for relayed providers if the relay is missing, outdated, or unreachable. SEC EDGAR is disabled in hosted mode because its endpoints intermittently reject Cloudflare Worker egress. Finnhub and London Strategic Edge remain disabled until live credential-backed browser proofs pass. The local GUI and terminal retain all three providers. X and Reddit still require their local CLIs and a desktop browser session. Hosted mode also omits shell and dynamic-package tools, background alert and notification delivery, scheduled execution, and work after every OpenCandle tab closes.

## Keys and browser storage

During model setup, choose whether each model-provider key remains on the device
or only for the current browser session. Credentials are stored independently,
so switching Pi models does not erase another provider's key. Provider keys
saved in Settings, then Data providers, stay in browser storage. Restored keys are
never filled back into password fields and all keys are excluded from
OpenCandle exports, Pi sessions, and SQLite state.

A session-only key remains scoped to the tab where it was entered and is never sent over the cross-tab coordination channel. If that writer closes, an independently opened follower can take over the saved session and market state but must be given the model key before research can continue. Choose device storage when seamless writer failover is more important than tab-scoped key isolation.

Follower tabs forward ordinary research and market-state actions to the writer, but never forward model or provider credentials. Saving a key from a follower first hands the single writer role to that tab, then validates and stores the key locally without placing it on the coordination channel. A saved-state mutation is acknowledged only after its matching SQLite or Pi-session bytes have been checkpointed to OPFS.

Browser storage is not a secure vault. Same-origin script compromise, a malicious browser extension, physical access to the browser profile, or a compromised dependency could expose a saved key. Use session-only model storage on shared devices and clear secrets when needed.

The relay has no KV, D1, R2, Durable Object, queue, analytics, cache, application log, or invocation-log sink. Requests and responses use `Cache-Control: no-store`; errors do not reflect URLs, bodies, upstream errors, or credentials. Cloudflare still terminates and processes relay traffic and may retain platform-level security or operational metadata under its own policies. The precise boundary and deployment instructions are in [Provider relay operations](./provider-relay.md).

## Data control and recovery

Open Settings from the sidebar, then Data & privacy.

- **Export data** downloads one versioned JSON archive containing Pi sessions and SQLite state, but no model key.
- **Import data** validates archive version, filenames, session identities, parent relationships, sizes, SQLite integrity, and supported schema version before stopping the runtime or replacing device data.
- **Install update** appears only while a downloaded update is waiting. A status pill floating at the top of the page offers the same install while an update waits.
- **Clear secrets** removes model and provider credentials, tears down the in-browser runtime so the old process cannot retain them, and restarts without deleting research.
- **Clear all** removes credentials, sessions, market state, runtime snapshots, and cached application data for this origin. It asks you to type `DELETE` before it runs.

Imports and installed updates preserve a recovery backup before replacing or migrating durable state. An older OpenCandle build refuses to open a database written by a newer schema instead of resetting it. An installed update waits while any runtime request is active, checkpoints the current session, writes a recovery backup, and only then activates the waiting service worker.

If the writer tab closes while a follower action is in flight, the follower fails that action promptly rather than replaying an operation whose completion is unknown. Check the current state, then retry it in the newly promoted writer tab.

The negotiated direct/relay capability manifest is also the execution boundary for hosted search and sentiment evidence. OpenCandle does not silently fall through to an unadvertised search provider. Portfolio holdings require an explicit currency when the quote provider cannot determine one, and totals omit unknown-currency rows rather than assuming USD.

## Offline behavior

The service worker caches the static application shell, not model responses, provider responses, keys, or mutable runtime traffic. While offline, saved transcripts and market state remain readable and exportable. Research and saved-state mutations are disabled with an explicit offline message.

## Move a session to local OpenCandle

Hosted exports retain the upstream Pi JSONL format and OpenCandle's SQLite schema. Export the browser archive before switching devices or clearing browser data. Extract a session's JSONL content from the archive before opening it with local OpenCandle; the entries require no format translation, but browser and local storage are not live-synchronized.
