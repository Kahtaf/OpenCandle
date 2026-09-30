import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  modelSetupProviders,
  resolveFirstClassModel,
} from "../../../src/pi/model-provider-catalog.js";
import { createPiAiRouterClient } from "../../../src/routing/router-llm-client.js";

const { mockCompleteSimple } = vi.hoisted(() => ({
  mockCompleteSimple: vi.fn(),
}));

vi.mock("@earendil-works/pi-ai/compat", () => ({
  completeSimple: mockCompleteSimple,
}));

describe("createPiAiRouterClient", () => {
  beforeEach(() => {
    mockCompleteSimple.mockReset();
  });

  it("retries without temperature when the provider rejects that option", async () => {
    mockCompleteSimple
      .mockRejectedValueOnce(new Error("Unsupported parameter: 'temperature' is not supported"))
      .mockResolvedValueOnce({
        stopReason: "stop",
        content: [{ type: "text", text: "Memory Stock Selloff" }],
      });

    const client = createPiAiRouterClient({} as any);

    await expect(client.complete("title this session")).resolves.toBe("Memory Stock Selloff");
    expect(mockCompleteSimple).toHaveBeenCalledTimes(2);
    expect(mockCompleteSimple.mock.calls[0]?.[2]).toMatchObject({ temperature: 0 });
    expect(mockCompleteSimple.mock.calls[1]?.[2]).not.toHaveProperty("temperature");
  });

  it("retries when Pi reports an unsupported temperature as an error response", async () => {
    mockCompleteSimple
      .mockResolvedValueOnce({
        stopReason: "error",
        errorMessage: "Unsupported parameter: 'temperature' is not supported with this model.",
        content: [],
      })
      .mockResolvedValueOnce({
        stopReason: "stop",
        content: [{ type: "text", text: "Investment Decision" }],
      });

    const client = createPiAiRouterClient({} as any);

    await expect(client.complete("route this session")).resolves.toBe("Investment Decision");
    expect(mockCompleteSimple).toHaveBeenCalledTimes(2);
    expect(mockCompleteSimple.mock.calls[1]?.[2]).not.toHaveProperty("temperature");
  });

  it("uses an injected Pi model runtime completion path for routing", async () => {
    const complete = vi.fn(async () => ({
      stopReason: "stop",
      content: [{ type: "text", text: "shared runtime result" }],
    }));
    const selectedModel = { provider: "anthropic", id: "claude-haiku-4-5" } as any;

    const client = createPiAiRouterClient(selectedModel, complete as any);

    await expect(client.complete("route this")).resolves.toBe("shared runtime result");
    expect(complete).toHaveBeenCalledWith(
      selectedModel,
      expect.objectContaining({ tools: [] }),
      expect.objectContaining({ temperature: 0 }),
    );
    expect(mockCompleteSimple).not.toHaveBeenCalled();
  });

  it("forwards a per-call abort signal into the Pi completion options", async () => {
    const complete = vi.fn(async () => ({
      stopReason: "stop",
      content: [{ type: "text", text: "shared runtime result" }],
    }));
    const client = createPiAiRouterClient({} as any, complete as any);
    const controller = new AbortController();

    await expect(client.complete("route this", controller.signal)).resolves.toBe(
      "shared runtime result",
    );
    expect(complete).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ tools: [] }),
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("omits temperature for Pi reasoning models", async () => {
    const complete = vi.fn(async () => ({
      stopReason: "stop",
      content: [{ type: "text", text: "Reasoning Model Route" }],
    }));
    const selectedModel = {
      provider: "openai",
      id: "gpt-5-mini",
      reasoning: true,
    } as any;

    const client = createPiAiRouterClient(selectedModel, complete as any);

    await expect(client.complete("route this")).resolves.toBe("Reasoning Model Route");
    expect(complete).toHaveBeenCalledWith(
      selectedModel,
      expect.objectContaining({ tools: [] }),
      expect.not.objectContaining({ temperature: expect.anything() }),
    );
  });

  it("sends the default OpenAI model no temperature and a supported reasoning effort", async () => {
    const openai = modelSetupProviders.find(({ id }) => id === "openai");
    const defaultModel = resolveFirstClassModel(openai?.defaultProvider, openai?.defaultModel);
    expect(defaultModel).toBeDefined();
    if (!defaultModel) return;
    const actual = await vi.importActual<typeof import("@earendil-works/pi-ai/compat")>(
      "@earendil-works/pi-ai/compat",
    );
    const payloads: unknown[] = [];
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("network disabled in unit tests"));
    try {
      const client = createPiAiRouterClient(defaultModel, (model, request, options) =>
        actual.completeSimple(model, request, {
          ...options,
          apiKey: "test-key",
          maxRetries: 0,
          onPayload: (payload) => {
            payloads.push(payload);
            return undefined;
          },
        }),
      );

      await expect(client.complete("route this")).rejects.toThrow(/router LLM call failed/);
    } finally {
      fetchSpy.mockRestore();
    }

    expect(payloads).toHaveLength(1);
    const payload = payloads[0] as Record<string, unknown>;
    expect(payload).toMatchObject({ model: defaultModel.id });
    expect(payload).not.toHaveProperty("temperature");
    expect(payload).toMatchObject({ reasoning: { effort: "low" } });
  });
});
