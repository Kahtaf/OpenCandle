## Tasks

### 1. Add `askUserHandler` injection to session and ask-user tool
- [x] Add `AskUserHandler` type to `src/types/` or alongside ask-user tool
- [x] Add `askUserHandler` option to `createOpenCandleSession()` in `src/index.ts`
- [x] Thread handler through extension factory → `registerAskUserTool`
- [x] Modify `ask-user.ts` execute: check for injected handler before `ctx.hasUI`
- [x] Unit test: handler receives correct params, return value flows back to tool result
- [x] Verify existing tests still pass (handler is optional, no behavior change when absent)

### 2. Build trace collector
- [ ] Define `AgentTrace`, `TurnTrace`, `ToolCallTrace`, `InteractionTrace` types in `tests/harness/types.ts`
- [ ] Implement `createTraceCollector(session)` in `tests/harness/trace-collector.ts`
- [ ] Handle events: `tool_execution_start` (capture name, args, timestamp), `tool_execution_end` (capture result, isError, duration), `message_update` (text deltas), `turn_end` (finalize turn), `agent_end` (finalize trace)
- [ ] Add `appendToJsonl(filePath)` for streaming event log
- [ ] Build `toolSequence` flat array from turns
- [ ] Unit test with synthetic session events

### 3. Build file-based IPC
- [ ] Implement `IpcChannel` class in `tests/harness/ipc.ts`
- [ ] `writeQuestion()` — atomic write of question.json + status=waiting
- [ ] `pollForAnswer()` — fs.watch with fallback polling, configurable timeout, cleans up files after read
- [ ] `writeTrace()` — write trace.json + status=done
- [ ] `writeError()` — write error.txt + status=error
- [ ] `setStatus()` — atomic status file write
- [ ] Static read helpers: `readStatus`, `readQuestion`, `writeAnswer`, `readTrace`
- [ ] Write PID file on start for liveness detection
- [ ] Unit test the full cycle: write question → write answer → read answer

### 4. Build `askUserHandler` for IPC
- [ ] Implement file-based handler: receives question params → writes question.json via IPC → polls for answer.json → returns result
- [ ] Track interactions in trace collector (question + answer pairs)
- [ ] Handle timeout → return cancelled
- [ ] Integration test: handler writes question, external process writes answer, handler returns it

### 5. Build CLI entry point
- [ ] Create `tests/harness/cli.ts` with subcommands: `run`, `wait`, `answer`, `trace`
- [ ] `run`: parse args, create IPC dir, create session with askUserHandler, start trace collector, prompt session, write trace on completion
- [ ] `wait`: watch IPC dir for status changes, print question (exit 100) or trace summary (exit 0) or error (exit 1), support --timeout
- [ ] `answer`: write answer.json to IPC dir, exit immediately
- [ ] `trace`: read and print trace.json
- [ ] Add `oc-harness` bin entry to package.json (or document npx usage)
- [ ] Handle graceful shutdown (SIGINT/SIGTERM → cancel workflow, write partial trace)

### 6. Integration test the full loop
- [ ] Test: simple prompt (no ask_user) → harness runs to completion → trace.json has tool calls and text
- [ ] Test: prompt that triggers ask_user → harness pauses → answer provided via file → harness continues → trace includes interaction
- [ ] Test: multi-step workflow (portfolio builder) → multiple question/answer rounds → complete trace
- [ ] Test: timeout on answer → handler returns cancelled → agent proceeds with best judgment
- [ ] Test: verify events.jsonl is written continuously during the run

### 7. Document harness usage for coding agents
- [ ] Add `tests/harness/README.md` with:
  - Quick start example for Claude Code
  - Quick start example for Codex CLI
  - CLI reference
  - Trace format reference
  - Troubleshooting (stale IPC dirs, process didn't exit, etc.)
- [ ] Add AGENTS.md entry in tests/ pointing to harness docs
