import { describe, expect, it, vi } from "vitest";
import { createPiAiRouterClient } from "../../../src/routing/router-llm-client.js";

const { mockCompleteSimple } = vi.hoisted(() => ({
  mockCompleteSimple: vi.fn(),
}));

vi.mock("@earendil-works/pi-ai/compat", () => ({
  completeSimple: mockCompleteSimple,
}));

describe("createPiAiRouterClient", () => {
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
    expect(mockCompleteSimple.mock.calls[0]![2]).toMatchObject({ temperature: 0 });
    expect(mockCompleteSimple.mock.calls[1]![2]).not.toHaveProperty("temperature");
  });
});
