## ADDED Requirements

### Requirement: Monitor service install for always-on automation

`opencandle monitor install` SHALL generate and activate a user-level service running the existing monitor loop: on macOS a launchd agent at `~/Library/LaunchAgents/com.opencandle.monitor.plist` with `KeepAlive` and stdout/stderr redirected to `~/.opencandle/logs/monitor.log`; on Linux a systemd user unit at `~/.config/systemd/user/opencandle-monitor.service` with `Restart=on-failure`. The generated unit SHALL invoke the monitor entry **directly** — `process.execPath`, the resolved `tsx/cli` path, and `<packageRoot>/src/monitor.ts`, all resolved at install time, never hardcoded — NOT the `opencandle` CLI (whose `monitor` command is a proxy parent that spawns the real monitor as a grandchild; a launchd job tracking the proxy would SIGTERM it without the monitor's lease-release running). The new subcommands are intercepted in `src/cli-main.ts` before the proxy spawn. `opencandle monitor uninstall` SHALL stop and remove the unit; `opencandle monitor status` SHALL report installed/running state. On Windows, install prints platform guidance and exits non-zero. The monitor loop itself, its lease arbitration with GUI heartbeats (whose TTL covers unclean kills), and `--once` behavior are unchanged.

#### Scenario: Install then status on macOS

- **WHEN** `opencandle monitor install` runs on macOS and succeeds
- **THEN** the plist exists, the agent is loaded, and `opencandle monitor status` reports it running

#### Scenario: Uninstall is clean

- **WHEN** `opencandle monitor uninstall` runs after an install
- **THEN** the unit is stopped and its file removed, and `status` reports not installed

#### Scenario: Daemon and GUI do not double-run automations

- **WHEN** the service is running and a GUI writer's automation heartbeat starts
- **THEN** the existing `automation_runner_leases` arbitration ensures only one owner executes alert/report checks (existing behavior, asserted, not reimplemented)

### Requirement: Doctor reports monitor service state

`opencandle doctor` SHALL include the monitor service's state (not installed / installed but not running / running, with the unit path) in both text and JSON output.

#### Scenario: Doctor shows a stopped service

- **WHEN** the unit is installed but not running
- **THEN** doctor reports "installed, not running" with remediation guidance (`opencandle monitor status` / platform start command)
