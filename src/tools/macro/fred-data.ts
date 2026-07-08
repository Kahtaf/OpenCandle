import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { getConfig } from "../../config.js";
import { withCredentialCheck } from "../../onboarding/tool-helpers.js";
import { getSeries } from "../../providers/fred.js";
import { wrapProvider } from "../../providers/wrap-provider.js";
import type { FredSeries } from "../../types/macro.js";
import { FRED_SERIES } from "../../types/macro.js";

const params = Type.Object({
  series_id: Type.String({
    description: `FRED series ID. Common ones: ${Object.entries(FRED_SERIES)
      .map(([k, v]) => `${v} (${k})`)
      .join(", ")}`,
  }),
  limit: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 1000,
      description: "Number of observations to return. Default: 30",
    }),
  ),
});

export const fredDataTool: AgentTool<
  typeof params,
  FredSeries | { credentialRequired: unknown } | null
> = {
  name: "get_economic_data",
  label: "FRED Economic Data",
  description:
    "Get economic data from FRED (Federal Reserve Economic Data): interest rates, CPI, GDP, unemployment, yield curve, and more. Requires FRED.",
  parameters: params,
  async execute(_toolCallId, args) {
    return withCredentialCheck("fred", async () => {
      const apiKey = getConfig().fredApiKey;
      if (!apiKey) throw new Error("FRED credential is missing.");
      const seriesId = args.series_id.toUpperCase();
      const limit = normalizeLimit(seriesId, args.limit);
      const result = await wrapProvider("fred", () => getSeries(seriesId, apiKey, limit));
      if (result.status === "unavailable") {
        return {
          content: [
            { type: "text", text: `⚠ FRED data unavailable for ${seriesId} (${result.reason}).` },
          ],
          details: null,
        };
      }
      const series = result.data;

      const latest = series.observations[series.observations.length - 1];
      const header = `**${series.title}** (${series.id})`;
      const meta = `Units: ${series.units} | Frequency: ${series.frequency} | Last updated: ${series.lastUpdated}`;
      const current = latest ? `Latest: ${latest.value} (${latest.date})` : "No data";
      const derived = formatDerivedChange(series);

      // Show last 10 observations
      const recent = series.observations.slice(-10);
      const table = recent.map((o) => `${o.date}: ${o.value}`).join("\n");

      const text = [header, meta, current, derived, "", "Recent observations:", table]
        .filter(Boolean)
        .join("\n");
      const prefix = result.stale
        ? `⚠ Using cached FRED data from ${result.timestamp} (FRED unavailable)\n`
        : "";
      return { content: [{ type: "text", text: prefix + text }], details: series };
    });
  },
};

function normalizeLimit(seriesId: string, requested: number | undefined): number {
  const limit = requested ?? 30;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error("limit must be an integer between 1 and 1000.");
  }
  if (seriesId === FRED_SERIES.CPI && limit < 13) return 13;
  return limit;
}

function formatDerivedChange(series: FredSeries): string | null {
  const latest = series.observations.at(-1);
  if (!latest) return null;
  if (!/monthly/i.test(series.frequency) || !/\bindex\b/i.test(series.units)) return null;

  const latestYear = Number(latest.date.slice(0, 4));
  const monthDay = latest.date.slice(4);
  const prior = series.observations.find(
    (observation) => observation.date === `${latestYear - 1}${monthDay}`,
  );
  if (!prior || prior.value === 0) return null;

  const pct = (latest.value / prior.value - 1) * 100;
  return `Derived YoY change: ${pct.toFixed(2)}% (${prior.date} to ${latest.date}).`;
}
