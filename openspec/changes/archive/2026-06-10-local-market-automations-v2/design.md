# Design — `local-market-automations-v2`

## 1. What To Steal From LangAlpha

LangAlpha's automation design has several ideas worth copying:

- automation records are first-class, not hidden inside prompts;
- due work is claimed before execution;
- executions have history and status;
- manual trigger and CRUD live beside scheduled execution;
- repeated failures can disable a rule;
- delivery is modeled separately from execution;
- price-triggered automations have retrigger/cooldown semantics.

The pieces not to copy directly are the hosted assumptions: Postgres row locking, Redis dedupe, shared WebSocket market data, multi-instance workers, Slack/Discord workspace routing, and hosted-only delivery. OpenCandle should translate the pattern into local SQLite and local process ownership.

```text
LangAlpha hosted shape                 OpenCandle V2 local shape
──────────────────────                 ─────────────────────────
Postgres automations table       ───▶   SQLite automation/run tables
FOR UPDATE SKIP LOCKED           ───▶   SQLite transactional claim
Redis duplicate locks            ───▶   state.db lease + unique event keys
WebSocket price monitor          ───▶   provider-aware quote/history polling
Slack/Discord delivery           ───▶   in-app + desktop + webhook/chat adapters
server keeps running             ───▶   honest "while OC is running" status
```

## 1.1 What To Steal From OpenClaw

OpenClaw is the closer architectural reference for OpenCandle because it is also a local-first app with a long-running local runtime. The important distinction in its docs is that heartbeat, scheduled jobs, and task history are separate concepts:

- heartbeat is an approximate periodic main-session turn;
- scheduled jobs are precise local jobs run by the local Gateway process;
- task records are the activity ledger for detached work, not the scheduler;
- delivery can be direct, webhook, silent, or queued into the next heartbeat;
- heartbeats defer while cron/scheduled lanes are busy;
- users can manually wake or run jobs on demand;
- status/audit commands expose active, failed, timed-out, lost, and delivery-failed work;
- local provider preflight can skip a run cleanly before spending model/provider budget.

For OpenCandle, the equivalent should be market-specific and smaller:

```text
OpenClaw concept                 OpenCandle V2 translation
────────────────                 ─────────────────────────
Gateway process            ───▶   active writer / foreground monitor
Heartbeat                  ───▶   approximate market-state monitor tick
Cron scheduled task        ───▶   local scheduled report/check template
Task ledger                ───▶   alert check runs, report runs, notifications
HEARTBEAT.md tasks block   ───▶   durable report/alert templates in state.db
Channel delivery           ───▶   in-app notification + optional local adapters
```

Do not copy OpenClaw's broad arbitrary-agent scheduler in V2. OC should use this shape for known market jobs: alert checks and report generation.

## 2. Local Runtime Model

OpenCandle V2 should support two local runner shapes with the same service:

```text
                    ┌────────────────────────────┐
                    │ ~/.opencandle/state.db      │
                    │ alerts / reports / runs     │
                    │ notifications / leases      │
                    └──────────────┬─────────────┘
                                   │
                         local automation service
                                   │
              ┌────────────────────┴────────────────────┐
              │                                         │
      GUI/TUI writer heartbeat                  future monitor command
      runs while app is open                    foreground local process
```

V2 should begin with the active writer heartbeat because it fits the current GUI/TUI writer/follower model. A later `opencandle monitor` command can be a thin wrapper over the same service and should not require new alert/report semantics.

The local runner is OC's equivalent of OpenClaw's Gateway. It is not a hosted scheduler. If no local process is running, no alert/report work is actively monitored.

Runner ownership should be single-owner and explicit. The current GUI/TUI writer lock determines which interactive surface is allowed to mutate session state, but the automation runner lease determines which local process may evaluate scheduled market jobs and spend provider budget. In the initial V2 path, the active writer should normally acquire the runner lease. A future `opencandle monitor` may acquire the runner lease when no writer owns it. If a writer and monitor are both present, only the lease holder evaluates due work; the loser renders state and may request manual work through SQLite rather than issuing its own provider calls.

Short-lived monitor invocations such as `opencandle monitor --once` should release their runner lease on clean completion so a follow-up GUI/TUI writer or restarted monitor does not wait for the full lease TTL. Long-running monitor processes should also release on clean shutdown when possible; stale/lost maintenance remains the fallback for crashes.

This also defines "shared provider budget" for V2: scheduled alert/report market-data requests are shared by routing them through the single runner lease holder. The in-memory cache and token buckets remain process-local implementation details. Follower GUI/TUI processes must read persisted runner/check/notification state and must not start independent polling loops.

