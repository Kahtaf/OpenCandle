import { Type } from "@sinclair/typebox";
import { describe, expect, it, vi } from "vitest";
import { agentToolToPiTool, getOpenCandleToolDefinitions } from "../../../src/pi/tool-adapter.js";
import { getAllTools } from "../../../src/tools/index.js";

describe("tool adapter", () => {
  it("maps an OpenCandle tool to a Pi tool with the same public shape", async () => {
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
    const ctx = {} as never;
    const result = await adapted.execute("tool-1", { symbol: "MSFT" }, undefined, undefined, ctx);

    expect(execute).toHaveBeenCalledWith("tool-1", { symbol: "MSFT" }, undefined, undefined, ctx);
    expect(adapted.name).toBe(source.name);
    expect(adapted.label).toBe(source.label);
    expect(adapted.description).toBe(source.description);
    expect(adapted.parameters).toBe(source.parameters);
    expect(adapted.promptSnippet).toContain(source.name);
    expect(result.content[0].type).toBe("text");
  });

  it("exposes every OpenCandle tool as a Pi tool definition", () => {
    const sourceNames = getAllTools()
      .map((tool) => tool.name)
      .sort();
    const adaptedNames = getOpenCandleToolDefinitions()
      .map((tool) => tool.name)
      .sort();

    expect(adaptedNames).toEqual(sourceNames);
  });

  it("strips tool metadata defaults before wrapping tool params", async () => {
    vi.resetModules();
    const defaultsPassedToWrapper: Array<Record<string, unknown>> = [];
    const fakeTool = {
      name: "fake_tool",
      label: "Fake Tool",
      description: "Fake tool",
      parameters: Type.Object({ symbol: Type.String() }),
      execute: vi.fn(),
    };

    vi.doMock("../../../src/tools/index.js", () => ({
      getAllTools: () => [fakeTool],
    }));
    vi.doMock("../../../src/memory/tool-defaults.js", () => ({
      getDefaults: () => ({ __enabled: true, symbol: "NVDA" }),
    }));
    vi.doMock("../../../src/runtime/tool-defaults-wrapper.js", () => ({
      wrapWithDefaults: (tool: typeof fakeTool, defaults: Record<string, unknown>) => {
        defaultsPassedToWrapper.push(defaults);
        return tool;
      },
    }));

    const { getOpenCandleToolDefinitions: getDefinitions } = await import(
      "../../../src/pi/tool-adapter.js"
    );

    expect(getDefinitions().map((tool) => tool.name)).toEqual(["fake_tool"]);
    expect(defaultsPassedToWrapper).toEqual([{ symbol: "NVDA" }]);

    vi.doUnmock("../../../src/tools/index.js");
    vi.doUnmock("../../../src/memory/tool-defaults.js");
    vi.doUnmock("../../../src/runtime/tool-defaults-wrapper.js");
    vi.resetModules();
  });
});
