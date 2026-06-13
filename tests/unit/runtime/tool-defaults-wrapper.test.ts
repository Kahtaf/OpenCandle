import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { describe, expect, it, vi } from "vitest";
import { wrapWithDefaults } from "../../../src/runtime/tool-defaults-wrapper.js";

const params = Type.Object({
  symbol: Type.String(),
  filters: Type.Optional(
    Type.Object({
      min_iv: Type.Optional(Type.Number()),
      max_spread: Type.Optional(Type.Number()),
    }),
  ),
});

describe("wrapWithDefaults", () => {
  it("lets explicit args win over defaults", async () => {
    const execute = vi.fn(async (_id, args) => ({ content: [], details: args }));
    const tool = fakeTool(execute);
    const wrapped = wrapWithDefaults(tool, { symbol: "NVDA" });

    await wrapped.execute("call-1", { symbol: "AMD" });

    expect(execute).toHaveBeenCalledWith("call-1", { symbol: "AMD" }, undefined, undefined);
  });

  it("deep-merges nested defaults", async () => {
    const execute = vi.fn(async (_id, args) => ({ content: [], details: args }));
    const tool = fakeTool(execute);
    const wrapped = wrapWithDefaults(tool, {
      symbol: "NVDA",
      filters: { min_iv: 0.25, max_spread: 0.1 },
    });

    await wrapped.execute("call-1", { symbol: "NVDA", filters: { max_spread: 0.2 } });

    expect(execute.mock.calls[0][1]).toEqual({
      symbol: "NVDA",
      filters: { min_iv: 0.25, max_spread: 0.2 },
    });
  });

  it("passes args through when no defaults exist", async () => {
    const execute = vi.fn(async (_id, args) => ({ content: [], details: args }));
    const tool = fakeTool(execute);
    const wrapped = wrapWithDefaults(tool, {});

    await wrapped.execute("call-1", { symbol: "NVDA" });

    expect(execute.mock.calls[0][1]).toEqual({ symbol: "NVDA" });
  });

  it("preserves schema and metadata", () => {
    const tool = fakeTool(async (_id, args) => ({ content: [], details: args }));
    const wrapped = wrapWithDefaults(tool, { symbol: "NVDA" });

    expect(wrapped.parameters).toBe(tool.parameters);
    expect(wrapped.name).toBe(tool.name);
    expect(wrapped.label).toBe(tool.label);
    expect(wrapped.description).toBe(tool.description);
  });
});

function fakeTool(
  execute: AgentTool<typeof params, unknown>["execute"],
): AgentTool<typeof params, unknown> {
  return {
    name: "get_stock_quote",
    label: "Stock Quote",
    description: "Get quote",
    parameters: params,
    execute,
  };
}
