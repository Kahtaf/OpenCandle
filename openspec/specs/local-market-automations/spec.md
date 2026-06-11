# local-market-automations Specification

## Purpose
Defines local alert and report automation behavior for monitor heartbeats, provider budgets, durable run records, and notification delivery.
## Requirements
### Requirement: Local Runner Ownership Is Explicit

OpenCandle SHALL evaluate scheduled market automations only from a process that has acquired local runner ownership.

#### Scenario: Active writer runs heartbeat checks

- **WHEN** the GUI or TUI process holds the active writer role and local automation heartbeat is enabled
- **THEN** it may acquire the local runner lease
- **AND** it evaluates due alert checks and report templates while the process remains alive

#### Scenario: Monitor runs only when it owns the runner lease

- **WHEN** a foreground monitor process is running without an active GUI/TUI writer
- **THEN** it may acquire the local runner lease
- **AND** it evaluates due alert checks and report templates while the lease remains current

#### Scenario: Multiple runner candidates do not duplicate checks

- **WHEN** an active writer and a foreground monitor both exist
- **THEN** only the process with the current runner lease evaluates scheduled market jobs
- **AND** the other process renders state or records manual requests without issuing scheduled provider calls

#### Scenario: Follower process does not evaluate automations

- **WHEN** a GUI or TUI process is in follower/read-only mode
- **THEN** it SHALL display automation state and notifications
- **AND** it SHALL NOT evaluate due automations or create alert events

#### Scenario: Runner status is visible

- **WHEN** no process has a current runner lease
- **THEN** OpenCandle labels automation state as manual-only or not currently monitored
- **AND** it does not imply that minute-level checks are running in the background

### Requirement: Due Work Is Claimed And Recorded

OpenCandle SHALL claim due alert/report work transactionally and record execution history.

#### Scenario: Due alert check is claimed once

- **WHEN** two local processes attempt to check the same due alert rules
- **THEN** only the process that successfully claims runner ownership or the due check creates the user-visible events
- **AND** duplicate alert events are not emitted for the same persisted observation

#### Scenario: Alert check run records totals

- **WHEN** a runner checks enabled alert rules
- **THEN** OpenCandle records an alert check run with start time, completion time, status, checked count, triggered count, unavailable count, owner id, and error metadata when applicable

#### Scenario: Scheduled report run records history

- **WHEN** a due report template is run by the local runner
- **THEN** OpenCandle records an automation/report run with scheduled time, started time, completed time, status, summary metadata, and errors when applicable

#### Scenario: Manual trigger uses same history

- **WHEN** the user manually checks alerts or manually runs a daily report
- **THEN** OpenCandle records the same run/check history as the heartbeat runner
- **AND** the run is marked as manually triggered

### Requirement: Heartbeats And Scheduled Market Jobs Have Distinct Semantics

OpenCandle SHALL distinguish approximate heartbeat monitoring from exact local scheduled market jobs.

#### Scenario: Heartbeat tick has no due work

- **WHEN** the local heartbeat runner wakes and no alert/report work is due
- **THEN** OpenCandle may update runner heartbeat metadata
- **AND** it does not create a noisy user-visible task/run record just to say nothing happened

#### Scenario: Scheduled report is due

- **WHEN** a report template has a user-local scheduled time that is due while a local runner is active
- **THEN** OpenCandle claims and runs the report
- **AND** records report run history with the scheduled time and actual execution time

#### Scenario: Scheduled work is missed while closed

- **WHEN** a report or alert check becomes due while no local runner is active
- **THEN** the next runner/manual check can mark the work as late, missed, or checked-on-resume according to template policy
- **AND** OpenCandle does not claim the work ran at the original scheduled time

#### Scenario: User wakes local automation manually

- **WHEN** the user asks to check alerts now or run a report now
- **THEN** OpenCandle uses the same evaluator and run-history path as scheduled/heartbeat execution
- **AND** marks the trigger source as manual

#### Scenario: Follower requests manual work

