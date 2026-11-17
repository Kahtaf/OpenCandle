import {
  type AssistantMessage,
  createAssistantMessageEventStream,
  isContextOverflow,
} from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

const guardedRuntimes = new WeakSet<ModelRuntime>();

export function guardModelRuntimeAssistantResponses(runtime: ModelRuntime): void {
  if (guardedRuntimes.has(runtime)) return;
  const streamSimple = runtime.streamSimple.bind(runtime);
  runtime.streamSimple = (model, context, options) => {
    const stream = createAssistantMessageEventStream();
    let latest: AssistantMessage | undefined;
    void (async () => {
      try {
        const source = streamSimple(model, context, options);
        for await (const event of source) {
          if (event.type === "done") latest = event.message;
          else if (event.type === "error") latest = event.error;
          else {
            latest = event.partial;
            stream.push(event);
          }
        }
        const original = await source.result();
        const message = normalizeResponse(original, model.contextWindow);
        if (message.stopReason === "error" || message.stopReason === "aborted") {
          stream.push({ type: "error", reason: message.stopReason, error: message });
        } else {
          const reason = message.stopReason === "pending" ? "stop" : message.stopReason;
          stream.push({ type: "done", reason, message });
        }
        stream.end(message);
      } catch (error) {
        const message: AssistantMessage = {
          role: "assistant",
          content: [],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            reasoning: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          timestamp: Date.now(),
          ...latest,
          stopReason: options?.signal?.aborted ? "aborted" : "error",
          errorMessage: error instanceof Error ? error.message : String(error),
        };
        stream.push({
          type: "error",
          reason: message.stopReason === "aborted" ? "aborted" : "error",
          error: message,
        });
        stream.end(message);
      }
    })();
    return stream;
  };
  guardedRuntimes.add(runtime);
}

function normalizeResponse(message: AssistantMessage, contextWindow: number): AssistantMessage {
  if (
    message.stopReason !== "stop" ||
    message.errorMessage ||
    isContextOverflow(message, contextWindow) ||
    message.content.some(
      (block) =>
        block.type === "toolCall" || (block.type === "text" && block.text.trim().length > 0),
    )
  )
    return message;

  return {
    ...message,
    stopReason: "error",
    errorMessage: "Model response ended without visible text or tool calls.",
    diagnostics: [
      ...(message.diagnostics ?? []),
      {
        type: "opencandle.empty_assistant_response",
        timestamp: Date.now(),
        details: { originalStopReason: "stop" },
      },
    ],
  };
}
