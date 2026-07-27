# Agent Test Harness

Harnesses for driving OpenCandle as a simulated user and producing structured traces of every tool call, result, and interaction.

- `tests/harness/opencandle-runner.ts` is the shared in-process runner used by evals and competitive benchmarking. It returns both the rich `AgentTrace` and the flattened `EvalTrace` consumed by scorers.
- `tests/harness/cli.ts` is the file-based IPC harness for an external agent or GUI flow that needs to wait for `ask_user`, answer, send follow-up prompts, and continue.

## Quick Start

### Claude Code / Codex CLI

```bash
# 1. Start a test run in the background
npx tsx tests/harness/cli.ts run --prompt "What is AAPL trading at?" --ipc /tmp/oc-test &

# 2. Wait for completion or question
npx tsx tests/harness/cli.ts wait --ipc /tmp/oc-test
# exit 0 → done (prints trace summary)
# exit 100 → question pending (prints question JSON)
# exit 1 → error

# 3. If a question is pending, answer it
npx tsx tests/harness/cli.ts answer --ipc /tmp/oc-test --value "Moderate"

# 4. Repeat steps 2-3 until done

# 5. Send a follow-up prompt into the same live session (within its linger window)
npx tsx tests/harness/cli.ts send --ipc /tmp/oc-test --prompt "What about at $500?"

# 6. Read the full trace
npx tsx tests/harness/cli.ts trace --ipc /tmp/oc-test
```

### Programmatic Eval Runner

Use `runOpenCandleSession()` from `tests/harness/opencandle-runner.ts` when code needs to run OpenCandle and inspect trace data directly:

```typescript
const { evalTrace, agentTrace } = await runOpenCandleSession({
  prompt: "Build me a portfolio",
  scriptedAnswers: ["Growth", "Moderate", "10000"],
});
```

## CLI Reference

| Command | Description | Exit Codes |
|---------|-------------|------------|
| `run --prompt <text> --ipc <dir> [--timeout <ms>] [--linger <ms>]` | Start a session, write trace on completion, then wait a bounded follow-up window (default 120s, `--linger` overrides) for `send` prompts before exiting; cleans up its session and any self-created temp home on exit | 0=ok, 1=error |
| `send --prompt <text> --ipc <dir>` | Send a follow-up prompt into a still-live `run` session | 0=ok, 1=error |
| `wait --ipc <dir> [--timeout <ms>]` | Block until question or done | 0=done, 100=question, 1=error, 2=timeout |
| `answer --ipc <dir> --value <text>` | Send answer to pending question | 0=ok |
| `trace --ipc <dir>` | Read and print trace.json | 0=ok, 1=not found |

`send` requires the target `run` to be in `done` or `waiting` status and its process to still be alive (checked via the `pid` file); it fails fast with a non-zero exit if the run already exited its linger window.

## IPC Directory Layout

```
<ipc-dir>/
├── status        "running" | "waiting" | "done" | "error"
├── pid           harness process ID (liveness check)
├── question.json question payload (when status=waiting)
├── answer.json   agent's answer (agent writes, harness reads)
├── prompt-request.json  follow-up prompt from `send` (agent writes, harness reads)
├── events.jsonl  streaming event log (append-only)
├── trace.json    final structured trace (when status=done)
└── error.txt     error message (when status=error)
```

## Trace Format

```typescript
interface AgentTrace {
  prompt: string;
  turns: Array<{
    toolCalls: Array<{
      name: string;
      args: Record<string, unknown>;
      result: unknown;
      isError: boolean;
      durationMs: number;
    }>;
    text: string;
  }>;
  interactions: Array<{
    question: string;
    method: "select" | "text" | "confirm";
    options?: string[];
    answer: string | null;
  }>;
  finalText: string;
  toolSequence: string[];
  durationMs: number;
  /** OpenCandle extension-authored custom entries (see below). */
  customEntries?: Array<{
    customType: string;
    data: unknown;
    timestamp: string;
  }>;
}
```

### `customEntries`

`opencandle-runner.ts` and `cli.ts` drain every session entry whose `type === "custom"` and
`customType` starts with `opencandle-` into `trace.json.customEntries` after
the agent has settled, preserving append order. These entries are appended
by the OpenCandle Pi extension via `pi.appendEntry(...)` and are **not**
emitted as `AgentSessionEvent`s, so subscribing to the session is not enough
— the harness reads them directly from `session.sessionManager.getEntries()`.

Currently-emitted `customType`s:

| `customType`                       | Purpose                                                                 |
|------------------------------------|-------------------------------------------------------------------------|
| `opencandle-router`                | LLM-router output for a turn.                                          |
| `opencandle-router-error`          | Router client/parse error for a turn.                                   |
| `opencandle-router-prefs-dropped`  | Low-confidence preference updates that were discarded.                  |
| `opencandle-route-context`         | Resolved routing context (workflow, tool bundle) applied to a turn.      |
| `opencandle-disclaimer`            | Disclaimer text appended after each final assistant turn.               |
| `opencandle-turn-gap`              | Soft-degradation annotation flushed at `turn_end` when tools degraded.  |
| `opencandle-workflow`              | Workflow dispatch record (portfolio, options screener, compare, analysis).|
| `opencandle-workflow-aborted`      | Workflow preflight aborted (e.g. too few valid symbols).                |
| `opencandle-symbol-preflight-dropped` | A symbol dropped during compare-workflow ticker preflight.           |
| `opencandle-symbol-dropped`        | A router-extracted symbol token dropped as a false-positive ticker.      |
| `opencandle-tool-scope`            | Route-selected active tool scope applied or restored for a turn.        |
| `opencandle-tool-scope-violation`  | A tool call outside the route's active tool scope.                      |
| `opencandle-title-error`           | Session auto-titling failed for a turn.                                 |
| `opencandle-user-input`            | The user's original words, preserved when a workflow transform rewrites the turn. |
| `opencandle-validation`            | Synthesis-output validation result against tool evidence.               |
| `opencandle-workflow-event`        | Workflow lifecycle event (e.g. validation passed/failed).               |
| `opencandle-analyst-step`          | Parsed (or parse-failed) structured analyst/debate step output.          |

The capture is wildcard (`opencandle-*`), so new extension-authored entries of
`type: "custom"` appear in `customEntries` automatically without harness edits.
(A couple of other `opencandle-*`-prefixed entries, such as `opencandle-welcome`
and `opencandle-model-setup`, use Pi's `custom_message` entry type instead and
are not captured here.)

## Troubleshooting

- **Stale IPC dir**: If `status` is stuck at `running`, check `pid` file — process may have crashed. Delete the dir and retry.
- **Timeout on answer**: Default is 5 minutes. The agent proceeds with best judgment if no answer arrives.
- **fs.watch issues**: The harness falls back to 100ms polling if `fs.watch` is unreliable on your system.