The UI must label runner state plainly:

- **Running locally** — an active writer or monitor process is checking due work.
- **Manual only** — rules exist, but no local runner is active.
- **Missed while closed** — due time passed while no runner held ownership.
- **Needs provider** — the rule cannot run because required data inputs are unavailable.

## 3. Storage Shape

The existing V1 state model already has `alert_rules`, `alert_events`, `report_templates`, and `report_runs`. V2 should add runtime state around those records rather than replacing them.

```text
automation_runner_leases
  id, owner_id, owner_kind, acquired_at, heartbeat_at, expires_at

alert_check_runs
  id, started_at, completed_at, status,
  checked_count, triggered_count, unavailable_count,
  owner_id, error_json

report_runs                         # existing V1 table, extended as needed
  id, template_id, trigger_type, scheduled_for,
  started_at, completed_at, status,
  result_summary_json, error_json, owner_id

notification_events
  id, source_type, source_id, severity,
  title, body, payload_json,
  status, created_at, acknowledged_at

notification_delivery_attempts
  id, notification_event_id, channel,
  status, attempted_at, completed_at,
  response_json, error
```

V2 should prefer type-specific ledgers: `alert_check_runs` for batched/high-frequency alert checks and the existing `report_runs` ledger for scheduled or manual report generation. Do not add a generic prompt-running automation engine until there is a clear OC use case. LangAlpha's "agent executes arbitrary instruction" is powerful, but for OpenCandle V2 the highest-value jobs are market-state jobs with known inputs and predictable output.

OpenClaw's "task records are not schedulers" distinction should carry over. In OC, templates and alert rules decide what is due; run/check rows record what happened. A heartbeat tick that finds nothing due may update runner heartbeat metadata without creating a noisy run row.

## 4. Claiming, Idempotency, And Cooldowns

SQLite can still support local-safe claiming if the service claims due work inside a write transaction and records the runner owner. V2 should not require Redis.

For alert triggers:

- crossing semantics still depend on `last_observed_json`;
- alert rules should persist a normalized `last_condition_state` such as `true`, `false`, or `unknown` so re-arm behavior does not depend on provider-specific payloads;
- cooldown still depends on `last_triggered_at`;
- lifecycle should be explicit: `active`, `paused`, `completed`, and `needs_review` are enough for V2;
- retrigger behavior should be explicit: `once` completes after the first trigger, while `recurring` can notify again only after the condition re-arms and cooldown permits it;
- event creation should use a deterministic dedupe key based on `rule_id`, `rule_revision`, `arm_cycle_id`, trigger source, and observed timestamp/value bucket;
- notification creation should be linked to the alert event so a retry does not create a second user-visible notification.

`rule_revision` should increment when the user edits the condition. `arm_cycle_id` should increment when a recurring crossing rule re-arms after a valid false observation. Dedupe must not collapse a legitimate second trigger after re-arm just because the threshold and time bucket are similar.

When an alert fires, the transaction should update all observable state together:

```text
alert_rules
  last_checked_at
  last_observed_json
  last_condition_state = true
  last_triggered_at
  status = completed        # only for one-shot rules

alert_events
  status = triggered | triggered_late
  trigger_source = heartbeat | scheduled | manual | resume
  observed_at             # when OC evaluated/observed the condition
  provider_data_at        # provider-supplied quote/bar timestamp, if available
  source_provider
  cache_status
  data_delay_ms
  observed_value_json
  message

notification_events
  source_type = alert_event
  source_id = alert_events.id
```

If OC was closed while the condition may have crossed, V2 should be useful but honest. On resume, OC cannot prove every intraday crossing from a current quote alone. The default resume policy should be:

- if prior persisted state was `false` and the current evaluated condition is `true`, emit a `triggered_late` alert with `trigger_source = "resume"` and copy that says OC observed the condition on resume;
- if prior state was `true` and current state is still `true`, do not notify again because the rule never re-armed while OC was observing;
- if prior state was `unknown`, seed observation state and do not notify;
- if the provider can reconstruct the missed interval from historical bars, the evaluator may use that evidence and store it in `observed_value_json`, but V2 must not invent a crossing from unavailable history.

Recurring alerts should re-arm only when an observed check sees the condition return to `false`. A second `true` observation while the condition remained true is a suppressed check, not a new trigger. This is the TradingView-like behavior users usually expect: an alert either fires once and completes, or fires again only after the condition resets and crosses again.

For scheduled reports:

- report templates store user-local schedule intent;
- the runner computes due runs from `next_run_at`;
- missed runs should be recorded or surfaced as missed, not silently skipped;
- the user can manually trigger a run even when the scheduler is inactive.

