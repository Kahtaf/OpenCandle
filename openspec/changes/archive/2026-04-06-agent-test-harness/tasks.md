## Tasks

### 1. Add `askUserHandler` injection to session and ask-user tool
- [x] Add `AskUserHandler` type to `src/types/` or alongside ask-user tool
- [x] Add `askUserHandler` option to `createOpenCandleSession()` in `src/index.ts`
- [x] Thread handler through extension factory → `registerAskUserTool`
- [x] Modify `ask-user.ts` execute: check for injected handler before `ctx.hasUI`
- [x] Unit test: handler receives correct params, return value flows back to tool result
- [x] Verify existing tests still pass (handler is optional, no behavior change when absent)

### 2. Build trace collector
- [x] Define `AgentTrace`, `TurnTrace`, `ToolCallTrace`, `InteractionTrace` types in `tests/harness/types.ts`
- [x] Implement `createTraceCollector(session)` in `tests/harness/trace-collector.ts`
- [x] Handle events: `tool_execution_start` (capture name, args, timestamp), `tool_execution_end` (capture result, isError, duration), `message_update` (text deltas), `turn_end` (finalize turn), `agent_end` (finalize trace)
- [x] Add `appendToJsonl(filePath)` for streaming event log
- [x] Build `toolSequence` flat array from turns
- [x] Unit test with synthetic session events

### 3. Build file-based IPC
- [x] Implement `IpcChannel` class in `tests/harness/ipc.ts`
- [x] `writeQuestion()` — atomic write of question.json + status=waiting
- [x] `pollForAnswer()` — fs.watch with fallback polling, configurable timeout, cleans up files after read
- [x] `writeTrace()` — write trace.json + status=done
- [x] `writeError()` — write error.txt + status=error
- [x] `setStatus()` — atomic status file write
- [x] Static read helpers: `readStatus`, `readQuestion`, `writeAnswer`, `readTrace`
- [x] Write PID file on start for liveness detection
- [x] Unit test the full cycle: write question → write answer → read answer

### 4. Build `askUserHandler` for IPC
- [x] Implement file-based handler: receives question params → writes question.json via IPC → polls for answer.json → returns result
- [x] Track interactions in trace collector (question + answer pairs)
- [x] Handle timeout → return cancelled
- [x] Integration test: handler writes question, external process writes answer, handler returns it

### 5. Build CLI entry point
- [x] Create `tests/harness/cli.ts` with subcommands: `run`, `wait`, `answer`, `trace`
- [x] `run`: parse args, create IPC dir, create session with askUserHandler, start trace collector, prompt session, write trace on completion
- [x] `wait`: watch IPC dir for status changes, print question (exit 100) or trace summary (exit 0) or error (exit 1), support --timeout
- [x] `answer`: write answer.json to IPC dir, exit immediately
- [x] `trace`: read and print trace.json
- [x] Add `oc-harness` bin entry to package.json (or document npx usage)
- [x] Handle graceful shutdown (SIGINT/SIGTERM → cancel workflow, write partial trace)

### 6. Integration test the full loop
- [x] Test: simple prompt (no ask_user) → harness runs to completion → trace.json has tool calls and text
- [x] Test: prompt that triggers ask_user → harness pauses → answer provided via file → harness continues → trace includes interaction
- [x] Test: multi-step workflow (portfolio builder) → multiple question/answer rounds → complete trace
- [x] Test: timeout on answer → handler returns cancelled → agent proceeds with best judgment
- [x] Test: verify events.jsonl is written continuously during the run

### 7. Document harness usage for coding agents
- [x] Add `tests/harness/README.md` with:
  - Quick start example for Claude Code
  - Quick start example for Codex CLI
  - CLI reference
  - Trace format reference
  - Troubleshooting (stale IPC dirs, process didn't exit, etc.)
- [x] Add AGENTS.md entry in tests/ pointing to harness docs
