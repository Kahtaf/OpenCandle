import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { getSeries } from "../../providers/fred.js";
import { getConfig } from "../../config.js";
import { FRED_SERIES } from "../../types/macro.js";
import type { FredSeries } from "../../types/macro.js";

const params = Type.Object({
  series_id: Type.String({
    description: `FRED series ID. Common ones: ${Object.entries(FRED_SERIES).map(([k, v]) => `${v} (${k})`).join(", ")}`,
  }),
  limit: Type.Optional(
    Type.Number({ description: "Number of observations to return. Default: 30" }),
  ),
});

export const fredDataTool: AgentTool<typeof params, FredSeries> = {
  name: "get_economic_data",
  label: "FRED Economic Data",
  description:
    "Get economic data from FRED (Federal Reserve Economic Data): interest rates, CPI, GDP, unemployment, yield curve, and more. Requires FRED_API_KEY.",
  parameters: params,
  async execute(toolCallId, args) {
    const apiKey = getConfig().fredApiKey;
    if (!apiKey) {
      throw new Error("FRED API key not configured. Set FRED_API_KEY or add ~/.opencandle/config.json. Get a free key at https://fred.stlouisfed.org/docs/api/api_key.html");
    }

    const limit = args.limit ?? 30;
    const series = await getSeries(args.series_id.toUpperCase(), apiKey, limit);

    const latest = series.observations[series.observations.length - 1];
    const header = `**${series.title}** (${series.id})`;
    const meta = `Units: ${series.units} | Frequency: ${series.frequency} | Last updated: ${series.lastUpdated}`;
    const current = latest ? `Latest: ${latest.value} (${latest.date})` : "No data";

    // Show last 10 observations
    const recent = series.observations.slice(-10);
    const table = recent.map((o) => `${o.date}: ${o.value}`).join("\n");

    const text = [header, meta, current, "", "Recent observations:", table].join("\n");
    return { content: [{ type: "text", text }], details: series };
  },
};