## 5. Provider Capability Contract

LangAlpha's price monitor relies on a real-time WebSocket feed. OpenCandle should not require that for V2. The local provider contract should be capability-based:

```text
condition type          minimum provider inputs
──────────────          ───────────────────────
price cross             current quote
percent move            quote + previous close or day open
SMA cross/price vs SMA   historical OHLCV bars
RSI threshold           historical OHLCV bars
volume spike            historical volume bars
```

Provider-backed conditions should be accepted only when the current provider set can supply the required inputs for the instrument and timeframe. If a rule later becomes unsupported because provider credentials/rate limits/data are unavailable, evaluation should record an unavailable run/event and keep the rule enabled but marked degraded or needs-review.

V2 should describe freshness honestly. Yahoo-backed polling can make OpenCandle materially more useful, but it is delayed/best-effort monitoring, not guaranteed real-time execution.

## 5.1 Provider Budgets And Polling Cadence

Provider capacity must be treated as a runtime budget, not a fixed promise. Yahoo Finance is an unofficial source with undocumented and changeable limits. The existing OC code has an internal Yahoo bucket of `5 req/s` and a 60-second quote cache, but that is only OC's self-throttle. It is not evidence that Yahoo will allow sustained local polling at that rate.

OpenCandle now also has a keyless TradingView scanner provider. Its `getQuotes(symbols)` path is materially better for local alert monitoring over many supported watchlist symbols because it resolves bare US primary stock/fund/DR symbols through TradingView's scanner and fetches many quotes in a batch request. Qualified `EXCHANGE:TICKER` symbols can also use the scanner path. Crypto suffixes, foreign Yahoo-style suffixes, OTC/unsupported instrument types, and unresolved symbols should fall back to Yahoo or another capable provider. TradingView remains unofficial and delayed, so it is not a real-time feed, but it is a better V2 default than fanning out one Yahoo quote request per alert for batch-friendly, delayed-data-acceptable equity monitoring.

For V2, the runner should assume a conservative market-data budget:

- group due checks by provider, timeframe, and required data shape;
- prefer batch quote requests when a provider supports them;
- never fetch the same symbol more often than the quote freshness window for the same provider;
- jitter checks across the minute instead of firing all symbols at exactly `:00`;
- apply exponential backoff on `429`, network failures, and provider anomaly responses;
- degrade cadence before disabling alerts;
- surface `rate_limited` or `provider_budget_exhausted` in run/check history.

The default quote cadence should be "best effort around one minute" for small watchlists, not "guaranteed every minute." The default heartbeat wake can be about 60 seconds for due price alerts, with jitter and provider-budget deferral; users may configure slower cadences, but faster cadences require a provider that explicitly supports them. For supported TradingView symbols whose rules accept delayed scanner data, V2 should prefer TradingView batch quotes before Yahoo fallback. Ten or even 100 supported symbols can be one scanner request when they fit TradingView's batch path, which is far more realistic than 10-100 Yahoo requests per minute. It is still not a service guarantee because TradingView is unofficial and can be delayed/rate-limited. Larger watchlists, indicator alerts, or multiple OC surfaces must be scheduled through the single runner owner so they do not multiply requests.

Indicator alerts should avoid minute-level historical calls. SMA, RSI, and volume-spike alerts can usually share cached daily OHLCV bars; they should run on a daily-bar cadence unless a future intraday provider explicitly supports faster history. If the same symbol has both a price alert and a daily indicator alert, the price alert can be evaluated on the quote heartbeat while the indicator alert reuses daily history cache and is not refetched every minute. Price alerts are the only V2 alert class that should default toward minute-ish polling, and for supported equities they should prefer TradingView batch snapshots when delayed-data semantics are acceptable. Yahoo remains useful for crypto-style suffixes, unsupported symbols, latency-sensitive price rules, and fallback when TradingView is unavailable.

LangAlpha's practical answer to provider limits is not "retry Yahoo harder." Its price-monitor path prefers a dedicated `ginlix-data` WebSocket stream, uses batched REST snapshots as fallback, and routes market data through an ordered provider chain (`ginlix-data` -> FMP -> yfinance when configured). It also treats yfinance as a free/self-hosted fallback, not the foundation for reliable price-trigger automation.

OpenCandle should copy the pattern, locally:

```text
alert evaluator
      │
      ▼
market data budget manager
      │
      ├─ TradingView batch scanner quotes                 preferred for supported delayed-data rules
      ├─ provider with batch quotes / explicit limits     preferred when configured
      ├─ Yahoo direct quote path                          best-effort fallback
      └─ stale cache / unavailable event                  when provider is budget-exhausted
```