- **WHEN** a follower GUI/TUI surface receives a user request to check alerts now or run a report now
- **THEN** OpenCandle either records a durable manual request for the runner owner to claim
- **OR** disables the control with runner-status copy explaining that only the runner owner can execute manual automation work
- **AND** it does not let the follower bypass runner ownership and directly evaluate due work

### Requirement: Notifications Are Durable And Delivery-Aware

OpenCandle SHALL create durable notification events for triggered alerts and report outcomes before attempting optional external delivery.

#### Scenario: Triggered alert creates in-app notification

- **WHEN** an alert rule triggers
- **THEN** OpenCandle records an alert event
- **AND** records a notification event linked to that alert event
- **AND** the GUI and TUI can display the notification from SQLite

#### Scenario: Delivery attempts are recorded

- **WHEN** a notification has configured delivery channels such as desktop or webhook
- **THEN** OpenCandle records a delivery attempt per channel
- **AND** stores success, failure, response metadata, or error text without deleting the original notification event

#### Scenario: Delivery retry does not duplicate notification

- **WHEN** a delivery adapter retries a failed notification
- **THEN** it creates another delivery attempt for the same notification event
- **AND** it does not create a second alert event or second in-app notification

#### Scenario: Delivery failure does not change run outcome

- **WHEN** an alert check or report run succeeds but webhook, desktop, or chat delivery fails
- **THEN** OpenCandle preserves the successful run/check status
- **AND** records the failed delivery attempt separately
- **AND** keeps the in-app notification available

#### Scenario: Chat adapters are optional

- **WHEN** Telegram, WhatsApp, or another chat adapter is not configured
- **THEN** OpenCandle keeps in-app notifications working
- **AND** marks the external channel as unavailable or unconfigured rather than failing the alert/report run

### Requirement: Provider Capabilities Gate Alert Monitoring

OpenCandle SHALL verify that enabled alert conditions have provider inputs needed for evaluation.

#### Scenario: Price alert requires quote data

- **WHEN** a user enables a price crossing alert
- **THEN** OpenCandle verifies that the instrument can be resolved and current quote data can be requested from an available provider

#### Scenario: Latency-sensitive price alert requires suitable source

- **WHEN** a user enables a price alert that requires low-latency or non-delayed data
- **THEN** OpenCandle chooses a provider that satisfies the rule freshness policy when one is available
- **AND** it does not silently satisfy that rule with delayed TradingView scanner data unless the rule permits delayed observations

#### Scenario: Indicator alert requires historical bars

- **WHEN** a user enables an SMA, RSI, or volume-spike alert
- **THEN** OpenCandle verifies that historical OHLCV data is available for the instrument and timeframe
- **AND** the rule is disabled or marked needs-review if required inputs are unavailable

#### Scenario: Provider outage records unavailable check

- **WHEN** a due alert cannot be evaluated because provider data is missing, stale, rate-limited, or otherwise unavailable
- **THEN** OpenCandle records the check as unavailable
- **AND** it does not fire the alert using guessed data
- **AND** it preserves the previous valid observation state

### Requirement: Provider Budgets Bound Alert Cadence

OpenCandle SHALL schedule alert checks through provider-specific budgets so local monitoring does not overwhelm unofficial or rate-limited providers.

#### Scenario: Small Yahoo-backed price watchlist checks approximately every minute

- **WHEN** a user has around 10 Yahoo-backed price alerts due every minute
- **THEN** OpenCandle may check them on an approximate minute cadence while a local runner is active
- **AND** it respects quote cache freshness, provider throttling, and jitter
- **AND** it does not present the cadence as guaranteed real-time monitoring

#### Scenario: Equity watchlist uses TradingView batch quotes

- **WHEN** a due alert check includes many TradingView-supported symbols whose rules permit delayed scanner observations
- **THEN** OpenCandle groups those symbols into a TradingView batch quote request where possible
- **AND** evaluates applicable price alerts from the shared batch observation
- **AND** records TradingView source and delayed/unofficial data caveats in check/event metadata

