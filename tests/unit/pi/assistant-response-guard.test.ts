import {
  type Api,
  type AssistantMessage,
  createAssistantMessageEventStream,
  isRetryableAssistantError,
  type Model,
} from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
import { guardModelRuntimeAssistantResponses } from "../../../src/pi/assistant-response-guard.js";
import { createTestModelRuntime } from "../../helpers/pi-model-runtime.js";

const model: Model<Api> = {
  id: "gemini-2.5-flash",
  name: "Local Gemini",
  api: "google-generative-ai",
  provider: "google",
  baseUrl: "http://127.0.0.1",
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 8192,
  maxTokens: 1024,
};
function message(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    stopReason: "stop",
    timestamp: 1,
    rawStopReason: "STOP",
    responseId: "local-response",
    usage: {
      input: 12,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 0,
      totalTokens: 12,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    ...overrides,
  };
}
async function guarded(original: AssistantMessage, endOnly = false) {
  const { modelRuntime } = await createTestModelRuntime();
  const source = createAssistantMessageEventStream();
  modelRuntime.streamSimple = vi.fn(() => source);
  guardModelRuntimeAssistantResponses(modelRuntime);
  const installed = modelRuntime.streamSimple;
  guardModelRuntimeAssistantResponses(modelRuntime);
  expect(modelRuntime.streamSimple).toBe(installed);
  const stream = modelRuntime.streamSimple(model, { messages: [] });
  if (endOnly) source.end(original);
  else if (original.stopReason === "error" || original.stopReason === "aborted") {
    source.push({ type: "error", reason: original.stopReason, error: original });
  } else {
    source.push({ type: "done", reason: "stop", message: original });
  }
  const events = [];
  for await (const event of stream) events.push(event);
  const result = await stream.result();
  const terminal = events.at(-1);
  expect(
    terminal?.type === "error"
      ? terminal.error
      : terminal?.type === "done"
        ? terminal.message
        : null,
  ).toBe(result);
  return result;
}

describe("assistant response boundary", () => {
  it.each(
    (
      [
        [],
        [{ type: "text", text: " \n " }],
        [{ type: "thinking", thinking: "Private thought" }],
      ] as AssistantMessage["content"][]
    ).map((content) => ({ content })),
  )("rejects unusable STOP content %j with a Pi-retryable diagnostic", async ({ content }) => {
    const original = message({ content, diagnostics: [{ type: "existing", timestamp: 1 }] });
    const result = await guarded(original);
    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toBe("Model response ended without visible text or tool calls.");
    expect(isRetryableAssistantError(result)).toBe(true);
    expect(result.content).toBe(original.content);
    expect(result.usage).toBe(original.usage);
    expect(result.rawStopReason).toBe("STOP");
    expect(result.responseId).toBe("local-response");
    expect(result.diagnostics).toEqual([
      original.diagnostics?.[0],
      expect.objectContaining({ details: { originalStopReason: "stop" } }),
    ]);
    expect(original.stopReason).toBe("stop");
  });

  it("does not add diagnostics again for nested runtime decoration", async () => {
    const normalized = await guarded(message());
    const twice = await guarded(normalized);
    expect(twice).toBe(normalized);
    expect(twice.diagnostics).toHaveLength(1);
  });

  it("completeSimple uses the guard with the original options and receiver", async () => {
    const { modelRuntime } = await createTestModelRuntime();
    const controller = new AbortController();
    const options = { signal: controller.signal };
    const context = { messages: [] };
    modelRuntime.streamSimple = function (receivedModel, receivedContext, receivedOptions) {
      expect(this).toBe(modelRuntime);
      expect(receivedModel).toBe(model);
      expect(receivedContext).toBe(context);
      expect(receivedOptions).toBe(options);
      const source = createAssistantMessageEventStream();
      source.end(message());
      return source;
    };
    guardModelRuntimeAssistantResponses(modelRuntime);
    expect((await modelRuntime.completeSimple(model, context, options)).stopReason).toBe("error");
  });

  it("normalizes end(result) without a terminal event", async () => {
    expect((await guarded(message(), true)).stopReason).toBe("error");
  });

  it.each([
    { content: [{ type: "text", text: "Visible answer" }] },
    { content: [{ type: "toolCall", id: "one", name: "test", arguments: {} }] },
    { stopReason: "toolUse" },
    { stopReason: "deferred" },
    { stopReason: "pending" },
    { stopReason: "length" },
    { stopReason: "aborted" },
    { stopReason: "error", errorMessage: "Safety restriction" },
    { errorMessage: "Existing failure" },
  ] satisfies Partial<AssistantMessage>[])(
    "preserves supported terminal result %j",
    async (overrides) => {
      const original = message(overrides);
      expect(await guarded(original)).toBe(original);
    },
  );

  it("contains an unexpected stream failure and retains partial evidence", async () => {
    const { modelRuntime } = await createTestModelRuntime();
    const source = createAssistantMessageEventStream();
    const partial = message({ content: [{ type: "text", text: "Partial" }] });
    source[Symbol.asyncIterator] = async function* () {
      yield { type: "start", partial };
      throw new Error("Transport interrupted");
    };
    modelRuntime.streamSimple = () => source;
    guardModelRuntimeAssistantResponses(modelRuntime);
    const stream = modelRuntime.streamSimple(model, { messages: [] });
    const events = [];
    for await (const event of stream) events.push(event);
    const result = await stream.result();
    expect(result).toMatchObject({
      stopReason: "error",
      errorMessage: "Transport interrupted",
      content: partial.content,
    });
    expect(events.at(-1)).toEqual({ type: "error", reason: "error", error: result });
  });

  it("preserves silent context overflow", async () => {
    const original = message();
    original.usage.input = model.contextWindow + 1;
    expect(await guarded(original)).toBe(original);
  });
});
