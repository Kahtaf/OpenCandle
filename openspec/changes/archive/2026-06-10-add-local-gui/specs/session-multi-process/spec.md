# Capability: `session-multi-process`

## Purpose

Define a writer/follower contract that lets TUI and GUI share a single Pi session safely. At any moment one process holds the writer role and runs the agent loop; others tail session entries read-only. Switching the writer is explicit. This satisfies "resume in the GUI what I started in the TUI" without introducing concurrent-write hazards.

## Scope

In scope:
- An advisory writer-lock file per session.
- Lock acquisition, liveness checking, and stale-lock recovery.
- A "take over" handoff mechanism between processes.
- Follower-mode rendering (read-only) in both TUI and GUI.

Not in scope:
- Operational-transform-style simultaneous-writer mode.
- Multi-machine session sharing (e.g., over NFS or cloud sync).
- Authentication of writer-takeover requests beyond same-user filesystem permissions.

## Requirements

### Writer-lock primitive

- Each Pi session directory SHALL have at most one advisory lock at `~/.pi/agent/sessions/<id>/writer.lock`.
- The lock file SHALL contain at minimum: `pid`, `processKind` (`"tui" | "gui"`), `acquiredAt` ISO8601 timestamp.
- A process SHALL acquire the lock via atomic file create (`O_CREAT|O_EXCL` semantics) and SHALL release it on graceful shutdown.
- A process MUST NOT mutate session entries unless it holds the lock for that session.

### Acquisition

- On startup, a process targeting session `<id>` SHALL attempt to acquire the lock.
- If the lock file exists, the process SHALL read it and check pid liveness.
- If the holder pid is alive, the process SHALL enter follower mode for that session.
- If the holder pid is NOT alive, the process SHALL clear the stale lock after a grace period (default 2 seconds) and re-attempt acquisition.
- The grace period SHALL be configurable and skipped only by an explicit `--force` flag (not exposed in the GUI v1).

### Followers

- A follower process SHALL render the session read-only.
- A follower SHALL re-read session entries through Pi's `SessionManager` APIs. If a future Pi session-entry event API becomes public, the implementation may replace polling/re-read with that event source.
- A follower SHALL re-render on every appended entry and on every branch event.
- A follower SHALL NOT call any tool execute paths (including direct UI invocation) and SHALL NOT submit prompts.

### Take-over handoff

- A follower SHALL be able to request take-over via a UI affordance ("Take over" in the GUI; `/takeover` command in the TUI).
- The take-over request SHALL signal the current writer (SIGINT or an IPC channel) to gracefully release.
- The current writer SHALL respond to a take-over signal by completing the in-flight agent turn (or aborting cleanly), releasing the lock, and entering follower mode.
- The follower SHALL poll for lock release with a default timeout of 30 seconds. On timeout, the take-over SHALL fail and a warning SHALL be surfaced to the user.
- A take-over MUST NOT corrupt session state. Branches in flight SHALL settle before lock release.

### Sidebar and indicators

- The GUI sidebar SHALL display the writer-status icon for each session: 📟 TUI, 🌐 GUI, 👻 idle.
- A session held by another process SHALL display a "currently writing: <kind>" subtitle and a "Take over" affordance.
- A session in follower mode SHALL display a top-of-chat banner: "Read-only — <kind> is writing. [Take over]".

### Recovery from lock loss

- If a writer's process dies with the lock file intact, the next process targeting that session SHALL detect the dead pid and recover the lock after the grace period.
- A writer SHALL refresh the lock file's `lastHeartbeat` field every 5 seconds; followers MAY use heartbeat staleness (>15s) as an additional liveness signal alongside pid checking, useful when pid recycling is a concern.

### Branches

- Pi's branching model is preserved: a writer can fork a session.
- Followers SHALL re-render on branch-change events and SHALL display the new leaf branch.
- Branching is a writer-only operation; a follower attempting to branch (e.g., via a GUI affordance) SHALL be rejected with a clear error message.

## Non-requirements (explicit)

- Cross-machine session sync is OUT of scope. The writer-lock is filesystem-local; running TUI on machine A and GUI on machine B accessing the same session via NFS is unsupported.
- Concurrent writers (multiple processes appending entries to the same session simultaneously) are OUT of scope. The contract is mutual exclusion, not merge.
- Writer-takeover authentication beyond filesystem permissions is OUT of scope. v1 trusts that any process with read access to `writer.lock` is the same user.

## Acceptance

- Starting a session in TUI, then opening the same session in GUI, results in the GUI in follower mode with a banner identifying the TUI as writer.
- Writing a message in TUI causes the GUI follower to render the new entry within 1 second.
- Clicking "Take over" in the GUI causes the TUI to finish its in-flight turn (if any), release the lock, and become a follower; the GUI assumes writer role.
- Killing the TUI writer with SIGKILL leaves a stale lock; subsequent GUI startup recovers the lock after the grace period.
- A follower process SHALL NOT successfully submit a prompt; the UI affordance to do so is disabled and the WS endpoint rejects writer-only operations with a clear error.
