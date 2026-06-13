## 1. Runtime model and schema

- [x] 1.1 Use type-specific run ledgers for V2: `alert_check_runs` for batched alert checks and the existing `report_runs` ledger for scheduled/manual reports.
- [x] 1.2 Add SQLite schema for runner leases, automation/check runs, notification events, and delivery attempts.
- [x] 1.3 Add transactional claim helpers for due alert checks and due report templates.
- [x] 1.4 Add idempotency/dedupe keys for alert events and notification events.
- [x] 1.5 Keep scheduling source-of-truth in alert rules/report templates; use run/check tables as the activity ledger.
- [x] 1.6 Define retention and maintenance behavior for stale/lost/old run and notification rows.
- [x] 1.7 Add alert lifecycle/retrigger fields or equivalent state for status, retrigger mode, latest condition state, latest trigger source, and latest re-arm observation.
- [x] 1.8 Add `rule_revision` and `arm_cycle_id` or equivalent dedupe inputs so recurring alerts can trigger again after re-arm without being collapsed by an old dedupe key.
- [x] 1.9 Add alert/check observation metadata for `observed_at`, provider data timestamp when available, source provider, cache/stale status, and provider delay/caveat details.

## 2. Local runner service

- [x] 2.1 Implement a local automation service shared by GUI, TUI, and future monitor command.
- [x] 2.2 Add active-writer heartbeat evaluation with lease renewal and graceful shutdown.
- [x] 2.3 Ensure follower GUI/TUI processes cannot evaluate due rules.
- [x] 2.4 Add manual trigger paths that use the same run/check history as heartbeat execution.
- [x] 2.5 Add local scheduled report/check execution for due templates while a local runner is active.
- [x] 2.6 Add busy-lane deferral so heartbeat checks do not compete with an already-running report/check.
- [x] 2.7 Add late/missed/check-on-resume policy for work due while OC was closed.
- [x] 2.8 Define writer-lock versus runner-lease precedence, including foreground monitor ownership, clean monitor lease release, and what happens when writer and monitor processes coexist.
- [x] 2.9 Add follower manual-request behavior: enqueue durable request for the runner owner or disable controls with explanatory status.

## 3. Alert evaluation hardening

- [x] 3.1 Add provider capability checks for quote, previous close/day open, OHLCV history, and volume history.
- [x] 3.2 Gate price, percent-move, SMA, RSI, and volume-spike alerts on those capabilities.
- [x] 3.3 Add one-shot/recurring/cooldown state and user-visible suppressed-check reasons.
- [x] 3.4 Record unavailable checks for stale, missing, rate-limited, or invalid provider data.
- [x] 3.5 Implement resume semantics: false-to-true on resume emits a late trigger, true-to-true suppresses duplicates, unknown seeds state, and historical reconstruction is labeled as late/reconstructed.
- [x] 3.6 Ensure alert firing updates rule state, alert event, and notification event atomically.
- [x] 3.7 Ensure recurring crossing alerts re-arm only after a valid false observation and cooldown permits.
- [x] 3.8 Add provider budget scheduling for alert checks: batching where supported, per-provider cache freshness, jitter, rate-limit backoff, deferred checks, and user-visible budget exhaustion reasons.
- [x] 3.9 Ensure indicator alerts share cached history and do not refetch daily bars every minute.
- [x] 3.10 Add provider-level circuit breaker semantics for repeated 429/rate-limit responses without letting symbol-specific no-data failures open the shared provider circuit.
- [x] 3.11 Add provider-chain observation metadata so alert events/check runs record primary provider, fallback provider, cache use, and all-provider failure reasons.
- [x] 3.12 Prefer batch quote/snapshot providers for monitoring and treat Yahoo one-symbol quote polling as best-effort fallback.
- [x] 3.13 Use TradingView `getQuotes(symbols)` as the preferred batch quote path for supported delayed-data alert/watchlist checks, with Yahoo fallback for unsupported, unresolved, or latency-sensitive symbols.
- [x] 3.14 Persist TradingView delayed/unofficial-data caveats and cache/stale status in alert check metadata when TradingView observations are used.
- [x] 3.15 Centralize TradingView eligibility and skip/partition logic in the provider layer so watchlist checks and alert evaluation do not duplicate suffix/type heuristics.
- [x] 3.16 Add rule/provider freshness policy so delayed TradingView data is used only for alerts that permit delayed scanner observations; latency-sensitive rules choose Yahoo or another suitable provider when available.
- [x] 3.17 Account for interactive TradingView screens in the monitoring budget so user-initiated screens can delay heartbeat checks without causing duplicate fanout or budget overruns.
- [x] 3.18 Ensure mixed price and indicator alerts on the same symbol share quote/history observations without minute-level historical refetches.

## 4. Notifications and delivery

- [x] 4.1 Add in-app notification events for alert triggers and report outcomes.
- [x] 4.2 Add notification acknowledgment/read state.
- [x] 4.3 Assess desktop notification adapter and defer it for V2 because local OS notification support would introduce platform-specific code; in-app notifications and webhook delivery are implemented.
- [x] 4.4 Add bounded webhook delivery adapter with persisted attempts/results, per-request timeout, and per-pass cap so delivery hangs/backlogs cannot block the local runner.
- [x] 4.5 Keep Telegram/WhatsApp adapters documented but deferred until credential/config UX is designed.
- [x] 4.6 Keep run/check outcome separate from delivery outcome.

## 5. GUI/TUI parity

- [x] 5.1 Add GUI runner status, recent runs, notifications, and delivery status.
- [x] 5.2 Add equivalent TUI commands/menus for runner status, manual check, notification history, pause/resume, and report run.
- [x] 5.3 Ensure both surfaces display "manual only", "running locally", "missed while closed", and "needs provider" states consistently.
- [x] 5.4 Add audit/status views for active, stale/lost, failed, skipped/unavailable, and delivery-failed automation work.

## 6. Verification

- [x] 6.1 Unit test due claiming, lease expiry, duplicate suppression, cooldown behavior, and notification delivery retries.
- [x] 6.2 Harness test: create alert, start heartbeat, simulate crossing, verify alert event and notification.
- [x] 6.3 Harness test: schedule daily report, run heartbeat, verify report run and notification.
- [x] 6.4 Live GUI test: runner status and notification center update while OC is running.
- [x] 6.5 Live TUI test: equivalent status/history/manual trigger flows.
- [x] 6.6 Run `npm test`, `npm run build`, and `graphify update .` after implementation.
- [x] 6.7 Unit test alert resume scenarios: prior false/current true, prior true/current true, prior unknown/current true, and reconstructed historical crossing.
- [x] 6.8 Unit test provider budget behavior: shared quote observation, 429 backoff, deferred checks beyond budget, and no duplicate polling from follower surfaces.
- [x] 6.9 Unit test provider-chain monitoring: primary rate-limited, fallback succeeds; Yahoo-only rate-limited, check becomes degraded/unavailable; fresh cache used while circuit breaker is open; stale cache rejected.
- [x] 6.10 Unit test TradingView-backed alert checks: 100+ equity symbols share one batch observation, unsupported symbols fall back to Yahoo, TradingView 429 degrades/falls back without duplicate Yahoo fanout, and source/caveat metadata is recorded.
- [x] 6.11 Unit test runner ownership edge cases: writer owns runner, monitor owns runner while no writer exists, follower manual request does not execute directly, and writer/monitor coexist without duplicate provider calls.
- [x] 6.12 Unit test delayed-data semantics: TradingView observations record provider delay metadata, delayed data is rejected for latency-sensitive rules, and resume checks ignore wall-clock drift without provider/condition evidence.