#### Scenario: TradingView eligibility is explicit

- **WHEN** OpenCandle routes symbols to the TradingView batch quote path
- **THEN** bare symbols are eligible only when they resolve as US primary stock, fund, or DR listings supported by the scanner
- **AND** qualified `EXCHANGE:TICKER` symbols may use the TradingView qualified-symbol path
- **AND** unsupported instrument types, unresolved symbols, crypto suffixes, foreign Yahoo-style suffixes, and other non-eligible symbols use another capable provider when available

#### Scenario: TradingView unsupported symbols fall back to Yahoo

- **WHEN** TradingView cannot resolve a symbol such as a crypto suffix, foreign Yahoo-style suffix, or unsupported listing
- **THEN** OpenCandle may evaluate that symbol through the Yahoo quote path
- **AND** the check history records that the symbol used Yahoo fallback rather than the TradingView batch source

#### Scenario: Delayed provider observation records timestamps

- **WHEN** OpenCandle evaluates an alert from a delayed or cached provider observation
- **THEN** the alert check/event metadata records when OC observed the condition
- **AND** records provider data timestamp, cache/stale status, source provider, and delay/caveat metadata when the provider exposes it

#### Scenario: Provider rate limit is hit

- **WHEN** Yahoo or another provider returns a rate-limit response such as HTTP 429 or equivalent provider anomaly
- **THEN** OpenCandle backs off further requests for that provider
- **AND** records affected checks as rate-limited, skipped, or unavailable with a clear reason
- **AND** keeps alert rules enabled unless the user disables them or the provider remains unavailable beyond configured policy

#### Scenario: Repeated provider rate limits open circuit breaker

- **WHEN** a provider repeatedly returns rate-limit responses within a configured window
- **THEN** OpenCandle opens a provider-level circuit breaker for alert monitoring
- **AND** stops scheduling fresh network checks through that provider until the backoff window expires
- **AND** displays provider-budget status in GUI and TUI

#### Scenario: Circuit breaker uses fresh cache before unavailable status

- **WHEN** a provider circuit breaker is open
- **AND** a cached quote or history observation is still within the rule's acceptable freshness window
- **THEN** OpenCandle may evaluate the rule from cached data and label the observation as cached
- **AND** when cached data is too stale, it records the check as rate-limited or provider-budget-exhausted rather than evaluating stale data as live

#### Scenario: Provider chain falls back from primary source

- **WHEN** a preferred market-data provider fails, is unavailable, or is budget-exhausted
- **THEN** OpenCandle may try the next configured provider that supports the required data shape
- **AND** the run/check history records which provider produced the observation or why all providers failed

#### Scenario: Yahoo-only monitoring is degraded after 429

- **WHEN** Yahoo is the only provider for an alert rule
- **AND** Yahoo is rate-limited
- **THEN** OpenCandle marks affected checks as degraded, delayed, or unavailable
- **AND** it does not continue hammering Yahoo at the original minute cadence
- **AND** GUI and TUI explain that monitoring is best-effort until Yahoo recovers or another provider is configured

#### Scenario: Batch quote provider is preferred for monitoring

- **WHEN** a configured provider supports batch quote snapshots
- **THEN** OpenCandle groups due symbols into batch requests where possible
- **AND** prefers that provider for alert monitoring over a one-request-per-symbol provider with undocumented limits

#### Scenario: TradingView rate limit is handled as provider degradation

- **WHEN** TradingView scanner requests are rate-limited or unavailable
- **THEN** OpenCandle may fall back to Yahoo for unresolved due symbols within the provider budget
- **AND** uses fresh or acceptable stale TradingView cache only when the rule permits cached observations
- **AND** records TradingView degradation separately from Yahoo fallback results

#### Scenario: Multiple alerts share one symbol

- **WHEN** multiple enabled alert rules need the same quote for the same symbol within the provider freshness window
- **THEN** OpenCandle fetches or reuses the quote once
- **AND** evaluates all applicable rules from that shared observation

#### Scenario: Multiple surfaces are open

