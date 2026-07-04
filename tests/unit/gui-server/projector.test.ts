import type { Message } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { projectDashboard } from "../../../gui/server/projector.js";

describe("projectDashboard", () => {
  it("upserts watchlist rows from stock quote tool results regardless of source", () => {
    const state = projectDashboard([
      messageEntry({
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "get_stock_quote",
        content: [{ type: "text", text: "NVDA quote" }],
        details: { symbol: "NVDA", price: 100, changePercent: 1.5 },
        isError: false,
        timestamp: Date.now(),
      }),
    ]);

    expect(state.watchlist).toMatchObject([
      { symbol: "NVDA", quote: { price: 100, changePercent: 1.5 } },
    ]);
  });

  it("unwraps UI tool result metadata before projecting quote details", () => {
    const state = projectDashboard([
      messageEntry({
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "get_stock_quote",
        content: [{ type: "text", text: "NVDA quote" }],
        details: {
          source: "ui",
          args: { symbol: "NVDA" },
          value: { symbol: "NVDA", price: 215.2, changePercent: 1.75 },
        },
        isError: false,
        timestamp: Date.now(),
      }),
    ]);

    expect(state.watchlist[0].quote).toMatchObject({ price: 215.2, changePercent: 1.75 });
  });

  it("projects background quote refreshes without requiring chat transcript entries", () => {
    const state = projectDashboard([
      customEntry("opencandle-quote-refresh", {
        symbol: "NVDA",
        toolName: "get_stock_quote",
        value: { symbol: "NVDA", price: 216, changePercent: 2 },
        content: [{ type: "text", text: "NVDA quote" }],
        isError: false,
      }),
    ]);

    expect(state.watchlist[0].quote).toMatchObject({ price: 216, changePercent: 2 });
  });

  it("opens and closes active analyses from workflow and assistant stop entries", () => {
    const state = projectDashboard([
      customEntry("opencandle-workflow", {
        workflow: "comprehensive_analysis",
        resolvedSlots: { symbol: "NVDA" },
        analystsTotal: 3,
      }),
      messageEntry({
        role: "assistant",
        content: [{ type: "text", text: "Done" }],
        api: "openai-responses",
        provider: "openai",
        model: "test",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: Date.now(),
      }),
    ]);

    expect(state.activeAnalyses).toEqual([]);
    expect(state.recentResearch).toMatchObject([
      { workflow: "comprehensive_analysis", symbol: "NVDA" },
    ]);
  });

  it("counts completed analyst steps from opencandle analyst-step entries", () => {
    const state = projectDashboard([
      customEntry("opencandle-workflow", {
        workflow: "comprehensive_analysis",
        resolvedSlots: { symbol: "NVDA" },
        analystsTotal: 5,
      }),
      customEntry("opencandle-analyst-step", {
        stage: "analyst_valuation",
        role: "valuation",
        signal: "BUY",
        conviction: 8,
        parsed: true,
      }),
      customEntry("opencandle-analyst-step", {
        stage: "analyst_momentum",
        role: "momentum",
        parsed: false,
      }),
    ]);

    expect(state.activeAnalyses[0]).toMatchObject({
      workflow: "comprehensive_analysis",
      symbol: "NVDA",
      analystsTotal: 5,
      analystsDone: 2,
    });
  });

  it("does not count debate stages toward analystsDone", () => {
    const state = projectDashboard([
      customEntry("opencandle-workflow", {
        workflow: "comprehensive_analysis",
        resolvedSlots: { symbol: "NVDA" },
        analystsTotal: 5,
      }),
      customEntry("opencandle-analyst-step", {
        stage: "analyst_valuation",
        role: "valuation",
        parsed: true,
      }),
      customEntry("opencandle-analyst-step", {
        stage: "debate_bull",
        side: "bull",
        parsed: true,
      }),
      customEntry("opencandle-analyst-step", {
        stage: "debate_rebuttal",
        side: "bull",
        parsed: true,
      }),
    ]);

    // debate_* entries share the analyst-step entry type but are not
    // analysts; counting them can report 5/5 from 3 analysts + 2 debates.
    expect(state.activeAnalyses[0]).toMatchObject({
      analystsTotal: 5,
      analystsDone: 1,
    });
  });

  it("projects turn gaps and credential-required hard skips into data quality", () => {
    const state = projectDashboard([
      customEntry("opencandle-turn-gap", {
        softGaps: [{ provider: "brave" }],
      }),
      messageEntry({
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "get_sentiment_summary",
        content: [
          { type: "text", text: "[OPENCANDLE_CREDENTIAL_REQUIRED provider=alpha_vantage]" },
        ],
        details: null,
        isError: false,
        timestamp: Date.now(),
      }),
    ]);

    expect(state.dataQuality.softGaps[0].provider).toBe("brave");
    expect(state.dataQuality.hardSkips[0].provider).toBe("alpha_vantage");
  });

  it("projects direct UI tool provider gaps into data quality", () => {
    const state = projectDashboard([
      messageEntry({
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "get_economic_data",
        content: [{ type: "text", text: "⚠ FRED data unavailable for DGS10 (HTTP 400 )." }],
        details: null,
        isError: false,
        timestamp: Date.now(),
      }),
      messageEntry({
        role: "toolResult",
        toolCallId: "call-2",
        toolName: "search_web",
        content: [
          {
            type: "text",
            text: '[OPENCANDLE_SOFT_DEGRADED provider=brave fallback=ddg remediation="run /connect search to enable Brave"]\n\nWeb results',
          },
        ],
        details: null,
        isError: false,
        timestamp: Date.now(),
      }),
    ]);

    expect(state.dataQuality.softGaps.map((gap) => gap.provider)).toEqual(["fred", "brave"]);
  });

  it("projects Reddit external-tool-required results into data quality", () => {
    const state = projectDashboard([
      messageEntry({
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "get_reddit_sentiment",
        content: [
          {
            type: "text",
            text: '[OPENCANDLE_EXTERNAL_TOOL_REQUIRED provider=reddit reason=not_installed installCmd="uv tool install rdt-cli"]',
          },
        ],
        details: null,
        isError: false,
        timestamp: Date.now(),
      }),
    ]);

    expect(state.dataQuality.softGaps.map((gap) => gap.provider)).toEqual(["reddit"]);
  });

  it("does not double count soft gaps that are present in tool results and turn sidecars", () => {
    const state = projectDashboard([
      messageEntry({
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "search_web",
        content: [
          {
            type: "text",
            text: '[OPENCANDLE_SOFT_DEGRADED provider=brave fallback=ddg remediation="run /connect search to enable Brave"]\n\nWeb results',
          },
        ],
        details: null,
        isError: false,
        timestamp: Date.now(),
      }),
      customEntry("opencandle-turn-gap", {
        annotation:
          '[OPENCANDLE_SKIPPED provider=brave reason=credential_not_provided remediation="run /connect brave to unlock"]',
      }),
    ]);

    expect(state.dataQuality.softGaps.map((gap) => gap.provider)).toEqual(["brave"]);
  });
});

function messageEntry(message: Message): SessionEntry {
  return {
    type: "message",
    id: crypto.randomUUID(),
    parentId: null,
    timestamp: new Date().toISOString(),
    message,
  } as SessionEntry;
}

function customEntry(customType: string, data: unknown): SessionEntry {
  return {
    type: "custom",
    id: crypto.randomUUID(),
    parentId: null,
    timestamp: new Date().toISOString(),
    customType,
    data,
  } as SessionEntry;
}
