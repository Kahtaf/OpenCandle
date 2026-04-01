import { Type } from "@sinclair/typebox";
import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { getThirdPartyToolDescriptions, registerOpenCandleTools } from "../../src/tool-kit.js";

describe("tool kit", () => {
  it("dedupes third-party tool descriptions across repeated registrations", () => {
    const pi = {
      registerTool: vi.fn(),
    } as unknown as ExtensionAPI;

    const params = Type.Object({
      symbol: Type.String(),
    });

    const tool: AgentTool<typeof params> = {
      name: "example_tool",
      label: "Example Tool",
      description: "Example description",
      parameters: params,
      execute: vi.fn(async () => ({
        content: [{ type: "text" as const, text: "ok" }],
      })),
    };

    registerOpenCandleTools(pi, [tool]);
    registerOpenCandleTools(pi, [tool]);

    expect(pi.registerTool).toHaveBeenCalledTimes(2);
    expect(getThirdPartyToolDescriptions()).toEqual([
      { name: "example_tool", description: "Example description" },
    ]);
  }, 30000);
});
