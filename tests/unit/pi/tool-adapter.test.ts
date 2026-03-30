import { Type } from "@sinclair/typebox";
import { describe, expect, it, vi } from "vitest";
import { agentToolToPiTool, getVantageToolDefinitions } from "../../../src/pi/tool-adapter.js";
import { getAllTools } from "../../../src/tools/index.js";

describe("tool adapter", () => {
  it("maps a Vantage tool to a Pi tool with the same public shape", async () => {
    const execute = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
      details: { symbol: "MSFT" },
    });
    const source = {
      name: "fake_tool",
      label: "Fake Tool",
      description: "A fake tool for adapter tests",
      parameters: Type.Object({
        symbol: Type.String(),
      }),
      execute,
    };

    const adapted = agentToolToPiTool(source);
    const result = await adapted.execute("tool-1", { symbol: "MSFT" }, undefined, undefined, {} as never);

    expect(execute).toHaveBeenCalledWith("tool-1", { symbol: "MSFT" }, undefined, undefined);
    expect(adapted.name).toBe(source.name);
    expect(adapted.label).toBe(source.label);
    expect(adapted.description).toBe(source.description);
    expect(adapted.parameters).toBe(source.parameters);
    expect(adapted.promptSnippet).toContain(source.name);
    expect(result.content[0].type).toBe("text");
  });

  it("exposes every Vantage tool as a Pi tool definition", () => {
    const sourceNames = getAllTools().map((tool) => tool.name).sort();
    const adaptedNames = getVantageToolDefinitions().map((tool) => tool.name).sort();

    expect(adaptedNames).toEqual(sourceNames);
  });
});
