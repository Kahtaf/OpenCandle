import { describe, expect, it } from "vitest";
import { getAllTools } from "../../../src/tools/index.js";
import { agentToolToPiTool, getVantageToolDefinitions } from "../../../src/pi/tool-adapter.js";

describe("tool adapter", () => {
  it("maps a Vantage tool to a Pi tool with the same public shape", async () => {
    const source = getAllTools().find((tool) => tool.name === "get_stock_quote");
    expect(source).toBeDefined();

    const adapted = agentToolToPiTool(source!);
    const result = await adapted.execute("tool-1", { symbol: "MSFT" }, undefined, undefined, {} as never);

    expect(adapted.name).toBe(source!.name);
    expect(adapted.label).toBe(source!.label);
    expect(adapted.description).toBe(source!.description);
    expect(adapted.parameters).toBe(source!.parameters);
    expect(adapted.promptSnippet).toContain(source!.name);
    expect(result.content[0].type).toBe("text");
  });

  it("exposes every Vantage tool as a Pi tool definition", () => {
    const sourceNames = getAllTools().map((tool) => tool.name).sort();
    const adaptedNames = getVantageToolDefinitions().map((tool) => tool.name).sort();

    expect(adaptedNames).toEqual(sourceNames);
  });
});
