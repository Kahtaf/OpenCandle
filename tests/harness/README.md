# Agent Test Harness

File-based IPC harness that lets any coding agent drive OpenCandle as a simulated user, producing structured traces of every tool call, result, and interaction.

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

# 5. Read the full trace
npx tsx tests/harness/cli.ts trace --ipc /tmp/oc-test
```

### Programmatic (manual-run.ts)

```bash
# Basic run with IPC
npx tsx tests/harness/manual-run.ts /tmp/ipc "Build me a portfolio"

# With pre-scripted answers (no IPC polling needed)
npx tsx tests/harness/manual-run.ts /tmp/ipc "Build me a portfolio" '["Growth","Moderate","10000"]'
```

## CLI Reference

| Command | Description | Exit Codes |
|---------|-------------|------------|
| `run --prompt <text> --ipc <dir>` | Start a session, write trace on completion | 0=ok, 1=error |
| `wait --ipc <dir> [--timeout <ms>]` | Block until question or done | 0=done, 100=question, 1=error, 2=timeout |
| `answer --ipc <dir> --value <text>` | Send answer to pending question | 0=ok |
| `trace --ipc <dir>` | Read and print trace.json | 0=ok, 1=not found |

## IPC Directory Layout

```
<ipc-dir>/
├── status        "running" | "waiting" | "done" | "error"
├── pid           harness process ID (liveness check)
├── question.json question payload (when status=waiting)
├── answer.json   agent's answer (agent writes, harness reads)
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
}
```

## Troubleshooting

- **Stale IPC dir**: If `status` is stuck at `running`, check `pid` file — process may have crashed. Delete the dir and retry.
- **Timeout on answer**: Default is 5 minutes. The agent proceeds with best judgment if no answer arrives.
- **fs.watch issues**: The harness falls back to 100ms polling if `fs.watch` is unreliable on your system.
