# Agent Test Harness — Design

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  CODING AGENT (Claude Code / Codex / Gemini CLI / script)           │
│                                                                     │
│  1. bash("npx oc-harness run --prompt '...' --ipc /tmp/t1")         │
│     └── starts harness in background                                │
│                                                                     │
│  2. bash("npx oc-harness wait --ipc /tmp/t1")                       │
│     └── blocks until question or done                               │
│     └── exit 100 + question JSON, or exit 0 + trace summary        │
│                                                                     │
│  3. bash("npx oc-harness answer --ipc /tmp/t1 --value 'Moderate'")  │
│     └── sends answer to pending question                            │
│                                                                     │
│  4. repeat 2-3 until done                                           │
│                                                                     │
│  5. bash("cat /tmp/t1/trace.json")                                  │
│     └── read complete structured trace                              │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  OC-HARNESS (long-running Node.js process)                          │
│                                                                     │
│  ┌───────────────────────────────────────────────────┐              │
│  │ createOpenCandleSession({                          │              │
│  │   sessionManager: SessionManager.inMemory(),       │              │
│  │   askUserHandler: fileBasedIpcHandler(ipcDir),     │   ← new     │
│  │ })                                                 │              │
│  │                                                    │              │
│  │ session.subscribe() → trace-collector.ts            │              │
│  │ session.prompt(userPrompt)                          │              │
│  └───────────────────────────────────────────────────┘              │
│                                                                     │
│  IPC directory:                                                     │
│  /tmp/t1/                                                           │
│  ├── status        "running" | "waiting" | "done" | "error"        │
│  ├── question.json  pending question (when status=waiting)          │
│  ├── answer.json    agent's answer (agent writes, harness reads)    │
│  ├── events.jsonl   streaming event log (append-only)               │
│  ├── trace.json     final structured trace (when status=done)       │
│  └── error.txt      error message (when status=error)               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Component Design

### 1. `askUserHandler` injection into `createOpenCandleSession`

Add an optional `askUserHandler` to the session options. When provided, `registerAskUserTool` uses this handler instead of `ctx.ui.*` calls.

```typescript
// In src/types or wherever session options live
export type AskUserHandler = (params: {
  question: string;
  questionType: "select" | "text" | "confirm";
  options?: string[];
  placeholder?: string;
  reason?: string;
}) => Promise<{ answer: string | null; cancelled: boolean }>;

// In createOpenCandleSession options
interface OpenCandleSessionOptions {
  // ... existing options ...
  askUserHandler?: AskUserHandler;
}
```

The `ask-user.ts` tool checks for the handler:

```typescript
async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
  const { question, question_type: questionType } = params;

  // Priority: injected handler > UI > no-UI fallback
  if (askUserHandler) {
    const result = await askUserHandler({ question, questionType, ...params });
    if (result.cancelled) return cancelledResult(question, questionType);
    return answerResult(question, questionType, result.answer!);
  }

  if (!ctx?.hasUI) {
    return noUiResult(question, questionType);
  }

  // ... existing ctx.ui.* logic ...
}
```

The handler must be accessible to the tool. Two options:
- **Closure**: pass it through the extension factory
- **Module-level setter**: `setAskUserHandler(handler)` called before session starts

Closure via extension factory is cleaner — the handler is passed through `createOpenCandleSession` → `openCandleExtension` → `registerAskUserTool`.

### 2. Trace collector

Subscribes to `session.subscribe()` and builds an `AgentTrace`:

```typescript
export function createTraceCollector(session: AgentSession): {
  getTrace(): AgentTrace;
  appendToFile(path: string): void;  // for events.jsonl
} {
  const trace: AgentTrace = { prompt: "", turns: [], interactions: [], ... };
  let currentTurn: TurnTrace = { toolCalls: [], text: "" };

  session.subscribe((event) => {
    switch (event.type) {
      case "tool_execution_start":
        // Start tracking a tool call: name, args, timestamp
        break;
      case "tool_execution_end":
        // Complete tool call: result, isError, duration
        break;
      case "message_update":
        // Accumulate text deltas
        break;
      case "turn_end":
        // Push currentTurn, start new one
        break;
      case "agent_end":
        // Finalize trace
        break;
    }
  });

  return { getTrace, appendToFile };
}
```

### 3. File-based IPC

```typescript
export class IpcChannel {
  constructor(private dir: string) {}

  // Harness side
  async writeQuestion(q: Question): Promise<void>;      // write question.json + set status=waiting
  async pollForAnswer(timeoutMs?: number): Promise<Answer>; // watch/poll answer.json
  async writeTrace(trace: AgentTrace): Promise<void>;    // write trace.json + set status=done
  async writeError(message: string): Promise<void>;      // write error.txt + set status=error
  setStatus(status: string): void;                       // write status file

  // CLI side (static helpers)
  static readStatus(dir: string): string;
  static readQuestion(dir: string): Question | null;
  static writeAnswer(dir: string, value: string): void;
  static readTrace(dir: string): AgentTrace | null;
}
```

