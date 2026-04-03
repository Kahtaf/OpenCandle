## Why

No coding agent (Claude Code, Codex, Gemini CLI) can currently test OpenCandle end-to-end as a real user would. The existing e2e tests (`cli.test.ts`, `audit-fixes.test.ts`) capture tool names and text, but miss tool arguments, tool results, and — critically — cannot participate in multi-turn interactions when OpenCandle asks follow-up questions via `ask_user`. This means:

- Agents can't test workflows that require clarification (portfolio builder, options screener)
- Agents can't verify that tool arguments are correct (e.g., did it pass "AAPL" not "Apple"?)
- Agents can't check data faithfulness (did the response numbers match what tools returned?)
- No structured trace artifact exists for programmatic analysis or regression comparison

## What Changes

Build a **test harness** that any coding agent can drive via CLI commands, producing structured traces of every tool call, tool result, LLM response, and user interaction.

### Core: File-based IPC harness

A long-running Node process that creates an OpenCandle session (SDK mode, in-memory), sends a prompt, and communicates with the driving agent through files in an IPC directory:

- **`question.json`** — written by harness when `ask_user` fires, contains the question, options, and context
- **`answer.json`** — written by the driving agent with the selected answer
- **`events.jsonl`** — append-only log of all session events (tool calls, results, text deltas)
- **`trace.json`** — final structured trace written on completion
- **`status`** — current state: `running`, `waiting`, `done`, `error`

### CLI interface

```
oc-harness run    --prompt "..." --ipc /tmp/dir    # Start a test run (background)
oc-harness wait   --ipc /tmp/dir                   # Block until question or done
oc-harness answer --ipc /tmp/dir --value "..."      # Send answer to pending question
oc-harness trace  --ipc /tmp/dir                   # Read final trace
```

### ask_user injection

Add an optional `askUserHandler` to `createOpenCandleSession()`. When provided, the `ask_user` tool calls this handler instead of `ctx.ui.*` methods. The harness provides a handler that writes `question.json` and polls for `answer.json`.

### Structured trace

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
  workflowType?: string;
  durationMs: number;
}
```

## Capabilities

### New Capabilities
- `test-harness`: File-based IPC harness enabling any coding agent to drive OpenCandle as a simulated user, with structured trace output

### Modified Capabilities
- `ask-user` tool gains an injectable handler for non-UI contexts, replacing the current `ctx.hasUI` / `noUiResult` binary

## Non-goals

- TUI rendering tests (not needed — agents don't evaluate visual output)
- Eval framework (separate change, planned — see `docs/eval-framework-plan.md`)
- Pre-scripted answer mode (can be built on top of the IPC mechanism later)
- RPC-mode harness (SDK in-process approach is simpler and sufficient)
