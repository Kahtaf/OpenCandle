import { describe, expect, it } from "vitest";
import { getHostedOpenCandleToolDefinitions } from "../../../src/pi/hosted-tool-adapter.js";
import { getOpenCandleToolDefinitions } from "../../../src/pi/tool-adapter.js";

describe("hosted tool adapter", () => {
  it("registers only tools with a complete direct-browser provider path", () => {
    expect(getHostedOpenCandleToolDefinitions().map((tool) => tool.name)).toEqual([
      "get_event_probabilities",
    ]);
  });

  it("does not change the native local tool composition", () => {
    const localNames = getOpenCandleToolDefinitions().map((tool) => tool.name);

    expect(localNames).toContain("get_event_probabilities");
    expect(localNames).toContain("get_stock_quote");
    expect(localNames).toContain("get_reddit_sentiment");
    expect(localNames.length).toBeGreaterThan(20);
  });
});