`pollForAnswer` uses `fs.watch()` with a fallback to 100ms polling (fs.watch is unreliable on some systems). Deletes both `question.json` and `answer.json` after reading the answer.

### 4. CLI commands

Single entry point: `tests/harness/cli.ts`

```
oc-harness run --prompt <text> --ipc <dir> [--model <id>] [--timeout <ms>]
  Creates IPC dir, starts session, sends prompt, runs until completion.
  Writes events.jsonl continuously, trace.json at end.
  When ask_user fires, pauses and writes question.json.

oc-harness wait --ipc <dir> [--timeout <ms>]
  Watches the IPC dir. Blocks until:
    status=waiting → print question JSON to stdout, exit 100
    status=done    → print trace summary to stdout, exit 0
    status=error   → print error to stderr, exit 1
    timeout        → exit 2

oc-harness answer --ipc <dir> --value <text>
  Writes answer.json. Exits immediately.

oc-harness trace --ipc <dir>
  Reads and prints trace.json to stdout.
```

### 5. Harness extension factory

```typescript
export function createHarnessExtension(
  ipcDir: string,
  traceCollector: TraceCollector,
): (pi: ExtensionAPI) => void {
  return (pi) => {
    // No additional tool registration needed — ask_user handler
    // is injected via createOpenCandleSession's askUserHandler option.
    // The extension just wires up trace collection.
  };
}
```

Actually, the harness doesn't need its own extension. The `askUserHandler` injection and `session.subscribe()` trace collector are both set up outside the extension system. The harness is just:

1. `createOpenCandleSession({ askUserHandler: ipcHandler })`
2. `createTraceCollector(session)`
3. `session.prompt(userPrompt)`

## Data Flow

```
Agent                    Harness                   OpenCandle Session
  │                        │                              │
  ├─ run --prompt "..."    │                              │
  │                        ├─ createSession()              │
  │                        ├─ subscribe(traceCollector)    │
  │                        ├─ session.prompt()             │
  │                        │                              ├─ classifyIntent()
  │                        │                              ├─ route to workflow
  │                        │                              ├─ LLM decides to call tools
  │                        │                              │
  │                        │    tool_execution_start ◄────┤ get_stock_quote({symbol:"AAPL"})
  │                        │    → append events.jsonl      │
  │                        │    tool_execution_end   ◄────┤ {price: 248.5, ...}
  │                        │    → append events.jsonl      │
  │                        │                              │
  │                        │                              ├─ LLM decides to call ask_user
  │                        │    askUserHandler fires  ◄───┤ ask_user({question: "Risk?"})
  │                        ├─ write question.json          │
  │                        ├─ set status=waiting           │
  │                        │    (handler blocks here)      │
  │                        │                              │
  ├─ wait ─────────────────┤                              │
  │  ◄─ exit 100 + question│                              │
  │                        │                              │
  ├─ answer --value "Mod"  │                              │
  │                        ├─ read answer.json             │
  │                        │    handler returns ──────────►│ "User answered: Moderate"
  │                        │                              ├─ LLM continues...
  │                        │                              │
  │                        │    agent_end          ◄──────┤
  │                        ├─ write trace.json             │
  │                        ├─ set status=done              │
  │                        │                              │
  ├─ wait ─────────────────┤                              │
  │  ◄─ exit 0 + summary   │                              │
  │                        │                              │
  ├─ cat trace.json        │                              │
  │  ◄─ full trace          │                              │
  │                        │                              │
```

## Error Handling

- **Harness crashes**: `status` file remains at `running` or `waiting`. The `wait` command detects this by checking if the harness process is still alive (PID file in IPC dir). If dead, it reads any partial trace from events.jsonl and exits with code 1.
- **LLM errors**: Caught by Pi's retry mechanism. If all retries fail, the harness writes `error.txt` and sets `status=error`.
- **Timeout on answer**: The `pollForAnswer` has a configurable timeout (default 5 minutes). If no answer arrives, the handler returns `cancelled: true` and the agent proceeds with best judgment (existing behavior).
- **IPC dir doesn't exist**: `wait` and `answer` commands exit with helpful error.

## Testing the Harness Itself

- Unit test the trace collector with mock session events
- Unit test IPC read/write/poll
- Integration test: start harness, wait, answer, verify trace
- The harness should work with existing e2e test prompts (no ask_user needed for simple queries)
