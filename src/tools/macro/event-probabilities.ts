import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { searchPredictionMarkets } from "../../providers/polymarket.js";
import { wrapProvider } from "../../providers/wrap-provider.js";
import type { PredictionMarketQuote } from "../../types/prediction-markets.js";

const LOW_LIQUIDITY_VOLUME_USD = 10_000;

const params = Type.Object({
  query: Type.String({
    minLength: 1,
    description: "Free-text event question to search on Polymarket.",
  }),
  limit: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 50,
      description: "Maximum number of outcome quotes to return. Default: 8.",
    }),
  ),
});

export const eventProbabilitiesTool: AgentTool<typeof params, PredictionMarketQuote[]> = {
  name: "get_event_probabilities",
  label: "Event Probabilities",
  description:
    "Search Polymarket for market-implied event probabilities. Fetches and formats probabilities only; it does not analyze or forecast outcomes.",
  parameters: params,
  async execute(_toolCallId, args) {
    const query = args.query.trim();
    const limit = args.limit ?? 8;
    const result = await wrapProvider("polymarket", () => searchPredictionMarkets(query, limit));

    if (result.status === "unavailable") {
      return {
        content: [
          {
            type: "text",
            text: [
              `Polymarket prediction markets unavailable for "${query}" (${result.reason}).`,
              "",
              caveatText(),
            ].join("\n"),
          },
        ],
        details: [] as PredictionMarketQuote[],
      };
    }

    const quotes = result.data;
    const text =
      quotes.length === 0
        ? [`No Polymarket prediction markets found for "${query}".`, "", caveatText()].join("\n")
        : [
            `**Polymarket event probabilities for "${query}"**`,
            "",
            ...quotes.map(formatQuote),
            "",
            caveatText(),
          ].join("\n");

    return { content: [{ type: "text", text }], details: quotes };
  },
};

function formatQuote(quote: PredictionMarketQuote): string {
  return [
    `- ${formatPercent(quote.probability)} - ${quote.outcome}: ${quote.title}`,
    `  Volume: ${formatUsd(quote.volumeUsd)} | Liquidity: ${formatUsd(quote.liquidityUsd)} | Close: ${quote.closeDate ?? "unknown"}`,
    quote.volumeUsd !== undefined && quote.volumeUsd < LOW_LIQUIDITY_VOLUME_USD
      ? "  LOW-LIQUIDITY: volume under $10,000"
      : undefined,
    `  Resolution criteria: ${quote.resolutionCriteria ?? "Resolution criteria unavailable from Polymarket."}`,
    `  URL: ${quote.url}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatUsd(value: number | undefined): string {
  if (value === undefined) return "unavailable";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function caveatText(): string {
  return [
    "Caveats:",
    "- These are market-implied probabilities from trader positioning, not calibrated forecasts.",
    "- Thin markets can show noisy or stale prices; results with volume under $10,000 are explicitly flagged low-liquidity.",
    "- Polymarket is a crypto-settled venue with platform and settlement risks distinct from regulated exchanges.",
  ].join("\n");
}