- **WHEN** GUI and TUI are both open or multiple views request market state
- **THEN** scheduled automation provider requests are issued only by the runner lease holder
- **AND** follower surfaces read persisted observations, runs, and notifications from SQLite
- **AND** follower surfaces do not trigger independent duplicate polling

#### Scenario: Indicator alerts require historical data

- **WHEN** SMA, RSI, or volume-spike alerts are evaluated from daily OHLCV bars
- **THEN** OpenCandle reuses cached history within the configured freshness window
- **AND** it does not perform minute-level historical-data refetches unless a provider capability explicitly supports that cadence

#### Scenario: Mixed price and indicator alerts share scheduling safely

- **WHEN** the same symbol has both a price alert and a daily-bar indicator alert
- **THEN** OpenCandle may evaluate the price alert on the quote heartbeat cadence
- **AND** evaluates the indicator alert from cached daily history or a daily history refresh cadence
- **AND** it does not refetch historical bars every minute just because a price alert is also due

#### Scenario: Watchlist grows beyond budget

- **WHEN** the number of due alerts exceeds the current provider budget
- **THEN** OpenCandle staggers checks, lengthens cadence, or marks some checks deferred
- **AND** GUI and TUI show that monitoring is delayed by provider budget rather than silently implying all symbols are checked every minute

### Requirement: Cooldown And Retrigger Semantics Are User-Visible

OpenCandle SHALL expose whether an alert fires once, fires on crossing, or can retrigger after a cooldown.

#### Scenario: Alert fire updates rule, event, and notification state atomically

- **WHEN** an alert condition triggers
- **THEN** OpenCandle updates the rule's latest check time, latest valid observation, latest condition state, and latest trigger time in the same transaction that records the alert event
- **AND** records a durable notification event linked to the alert event
- **AND** marks a one-shot rule completed or disabled according to its lifecycle configuration

#### Scenario: One-shot alert completes after trigger

- **WHEN** a one-shot alert triggers
- **THEN** OpenCandle records the trigger event and notification
- **AND** the rule is marked completed or disabled according to its configured one-shot behavior

#### Scenario: Completed one-shot alert does not fire again

- **WHEN** a one-shot alert has already fired and is completed
- **THEN** future heartbeat, scheduled, or manual checks do not evaluate it as an enabled rule
- **AND** the user must duplicate, reset, or re-enable the rule to alert again

#### Scenario: Recurring crossing alert re-arms after condition turns false

- **WHEN** a recurring crossing alert has fired and a later valid check observes the condition is false
- **THEN** OpenCandle records the latest observation
- **AND** treats the rule as re-armed for a future true crossing after cooldown permits

#### Scenario: Recurring alert respects cooldown

- **WHEN** a recurring alert condition is true again before its cooldown expires
- **THEN** OpenCandle updates check metadata
- **AND** it does not create another trigger notification

#### Scenario: Still-true recurring alert does not repeatedly notify

- **WHEN** a recurring alert has fired and subsequent checks continue to observe the condition as true
- **THEN** OpenCandle records the checks and latest observations
- **AND** it does not create another alert event until a valid false observation re-arms the rule and a later true observation crosses again

#### Scenario: UI explains suppressed trigger

- **WHEN** a rule remains true but is suppressed by crossing semantics or cooldown
- **THEN** GUI and TUI history can show that the rule was checked but did not notify because it had not re-armed

### Requirement: Alert Resume Semantics Are Honest

OpenCandle SHALL distinguish missed local monitoring from observed alert triggers after the app resumes.

#### Scenario: App reopens and prior state was false

- **WHEN** OpenCandle was closed while an alert check became due
- **AND** the rule's last persisted valid condition state was false
- **AND** the first resume/manual/heartbeat check observes the condition as true
- **THEN** OpenCandle records a late trigger event with source `resume` or equivalent metadata
- **AND** the notification copy indicates that OC observed the condition on resume rather than monitored it at the exact crossing time

#### Scenario: App reopens and prior state was true

