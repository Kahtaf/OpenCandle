# Close the Loop: Reflection Ledger + Always-On Automation

## Why

Two halves of "an agent that watches the market for you", both currently missing:

1. **The agent has no memory of its own calls.** A `/analyze NVDA` run produces analyst signals, a computed conviction tally, and a synthesis verdict — then loses all of it: `workflow_runs.output_summary` is always NULL (`updateWorkflowRunOutputSummary` has zero callers), and `/analyze` doesn't create a `workflow_runs` row at all (dispatch call sites cover portfolio/options/compare/fallback, not `comprehensive_analysis`). The next analysis of NVDA cannot say "we leaned bearish at $180 — the thesis broke." Every analysis becomes falsifiable against our own record only if a record exists. (This is TradingAgents' one genuinely self-improving mechanism, minus its fabricated-lessons bug, which we guard against structurally. Note: invalidation levels exist only as prompt prose today — no structured output carries one, so the ledger does NOT store them; see the schema decision below.)
2. **Automation dies with the foreground process.** Alerts and daily reports run only while `opencandle monitor` occupies a terminal or the GUI is open. `src/monitor.ts` is already a correct long-running entrypoint (re-entrancy guard, SIGINT/SIGTERM handling, lease release, lease-based double-run prevention) — it just has no service wrapper.

## What Changes

**Reflection ledger (new SQLite table — this proposal is the AGENTS.md ask-first authorization for the schema change):**
- New `analysis_reflections` table; schema v8 → v9 additive migration. (Note: the backlogged `forget-command` change also reserved "v9"; it is spec-only and unimplemented — when scheduled it becomes v10. Record this in both changes.) **Schema decision:** no `invalidation_level` column — no structured output carries an invalidation level today (`parseAnalystOutput` yields signal/conviction/thesis/evidence; the synthesis step has no parser), so the column would be permanently NULL; add it in a future change if a structured synthesis contract lands.
- On comprehensive-analysis completion, write one reflection row: symbol, code-computed vote tally (from the I2/I3 parsed analyst steps), synthesis excerpt, the run's quote price, timestamps. Fields that cannot be extracted deterministically are NULL — never inferred by a model at write time. **Extraction contracts (decided):** *symbol* — `WorkflowDefinition` gains optional metadata `{ symbol }` set by `buildComprehensiveAnalysisDefinition` (today the symbol is baked into prompt strings only); *price* — from the run's `get_stock_quote` evidence whose args contain the run symbol, reading the full `StockQuote.price`/`currency` from the corresponding session tool-result entry's `details` (NOT the 500-char-truncated `resultDigest.preview`, which routinely cuts off `details`); NULL when no such entry parses; *write point* — the synthesis-step completion branch in `SessionCoordinator.startWorkflowRun` (beside `emitSynthesisValidation`), gated on `workflowType === "comprehensive_analysis"`; cancelled runs throw before synthesis, so "on completion" is naturally satisfied; the session id comes from the coordinator's Pi session context at that point.
- On a new comprehensive analysis (and single-asset routed turns) for a symbol with prior reflections, inject the most recent 3 as an additive data block in prompt assembly: date, verdict/tally, price then. "Price now" comparison is left to the turn's own live evidence — the ledger stores history, never computes outcomes.
- **Fabricated-lessons guard:** an empty ledger produces no section at all (structurally absent context), and injected reflections are wrapped as data, not instructions.

**Always-on automation:**
- `opencandle monitor install | uninstall | status`: generates and loads a launchd user agent on macOS (`~/Library/LaunchAgents/com.opencandle.monitor.plist`, `KeepAlive`, stdout/stderr to `~/.opencandle/logs/monitor.log`) or a systemd user unit on Linux (`~/.config/systemd/user/opencandle-monitor.service`, `Restart=on-failure`, journald logging). Windows prints guidance and exits non-zero.
- **Process-topology decision (the naive unit would be broken on macOS):** `opencandle monitor` today is a CLI proxy — `handleMonitorCommand` spawns `node <tsx/cli> <packageRoot>/src/monitor.ts` as a child (`tsx` is a production dependency and `src/` ships in `files`, so this works installed). A launchd job invoking the CLI would track the proxy parent: `launchctl stop` SIGTERMs the handler-less parent and the real monitor dies as a grandchild without running its SIGTERM lease-release. The generated unit therefore invokes the monitor entry **directly** — `process.execPath` + resolved `tsx/cli` + `<packageRoot>/src/monitor.ts` (all resolvable at install time) — so the tracked process IS the monitor with its existing signal handling. systemd's cgroup kill makes this moot on Linux, but the unit uses the direct invocation on both platforms for uniformity. The lease TTL already covers unclean kills. The new subcommands are intercepted in `src/cli-main.ts` before the tsx spawn.
- The monitor loop itself is unchanged; the existing lease machinery already arbitrates daemon-vs-GUI concurrency.
- `opencandle doctor` reports the service's installed/running state.

## Non-Goals

- No model-generated reflection text at write time (deterministic extraction only).
- No outcome scoring/accuracy ledger (that was the removed predictions feature; this stores what *we said*, not whether we were right — the model reasons about outcomes at read time with live data).
- No GUI surface in v1 (the context drawer / market-state pages can render reflections in a follow-up).
- No Windows service support in v1.
- No changes to alert/report scheduling semantics, lease format, or heartbeat cadence.
- Reflection injection respects existing gating: pass-through turns get nothing.

## Sequencing

The ledger write path consumes the structured analyst-step outputs (I2/I3, already on `main`). Independent of the other 2026-07-05 changes; the daemon half is fully independent of the ledger half and may land as a separate PR within this change.
