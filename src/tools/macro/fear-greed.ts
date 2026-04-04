import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { getFearGreedIndex } from "../../providers/fear-greed.js";
import { wrapProvider } from "../../providers/wrap-provider.js";
import type { FearGreedData } from "../../types/sentiment.js";

const params = Type.Object({});

export const fearGreedTool: AgentTool<typeof params, FearGreedData> = {
  name: "get_fear_greed",
  label: "Fear & Greed Index",
  description:
    "Get the Crypto Fear & Greed Index (alternative.me) — a sentiment indicator from 0 (Extreme Fear) to 100 (Extreme Greed). Includes current value and previous close.",
  parameters: params,
  async execute(toolCallId, _args) {
    const result = await wrapProvider("feargreed", () => getFearGreedIndex());
    if (result.status === "unavailable") {
      return {
        content: [{ type: "text", text: `⚠ Fear & Greed Index unavailable (${result.reason}).` }],
        details: null as any,
      };
    }
    const fg = result.data;

    const gauge = buildGauge(fg.value);
    const text = [
      `**Fear & Greed Index: ${fg.value} — ${fg.label}**`,
      gauge,
      `Previous Close: ${fg.previousClose}${fg.weekAgo != null ? ` | Week Ago: ${fg.weekAgo}` : ""}${fg.monthAgo != null ? ` | Month Ago: ${fg.monthAgo}` : ""}`,
    ].join("\n");

    return { content: [{ type: "text", text }], details: fg };
  },
};

function buildGauge(value: number): string {
  const width = 20;
  const pos = Math.round((value / 100) * width);
  const bar = "█".repeat(pos) + "░".repeat(width - pos);
  return `[${bar}] ${value}/100`;
}