For Yahoo specifically, repeated `429` should trip a provider circuit breaker. While the breaker is open, OC should stop trying minute checks against Yahoo, evaluate with still-fresh cache when allowed, and record checks as `rate_limited` or `provider_budget_exhausted` once data is no longer fresh. A user with Yahoo-only data can still use alerts, but the UI should say "best effort; currently rate-limited" rather than silently falling behind.

Symbol-specific Yahoo failures such as invalid, delisted, or no-data symbols must not open the shared Yahoo provider circuit. Those should mark only the affected rule/check unavailable. Provider budget backoff should be reserved for provider-wide failures such as `429`, transport failures, and timeouts so one bad ticker does not suppress unrelated valid alerts.

The strategic V2 implementation choice should be: build the alert runner against a provider-neutral snapshot interface first. TradingView can back supported equity watchlists in batch for local best-effort monitoring, Yahoo can fill unsupported/unresolved or latency-sensitive symbols, and serious minute-ish monitoring should still prefer a provider with explicit limits or a contractual data feed when available.

Interactive TradingView tools such as stock screening share the same process-local limiter as monitoring. The monitoring lane should treat user-initiated screens as budget pressure and defer or mark due checks as delayed rather than starving interactive requests or silently exceeding the provider budget.

## 6. Notifications And Delivery

Notifications should be internal-first:

```text
alert/report run
      │
      ▼
notification_events row
      │
      ├─ GUI notification center
      ├─ TUI notification list/status line
      ├─ desktop notification adapter
      ├─ webhook adapter
      └─ future Telegram/WhatsApp adapter
```

Every user-visible alert should create an in-app notification event. Optional channels then create delivery attempts. This keeps GUI/TUI useful even when a desktop or chat adapter fails.

Delivery adapters should be local plugins/config, not hosted infrastructure:

- desktop notifications use OS-local APIs where available;
- webhook posts to a user-provided URL and stores attempts/results;
- Telegram/WhatsApp remain adapter-shaped but deferred until credential/config UX exists.

Delivery failures should not rewrite execution truth. A report can succeed even if webhook delivery fails; the delivery attempt records that failure and the in-app notification remains available.

Delivery adapters must be bounded and fair. A webhook endpoint that accepts a connection but never responds should time out, record a failed delivery attempt, and let the local automation heartbeat continue. A backlog of failed webhook notifications should also be capped per heartbeat pass, leaving remaining events pending for later delivery attempts rather than monopolizing the local runner. Retry selection should prefer never-attempted and least-recently-attempted notifications so persistent failures do not permanently starve older or newer events.

## 6.1 Heartbeat Versus Scheduled Work

V2 should preserve the OpenClaw-style split:

- use heartbeat for approximate, batched monitoring such as "check due alerts every N minutes while OC is open";
- use scheduled report templates for exact user-local times such as "morning report at 9 AM";
- use manual wake/check commands for on-demand runs;
- use run/check history for audit, not as the source of scheduling truth.

This avoids turning OC into a hosted scheduling product while still giving users practical local automations. Exact schedules are exact only relative to a running local OC runner; if the process is closed, the next runner should mark the run late/missed or execute according to template policy.

## 7. GUI/TUI Feature Parity

Both surfaces should expose the same jobs and state, even if the controls look different.

Required V2 surface concepts:

- runner status and last heartbeat;
- "Check alerts now";
- "Run daily report now";
- pause/resume alert rule;
- recent alert events and notifications;
- recent report runs;
- delivery status for each notification;
- clear copy when monitoring only happens while OC is running.

The GUI can use pages/tabs; the TUI can use commands, menus, and lists. They should call the same market automation service.

## 8. V2 / V3 Boundary

V2 should make OpenCandle much better for a local user without pretending to be a cloud service.

Implemented in V2:

- active-writer heartbeat;
- manual trigger;
- run history;
- provider-aware polling;
- in-app notifications;
- webhook delivery through `OPENCANDLE_NOTIFICATION_WEBHOOK_URL` with persisted attempts/results;
- foreground local `opencandle monitor` command as a thin wrapper over the same local automation service.
- local scheduled report/check templates that run only under an active local runner.

Push to V3:

- OS scheduler installation helpers;
- always-on daemon/service management;
- desktop notifications and Telegram/WhatsApp production adapters;
- broker sync and credentials;
- hosted WebSocket fanout;
- arbitrary prompt automations.
- generic multi-step task-flow orchestration beyond market reports/checks.
