---
title: Configuration
description: Environment variables, file config, state paths, and GUI runtime settings.
---

# Configuration

This page applies to the local GUI and terminal; the web app keeps its settings in the browser (see [How the Web App Works](./how-the-web-app-works.md)).

OpenCandle reads configuration from three places:

1. A `.env` file in the current working directory loaded at startup.
2. Process environment variables.
3. The OpenCandle JSON config file at `$OPENCANDLE_HOME/config.json`.

The default OpenCandle home is `~/.opencandle`. Set `OPENCANDLE_HOME` to move user state and file config elsewhere. Relative `OPENCANDLE_HOME` values are resolved to absolute paths from the current working directory.

## Precedence

At startup, OpenCandle fills `process.env` from `.env` only for keys not already exported in the shell, which is conventional dotenv behavior. Environment values are then read before file config values.

Effective precedence:

1. Already-exported process environment variables.
2. Values from `.env` for keys not exported in the shell.
3. `$OPENCANDLE_HOME/config.json`.
4. Built-in defaults.

For provider API keys, env wins over JSON config. `OPENCANDLE_HOME`, `OPENCANDLE_GUI_HOST`, `OPENCANDLE_GUI_PORT`, `OPENCANDLE_GUI_ALLOW_REMOTE_PRIVATE_API`, `OPENCANDLE_NOTIFICATION_WEBHOOK_URL`, and developer diagnostic switches are env-only.

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
| `EXA_API_KEY` | unset | Upgrades Exa search from its keyless MCP endpoint to the direct Exa API (better quality/limits). Overrides `providers.exa.apiKey`. |
| `FINNHUB_API_KEY` | unset | Finnhub company news for sentiment summaries. Overrides `providers.finnhub.apiKey`. |
| `LSE_API_KEY` | unset | London Strategic Edge free-tier key for financial statements and intraday/deep-range history fallbacks. Overrides `providers.lse.apiKey`. |
| `OPENCANDLE_HOME` | `~/.opencandle` | Directory for OpenCandle config and local state. |
| `OPENCANDLE_GUI_HOST` | `127.0.0.1` | GUI bind host. Set `0.0.0.0` only when you intentionally want LAN/Tailscale access. |
| `OPENCANDLE_GUI_ALLOW_REMOTE_PRIVATE_API` | unset | Allow the GUI's private market-state API to accept cookie-authenticated requests from non-loopback peers. Set `1` only together with an intentional `OPENCANDLE_GUI_HOST` network bind. |
| `OPENCANDLE_GUI_PORT` | `14567` | GUI HTTP/WebSocket port. |
| `OPENCANDLE_NOTIFICATION_WEBHOOK_URL` | unset | Optional local webhook target for alert/report notification delivery attempts. In-app notifications are still recorded first. |
| `OPENCANDLE_EXTERNAL_TOOL_BIN_DIR` | unset | Extra directory searched for the `rdt`/`twitter` sentiment CLI shims, alongside `UV_TOOL_BIN_DIR` and `XDG_BIN_HOME`. |

### Advanced Developer Diagnostics

These settings are for debugging request understanding and tool availability. Keep the defaults for normal use.

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENCANDLE_ROUTER_MODE` | `llm` | Request-understanding mode. The LLM router is the only production routing path; the removed `rules` value and any other value fail startup config loading. |
| `OPENCANDLE_TOOL_SCOPE_MODE` | `observe` | Tool-scope diagnostic mode. `observe` records selected bundles and active-tool candidates; `enforce` applies Pi active tools for each turn. Invalid values fail startup config loading. |
| `OPENCANDLE_PLANNING_MIGRATION_STATUSES` | unset | Comma-separated planning rollout overrides in `task_family=status` form, for example `single_asset_decision=dual_run,asset_compare=observe_only`. Invalid entries fail startup config loading. |
| `OPENCANDLE_AUTOMATION_HEARTBEAT_MS` | `60000` | GUI automation heartbeat interval in milliseconds. Values below `5000` or invalid values fall back to the default. |

## Health and Automation Commands

Run `opencandle monitor` to keep local alert/report automations active from a foreground terminal process without opening the GUI. Use `opencandle monitor --once` for a single local automation heartbeat.

Run `opencandle doctor` to check OpenCandle health, including runtime, `OPENCANDLE_HOME`, config parsing, model readiness, provider readiness, public Yahoo reachability, and external-tool install status for Reddit and Twitter/X sentiment. It exits 1 when health is blocked and 0 when health is degraded or ready. Use `opencandle doctor --json` for automation, `opencandle doctor --full` to include GUI reachability, and `opencandle doctor --sessions` only when you explicitly want Reddit and Twitter/X browser-session checks that may read browser cookies or trigger platform permission prompts. The GUI exposes the same report in Settings, then Diagnostics, at `/settings/diagnostics`.

## File Config

`$OPENCANDLE_HOME/config.json` stores provider keys saved by `/connect` or by Settings, then Data providers, in the GUI. Supported fields:

```json
{
  "providers": {
    "alphaVantage": { "apiKey": "..." },
    "fred": { "apiKey": "..." },
    "brave": { "apiKey": "..." },
    "exa": { "apiKey": "..." },
    "finnhub": { "apiKey": "..." },
    "lse": { "apiKey": "..." }
  },
  "sentiment": {
    "retentionDays": 30,
    "defaultSubreddits": ["wallstreetbets", "stocks", "investing", "options"],
    "commentsPerPost": 5,
    "divergenceThreshold": 0.4,
    "minUsefulSampleSize": 10,
    "maxInsightDriversPerPolarity": 3,
    "maxRepresentativeItemsPerSource": 5,
    "maxAggregateRepresentativeItems": 8,
    "maxNotableClaims": 5
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
| `state.db` | SQLite store for memory/workflow rows plus user market state: instruments, aliases, watchlists, portfolio lots, alert rules/events, report history, and import provenance. |
| `sentinel.db` | Sentiment trend store. |
| `lse-byte-budget.json` | Monthly London Strategic Edge free-tier usage meter; LSE drops out of fallback chains at 80% of the allowance. |

Durable market state, including watchlists, portfolios, and alerts, lives only in `state.db`. There is no JSON-file alternative for that state.

Pi runtime config and sessions remain separate under Pi's own agent directory. OpenCandle does not move Pi state into `$OPENCANDLE_HOME`.

## GUI Runtime

Run the GUI with `opencandle gui` (installed package) or `npm run gui` (source checkout).

By default it listens on `http://127.0.0.1:14567`. The health endpoint is:

```bash
curl http://127.0.0.1:14567/health
```

It returns `{"ok":true,...}` when the server is running; you can ignore the other fields.

If you run the terminal and the GUI at once, OpenCandle makes sure only one of them applies a given action; the other briefly shows a syncing state. If OpenCandle is starting or switching sessions, actions may briefly return a syncing/reconnecting response.
