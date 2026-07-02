---
title: Configuration
description: Environment variables, file config, state paths, and GUI runtime settings.
---

# Configuration

OpenCandle reads configuration from three places:

1. A `.env` file in the current working directory loaded at startup.
2. Process environment variables.
3. The OpenCandle JSON config file at `$OPENCANDLE_HOME/config.json`.

The default OpenCandle home is `~/.opencandle`. Set `OPENCANDLE_HOME` to move user state and file config elsewhere. Relative `OPENCANDLE_HOME` values are resolved to absolute paths from the current working directory.

## Precedence

Startup calls `loadEnv()` first, so values from `.env` are copied into `process.env`. The loader overwrites an existing key if the same key is already exported in the shell. Runtime config then resolves `process.env` before file config values.

Effective precedence:

1. Values from `.env`.
2. Already-exported process env for keys not set in `.env`.
3. `$OPENCANDLE_HOME/config.json`.
4. Built-in defaults.

For provider API keys and `OPENCANDLE_DEBATE`, env wins over JSON config. `OPENCANDLE_HOME`, `OPENCANDLE_GUI_HOST`, `OPENCANDLE_GUI_PORT`, and developer diagnostic switches are env-only.

## Environment Variables

Most users only need model credentials, optional data-provider keys, the OpenCandle home directory, and GUI host/port settings.

| Variable | Default | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | unset | Google model credential used by Pi model setup and the GUI setup panel. |
| `OPENAI_API_KEY` | unset | OpenAI model credential used by Pi model setup and the GUI setup panel. |
| `ANTHROPIC_API_KEY` | unset | Anthropic model credential used by Pi model setup and the GUI setup panel. |
| `ALPHA_VANTAGE_API_KEY` | unset | Fundamentals, earnings, financial statements, DCF, and comps. Overrides `providers.alphaVantage.apiKey`. |
| `FRED_API_KEY` | unset | FRED macro series. Overrides `providers.fred.apiKey`. |
| `BRAVE_API_KEY` | unset | Brave search in the web-search cascade. Overrides `providers.brave.apiKey`. |
| `EXA_API_KEY` | unset | Exa search. Overrides `providers.exa.apiKey`. |
| `FINNHUB_API_KEY` | unset | Finnhub company news for sentiment summaries. Overrides `providers.finnhub.apiKey`. |
| `OPENCANDLE_HOME` | `~/.opencandle` | Directory for OpenCandle config and local state. |
| `OPENCANDLE_DEBATE` | `true` | Enables adversarial bull/bear debate for comprehensive analysis. Set `false` or `0` to disable. |
| `OPENCANDLE_GUI_HOST` | `127.0.0.1` | GUI bind host. Set `0.0.0.0` only when you intentionally want LAN/Tailscale access. |
| `OPENCANDLE_GUI_ALLOW_REMOTE_PRIVATE_API` | unset | Allow the GUI's private market-state API to accept cookie-authenticated requests from non-loopback peers. Set `1` only together with an intentional `OPENCANDLE_GUI_HOST` network bind. |
| `OPENCANDLE_GUI_PORT` | `14567` | GUI HTTP/WebSocket port. |
| `OPENCANDLE_NOTIFICATION_WEBHOOK_URL` | unset | Optional local webhook target for alert/report notification delivery attempts. In-app notifications are still recorded first. |

Run `opencandle monitor` to keep local alert/report automations active from a foreground terminal process without opening the GUI. Use `opencandle monitor --once` for a single local automation heartbeat.

Run `opencandle doctor` to check OpenCandle health, including runtime, `OPENCANDLE_HOME`, config parsing, model readiness, provider readiness, public Yahoo reachability, and external-tool install status for Reddit and Twitter/X sentiment. Use `opencandle doctor --json` for automation, `opencandle doctor --full` to include GUI reachability, and `opencandle doctor --sessions` only when you explicitly want Reddit and Twitter/X browser-session checks that may read browser cookies or trigger platform permission prompts. The GUI exposes the same report on the Diagnostics page at `/diagnostics`.

### Advanced Developer Diagnostics

These settings are for debugging request understanding and tool availability. Keep the defaults for normal use.

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENCANDLE_ROUTER_MODE` | `rules` | Advanced request-understanding mode. Set `llm` to opt into the LLM router during development or eval runs. Invalid values fail startup config loading. |
| `OPENCANDLE_TOOL_SCOPE_MODE` | `observe` | Tool-scope diagnostic mode. `observe` records selected bundles and active-tool candidates; `enforce` applies Pi active tools for each turn. Invalid values fail startup config loading. |
| `OPENCANDLE_PLANNING_MIGRATION_STATUSES` | unset | Comma-separated planning rollout overrides in `task_family=status` form, for example `single_asset_decision=dual_run,asset_compare=observe_only`. Invalid entries fail startup config loading. |
| `OPENCANDLE_AUTOMATION_HEARTBEAT_MS` | `60000` | GUI automation heartbeat interval in milliseconds. Values below `5000` or invalid values fall back to the default. |

## File Config

`$OPENCANDLE_HOME/config.json` stores provider keys saved by `/connect` or the GUI provider setup flow. Supported fields:

```json
{
  "providers": {
    "alphaVantage": { "apiKey": "..." },
    "fred": { "apiKey": "..." },
    "brave": { "apiKey": "..." },
    "exa": { "apiKey": "..." },
    "finnhub": { "apiKey": "..." }
  },
  "debate": true,
  "sentiment": {
    "retentionDays": 30,
    "defaultSubreddits": ["wallstreetbets", "stocks", "investing", "options"],
    "commentsPerPost": 5,
    "divergenceThreshold": 0.4
  }
}
```

Sentiment keys are file-config only. Missing sentiment fields use the defaults shown above.

## OpenCandle Home State

All paths below are rooted at `$OPENCANDLE_HOME`:

| Path | Purpose |
| --- | --- |
| `config.json` | OpenCandle provider config and file-backed settings. |
| `onboarding.json` | Provider setup, snooze, never-ask, and welcome state. |
| `state.db` | SQLite store for memory/workflow rows plus user market state: instruments, aliases, watchlists, portfolio lots, prediction records, alert rules/events, report history, and import provenance. |
| `sentinel.db` | Sentiment trend store. |
| `logs/` | Reserved OpenCandle log directory. |

Watchlists, portfolios, and predictions are not loaded from `watchlist.json`, `portfolio.json`, or `predictions.json`. Those filenames are intentionally unsupported state sources; OpenCandle uses `state.db` for durable market state.

Pi runtime config and sessions remain separate under Pi's own agent directory. OpenCandle does not move Pi state into `$OPENCANDLE_HOME`.

## GUI Runtime

Run the GUI with:

```bash
npm run gui
```

By default it listens on `http://127.0.0.1:14567`. The health endpoint is:

```bash
curl http://127.0.0.1:14567/health
```

It returns `{"ok":true,...}` when the HTTP server is alive. The response also includes diagnostic role metadata that can help with support logs, but normal use should not require choosing a process role.

Chat runs, follow-up answers, supported tool actions, provider/model setup, and session management are coordinated through the active local session owner. If OpenCandle is starting, switching sessions, or recovering ownership, mutating actions may briefly return neutral syncing/reconnecting responses.

Only one local process applies a given session action at a time. A lock with a live process and fresh heartbeat stays authoritative; stale locks are recovered after the grace window.
