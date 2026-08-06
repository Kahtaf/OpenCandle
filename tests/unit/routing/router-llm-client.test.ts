import { beforeEach, describe, expect, it, vi } from "vitest";
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
});
