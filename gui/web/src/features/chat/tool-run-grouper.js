// Local text extractor that ignores toolCall parts. The shared `textContent`
// includes a `part.name` fallback (used to render assistant tool-call shells
// elsewhere), which would let tool names like "get_sentiment_summary" leak
// into our narration capture. We only want actual prose written by the model.
function narrativeText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part && part.type !== "toolCall" && part.type !== "tool")
    .map((part) => part.text || "")
    .join("\n")
    .trim();
}

// Group adjacent tool-related messages into a single "tool_run" entry so the
// chat thread can show one collapsed StepsCard per run instead of N separate
// tool call + tool result cards. Walks the entries once and accumulates a run
// until the assistant emits a text-only message or a new user turn starts.
//
// Run shape:
//   {
//     type: "tool_run",
//     id: "run-<first-tool-call-id>",
//     steps: [{ id, name, args, status, result?, narration?, messageId }],
//     status: "pending" | "completed" | "error",
//     narrationBefore: string  (assistant text immediately preceding the first
//                               tool call, e.g. "Let me look up the quote.")
//     entryRange: [startIndex, endIndex]
//   }
//
// `status` is "pending" while any step lacks a result; "error" if any step
// errored; otherwise "completed".
export function groupToolRuns(entries) {
  const out = [];
  let run = null;
  let pendingNarration = "";

  const flushRun = () => {
    if (!run) return;
    run.status = aggregateStatus(run.steps);
    out.push(run);
    run = null;
  };

  for (const entry of entries) {
    if (entry.type !== "message") {
      flushRun();
      out.push(entry);
      continue;
    }

    const message = entry.message;
    if (!message) {
      flushRun();
      out.push(entry);
      continue;
    }

    if (message.role === "user") {
      flushRun();
      pendingNarration = "";
      out.push(entry);
      continue;
    }

    if (message.role === "assistant") {
      const parts = Array.isArray(message.content) ? message.content : [];
      const toolCalls = parts.filter((p) => p?.type === "toolCall");
      const text = narrativeText(message.content);

      if (toolCalls.length === 0) {
        // pure text assistant message — flush the current run, emit the message
        flushRun();
        pendingNarration = "";
        if (text) out.push(entry);
        continue;
      }

      // The assistant emitted tool calls. Start a run if there isn't one;
      // otherwise continue the existing run.
      if (!run) {
        run = startRun(toolCalls[0]);
        run.narrationBefore = (pendingNarration || text || "").trim();
        pendingNarration = "";
      } else if (text) {
        // Mid-run narration; attach to the last existing step so it shows
        // beneath the prior tool's result in the drawer timeline.
        const lastStep = run.steps[run.steps.length - 1];
        if (lastStep) {
          lastStep.narrationAfter = `${lastStep.narrationAfter || ""}${lastStep.narrationAfter ? "\n\n" : ""}${text}`.trim();
        }
      }

      for (const tc of toolCalls) {
        run.steps.push({
          id: tc.id,
          name: tc.name,
          args: tc.arguments || {},
          status: "pending",
          result: null,
          messageId: message.id,
        });
      }
      continue;
    }

    if (message.role === "toolResult") {
      if (!run) {
        // Orphaned result with no current run — start a one-step run anchored
        // to it so the user still sees the data.
        run = {
          type: "tool_run",
          id: `run-${message.toolCallId || entry.id}`,
          steps: [],
          status: "pending",
          narrationBefore: "",
          entryRange: [out.length, out.length],
        };
        run.steps.push({
          id: message.toolCallId,
          name: message.toolName,
          args: {},
          status: "pending",
          result: null,
          messageId: null,
        });
      }
      const step = run.steps.find((s) => s.id === message.toolCallId)
        ?? run.steps.find((s) => s.name === message.toolName && !s.result);
      if (step) {
        step.result = message;
        step.status = message.isError ? "error" : "completed";
      } else {
        run.steps.push({
          id: message.toolCallId,
          name: message.toolName,
          args: {},
          status: message.isError ? "error" : "completed",
          result: message,
          messageId: null,
        });
      }
      continue;
    }

    // Unknown — flush + pass through.
    flushRun();
    out.push(entry);
  }

  flushRun();
  return out;
}

function startRun(firstCall) {
  return {
    type: "tool_run",
    id: `run-${firstCall.id}`,
    steps: [],
    status: "pending",
    narrationBefore: "",
    entryRange: [],
  };
}

function aggregateStatus(steps) {
  if (steps.some((s) => s.status === "pending")) return "pending";
  if (steps.some((s) => s.status === "error")) return "error";
  return "completed";
}
