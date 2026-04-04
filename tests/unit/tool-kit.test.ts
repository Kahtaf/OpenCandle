import { Type } from "@sinclair/typebox";
import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { createTool, getAddonToolDescriptions, registerTools } from "../../src/tool-kit.js";

function makeTool(name: string, description = "Test description"): AgentTool<any> {
  return {
    name,
    label: name,
    description,
    parameters: Type.Object({ symbol: Type.String() }),
    execute: vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ok" }],
    })),
  };
}

function makePi(): ExtensionAPI {
  return { registerTool: vi.fn() } as unknown as ExtensionAPI;
}

describe("registerTools", () => {
  it("dedupes addon tool descriptions across repeated registrations", () => {
    const pi = makePi();
    const tool = makeTool("example_tool", "Example description");

    registerTools(pi, [tool]);
    registerTools(pi, [tool]);

    expect(pi.registerTool).toHaveBeenCalledTimes(2);
    expect(getAddonToolDescriptions()).toContainEqual(
      { name: "example_tool", description: "Example description" },
    );
  });

  it("warns to stderr when registering a duplicate tool name", () => {
    const pi = makePi();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const toolA = makeTool("duplicate_check_tool");
    registerTools(pi, [toolA]);
    registerTools(pi, [toolA]);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('"duplicate_check_tool" already registered'),
    );
    warnSpy.mockRestore();
  });

  it("does not warn for unique tool names", () => {
    const pi = makePi();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const tool = makeTool("unique_tool_abc");
    registerTools(pi, [tool]);

    const calls = warnSpy.mock.calls.filter((c) =>
      String(c[0]).includes("unique_tool_abc"),
    );
    expect(calls).toHaveLength(0);
    warnSpy.mockRestore();
  });
});

describe("createTool", () => {
  it("creates a valid AgentTool from config", () => {
    const tool = createTool({
      name: "get_twitter_sentiment",
      label: "Twitter Sentiment",
      description: "Analyze Twitter/X sentiment for a ticker",
      parameters: Type.Object({ symbol: Type.String() }),
      execute: async () => ({
        content: [{ type: "text" as const, text: "ok" }],
        details: {},
      }),
    });

    expect(tool.name).toBe("get_twitter_sentiment");
    expect(tool.label).toBe("Twitter Sentiment");
    expect(tool.description).toBe("Analyze Twitter/X sentiment for a ticker");
    expect(tool.parameters).toBeDefined();
    expect(tool.execute).toBeInstanceOf(Function);
  });

  it("rejects camelCase name", () => {
    expect(() =>
      createTool({
        name: "twitterSentiment",
        label: "Twitter",
        description: "desc",
        parameters: Type.Object({}),
        execute: async () => ({ content: [{ type: "text" as const, text: "" }], details: {} }),
      }),
    ).toThrow(/must be snake_case and start with a verb prefix/);
  });

  it("rejects name without verb prefix", () => {
    expect(() =>
      createTool({
        name: "sentiment_twitter",
        label: "Twitter",
        description: "desc",
        parameters: Type.Object({}),
        execute: async () => ({ content: [{ type: "text" as const, text: "" }], details: {} }),
      }),
    ).toThrow(/must be snake_case and start with a verb prefix/);
  });

  it("rejects empty description", () => {
    expect(() =>
      createTool({
        name: "get_sentiment",
        label: "Sentiment",
        description: "",
        parameters: Type.Object({}),
        execute: async () => ({ content: [{ type: "text" as const, text: "" }], details: {} }),
      }),
    ).toThrow(/requires a non-empty description/);
  });

  it("rejects missing parameters", () => {
    expect(() =>
      createTool({
        name: "get_sentiment",
        label: "Sentiment",
        description: "desc",
        parameters: undefined as any,
        execute: async () => ({ content: [{ type: "text" as const, text: "" }], details: {} }),
      }),
    ).toThrow(/requires parameters/);
  });
});
