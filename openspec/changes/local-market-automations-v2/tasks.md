## 1. Runtime model and schema

- [ ] 1.1 Decide whether V2 stores generic `automation_runs` plus type-specific `alert_check_runs`, or a smaller set of alert/report run tables only.
- [ ] 1.2 Add SQLite schema for runner leases, automation/check runs, notification events, and delivery attempts.
- [ ] 1.3 Add transactional claim helpers for due alert checks and due report templates.
- [ ] 1.4 Add idempotency/dedupe keys for alert events and notification events.
- [ ] 1.5 Keep scheduling source-of-truth in alert rules/report templates; use run/check tables as the activity ledger.
- [ ] 1.6 Define retention and maintenance behavior for stale/lost/old run and notification rows.
- [ ] 1.7 Add alert lifecycle/retrigger fields or equivalent state for status, retrigger mode, latest condition state, latest trigger source, and latest re-arm observation.

## 2. Local runner service

- [ ] 2.1 Implement a local automation service shared by GUI, TUI, and future monitor command.
- [ ] 2.2 Add active-writer heartbeat evaluation with lease renewal and graceful shutdown.
- [ ] 2.3 Ensure follower GUI/TUI processes cannot evaluate due rules.
- [ ] 2.4 Add manual trigger paths that use the same run/check history as heartbeat execution.
- [ ] 2.5 Add local scheduled report/check execution for due templates while a local runner is active.
- [ ] 2.6 Add busy-lane deferral so heartbeat checks do not compete with an already-running report/check.
- [ ] 2.7 Add late/missed/check-on-resume policy for work due while OC was closed.

## 3. Alert evaluation hardening

- [ ] 3.1 Add provider capability checks for quote, previous close/day open, OHLCV history, and volume history.
- [ ] 3.2 Gate price, percent-move, SMA, RSI, and volume-spike alerts on those capabilities.
- [ ] 3.3 Add one-shot/recurring/cooldown state and user-visible suppressed-check reasons.
- [ ] 3.4 Record unavailable checks for stale, missing, rate-limited, or invalid provider data.
- [ ] 3.5 Implement resume semantics: false-to-true on resume emits a late trigger, true-to-true suppresses duplicates, unknown seeds state, and historical reconstruction is labeled as late/reconstructed.
- [ ] 3.6 Ensure alert firing updates rule state, alert event, and notification event atomically.
- [ ] 3.7 Ensure recurring crossing alerts re-arm only after a valid false observation and cooldown permits.
- [ ] 3.8 Add provider budget scheduling for alert checks: batching where supported, per-provider cache freshness, jitter, rate-limit backoff, deferred checks, and user-visible budget exhaustion reasons.
- [ ] 3.9 Ensure indicator alerts share cached history and do not refetch daily bars every minute.
- [ ] 3.10 Add provider-level circuit breaker semantics for repeated 429/rate-limit responses.
- [ ] 3.11 Add provider-chain observation metadata so alert events/check runs record primary provider, fallback provider, cache use, and all-provider failure reasons.
- [ ] 3.12 Prefer batch quote/snapshot providers for monitoring and treat Yahoo one-symbol quote polling as best-effort fallback.
- [ ] 3.13 Use TradingView `getQuotes(symbols)` as the preferred batch quote path for equity-like alert/watchlist checks, with Yahoo fallback for unsupported or unresolved symbols.
- [ ] 3.14 Persist TradingView delayed/unofficial-data caveats and cache/stale status in alert check metadata when TradingView observations are used.

## 4. Notifications and delivery

- [ ] 4.1 Add in-app notification events for alert triggers and report outcomes.
- [ ] 4.2 Add notification acknowledgment/read state.
- [ ] 4.3 Add desktop notification adapter if it can be configured locally without introducing heavy platform-specific code.
- [ ] 4.4 Add webhook delivery adapter with persisted attempts/results.
- [ ] 4.5 Keep Telegram/WhatsApp adapters documented but deferred until credential/config UX is designed.
- [ ] 4.6 Keep run/check outcome separate from delivery outcome.

## 5. GUI/TUI parity

- [ ] 5.1 Add GUI runner status, recent runs, notifications, and delivery status.
- [ ] 5.2 Add equivalent TUI commands/menus for runner status, manual check, notification history, pause/resume, and report run.
- [ ] 5.3 Ensure both surfaces display "manual only", "running locally", "missed while closed", and "needs provider" states consistently.
- [ ] 5.4 Add audit/status views for active, stale/lost, failed, skipped/unavailable, and delivery-failed automation work.

## 6. Verification

- [ ] 6.1 Unit test due claiming, lease expiry, duplicate suppression, cooldown behavior, and notification delivery retries.
- [ ] 6.2 Harness test: create alert, start heartbeat, simulate crossing, verify alert event and notification.
- [ ] 6.3 Harness test: schedule daily report, run heartbeat, verify report run and notification.
- [ ] 6.4 Live GUI test: runner status and notification center update while OC is running.
- [ ] 6.5 Live TUI test: equivalent status/history/manual trigger flows.
- [ ] 6.6 Run `npm test`, `npm run build`, and `graphify update .` after implementation.
- [ ] 6.7 Unit test alert resume scenarios: prior false/current true, prior true/current true, prior unknown/current true, and reconstructed historical crossing.
- [ ] 6.8 Unit test provider budget behavior: shared quote observation, 429 backoff, deferred checks beyond budget, and no duplicate polling from follower surfaces.
- [ ] 6.9 Unit test provider-chain monitoring: primary rate-limited, fallback succeeds; Yahoo-only rate-limited, check becomes degraded/unavailable; fresh cache used while circuit breaker is open; stale cache rejected.
- [ ] 6.10 Unit test TradingView-backed alert checks: 100+ equity symbols share one batch observation, unsupported symbols fall back to Yahoo, TradingView 429 degrades/falls back without duplicate Yahoo fanout, and source/caveat metadata is recorded.