- **WHEN** OpenCandle was closed while an alert check became due
- **AND** the rule's last persisted valid condition state was true
- **AND** the first resume/manual/heartbeat check still observes the condition as true
- **THEN** OpenCandle updates stale/missed check metadata
- **AND** it does not emit a duplicate trigger because the condition did not re-arm while OC could observe it

#### Scenario: App reopens with unknown prior state

- **WHEN** OpenCandle was closed while an alert check became due
- **AND** the rule has no valid prior condition state
- **THEN** OpenCandle seeds the first valid observation
- **AND** it does not emit a trigger until a future observed false-to-true crossing

#### Scenario: Missed interval can be reconstructed from provider history

- **WHEN** a provider returns enough historical bars to determine that a condition crossed during an interval where OC was closed
- **THEN** OpenCandle may record a late trigger using the reconstructed observation evidence
- **AND** the alert event stores the historical evidence used to classify the missed trigger
- **AND** it still labels the trigger as late or reconstructed rather than real-time monitored

#### Scenario: Missed interval cannot be reconstructed

- **WHEN** provider history is unavailable or too coarse to prove what happened while OC was closed
- **THEN** OpenCandle evaluates only the current observation against the last persisted condition state
- **AND** it does not invent one or more missed triggers from unavailable data

#### Scenario: Resume does not synthesize triggers from clock skew

- **WHEN** the system clock, timezone, sleep/wake timing, or daylight-saving offset changes between runs
- **THEN** OpenCandle uses persisted condition state and provider observations to decide whether a trigger occurred
- **AND** it does not synthesize a trigger from wall-clock drift alone

### Requirement: GUI And TUI Automation Controls Stay In Parity

OpenCandle SHALL expose equivalent local automation controls in GUI and TUI.

#### Scenario: User checks alert runner status

- **WHEN** the user opens the GUI market-state automation view or the equivalent TUI command/menu
- **THEN** they can see runner status, last heartbeat, next due check, recent check runs, and whether monitoring requires OC to stay open

#### Scenario: User manages alert lifecycle

- **WHEN** the user pauses, resumes, checks, or deletes an alert from either surface
- **THEN** both GUI and TUI call the same automation service
- **AND** the other surface reflects the change from SQLite state

#### Scenario: User reviews notification history

- **WHEN** a user opens notifications in GUI or TUI
- **THEN** they can see triggered alerts, report outcomes, delivery status, and acknowledgment state

#### Scenario: User audits local automation history

- **WHEN** a user asks what ran recently from GUI or TUI
- **THEN** OpenCandle shows recent alert checks, report runs, failures, missed runs, unavailable provider checks, and delivery failures
- **AND** active or stale running work is distinguishable from completed work

### Requirement: Local Automation Maintenance Is Auditable

OpenCandle SHALL expose enough status and maintenance state to debug local automations without inspecting SQLite manually.

#### Scenario: Running work loses owner

- **WHEN** a check or report run remains active after its runner lease expires
- **THEN** OpenCandle marks or reports it as stale/lost after a grace period
- **AND** it does not keep showing the work as currently running forever

#### Scenario: Provider preflight skips run

- **WHEN** a configured local/provider dependency is unavailable before a due run starts
- **THEN** OpenCandle records the run/check as skipped or unavailable with a clear reason
- **AND** it does not treat the skipped run as a successful alert/report evaluation

### Requirement: Local Runtime Does Not Claim Hosted Guarantees

OpenCandle SHALL communicate the limits of local monitoring.

#### Scenario: App closed during due time

- **WHEN** an alert or report becomes due while no OpenCandle runner is active
- **THEN** OpenCandle does not claim the event was monitored in real time
- **AND** the next runner/manual check can mark the due work as missed, late, or checked on resume

#### Scenario: Polling cadence is best effort

- **WHEN** a rule has a minute-level interval
- **THEN** OpenCandle treats that interval as a best-effort local polling cadence
- **AND** it does not guarantee exact trigger timing or exchange-grade real-time delivery
