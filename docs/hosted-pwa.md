---
title: Hosted PWA
description: Run OpenCandle as an installable browser app without an OpenCandle application server.
---

# Hosted OpenCandle PWA

The hosted PWA runs the Pi agent and OpenCandle runtime on your device. The published site serves static application files only. It does not send model keys, session transcripts, or saved market state to an OpenCandle application server.

This is a smaller capability surface than the local GUI and terminal. Use the local interfaces when an investigation needs the full provider catalog, browser-cookie CLIs, background alerts, or closed-tab work.

## Requirements

- A current Chromium-based desktop browser with Web Locks, BroadcastChannel, OPFS, service workers, and cross-origin isolation.
- A network connection for model calls, providers, and the browser-hosted Node runtime.
- An OpenAI API key. The first hosted release uses `gpt-4.1-mini`.

The in-browser Node process is provided by [WebContainer](https://webcontainers.io/) and depends on StackBlitz infrastructure. Privacy blockers that prevent that runtime from loading can also prevent hosted OpenCandle from starting.

## What works

- The real Pi agent loop and canonical Pi JSONL sessions.
- The same React transcript, tool, source, session, watchlist, portfolio, alert, report, and diagnostics surfaces as the local GUI.
- Device-local SQLite market state and canonical session checkpoints in browser storage.
- Direct Polymarket research. Tools without a fully browser-safe provider path are omitted and named in Diagnostics.
- Multiple open tabs. One tab owns the runtime; other tabs remain usable and forward actions to it.
- Versioned export, validated import, separate key clearing, and full device-data clearing.
- Installation as a standalone PWA and a read-only offline shell for previously saved research.

Hosted mode does not currently support Yahoo Finance, SEC EDGAR, FRED, TradingView, Brave, Exa, LSE, X, Reddit, or other providers that require a proxy, native process, desktop cookie, or browser-blocked request. It does not run alerts, reports, or model work after every OpenCandle tab closes.

Chat image and saved-state attachments are also unavailable in hosted mode. The attachment control is omitted rather than accepting content the browser runtime cannot pass to Pi. Use the local GUI for attachment-backed research.

## Keys and browser storage

During setup, choose whether the OpenAI key remains on the device or only for the current browser session. Restored keys are never filled back into the password field and are excluded from OpenCandle exports.

An open writer tab shares a session-only key transiently with its same-origin follower tabs so one of them can take over if the writer closes. The key is not written to durable OpenCandle state, and closing the final tab removes it.

Browser storage is not a secure vault. Same-origin script compromise, a malicious browser extension, physical access to the browser profile, or a compromised dependency could expose a saved key. Use session-only storage on shared devices and use the hosted status menu to clear the model key when needed.

## Data control and recovery

Open the hosted status menu in the lower-right corner:

- **Export data** downloads one versioned JSON archive containing Pi sessions and SQLite state, but no model key.
- **Import data** validates archive version, filenames, session identities, parent relationships, sizes, SQLite integrity, and supported schema version before stopping the runtime or replacing device data.
- **Clear model key** removes persistent and session-only credentials, tears down the in-browser runtime so the old process cannot retain the key, and restarts without deleting research.
- **Clear all** removes credentials, sessions, market state, runtime snapshots, and cached application data for this origin.

Imports and installed updates preserve a recovery backup before replacing or migrating durable state. An older OpenCandle build refuses to open a database written by a newer schema instead of resetting it. An installed update waits while any runtime request is active, checkpoints the current session, writes a recovery backup, and only then activates the waiting service worker.

If the writer tab closes while a follower action is in flight, the follower fails that action promptly rather than replaying an operation whose completion is unknown. Check the current state, then retry it in the newly promoted writer tab.

## Offline behavior

The service worker caches the static application shell, not model responses, provider responses, keys, or mutable runtime traffic. While offline, saved transcripts and market state remain readable and exportable. Research and saved-state mutations are disabled with an explicit offline message.

## Move a session to local OpenCandle

Hosted exports retain the upstream Pi JSONL format and OpenCandle's SQLite schema. Export the browser archive before switching devices or clearing browser data. Extract a session's JSONL content from the archive before opening it with local OpenCandle; the entries require no format translation, but browser and local storage are not live-synchronized.
