import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type TSchema, Type } from "@sinclair/typebox";
import {
  hasCredential,
  type ProviderId,
  resolveHostedBrowserCapabilityReport,
} from "../onboarding/providers.js";
import { companyOverviewTool } from "../tools/fundamentals/company-overview.js";
import { compsTool } from "../tools/fundamentals/comps.js";
import { dcfTool } from "../tools/fundamentals/dcf.js";
import { earningsTool } from "../tools/fundamentals/earnings.js";
import { financialsTool } from "../tools/fundamentals/financials.js";
import { secFilingsTool } from "../tools/fundamentals/sec-filings.js";
import { eventProbabilitiesTool } from "../tools/macro/event-probabilities.js";
import { fearGreedTool } from "../tools/macro/fear-greed.js";
import { fredDataTool } from "../tools/macro/fred-data.js";
import { cryptoHistoryTool } from "../tools/market/crypto-history.js";
import { cryptoPriceTool } from "../tools/market/crypto-price.js";
import { priceComparisonTool } from "../tools/market/price-comparison.js";
import { screenStocksTool } from "../tools/market/screen-stocks.js";
import { searchTickerTool } from "../tools/market/search-ticker.js";
import { stockHistoryTool } from "../tools/market/stock-history.js";
import { stockQuoteTool } from "../tools/market/stock-quote.js";
import { optionChainTool } from "../tools/options/option-chain.js";
import { correlationTool } from "../tools/portfolio/correlation.js";
import { holdingsOverlapTool } from "../tools/portfolio/holdings-overlap.js";
import { riskAnalysisTool } from "../tools/portfolio/risk-analysis.js";
import { createHostedSentimentSummaryTool } from "../tools/sentiment/hosted-sentiment-summary.js";
import { createWebSearchTool, webSearchParameters } from "../tools/sentiment/web-search.js";
import { backtestTool } from "../tools/technical/backtest.js";
import { technicalIndicatorsTool } from "../tools/technical/indicators.js";
import { agentToolToPiTool } from "./tool-adapter-core.js";

interface HostedToolPolicy {
  readonly tool: ReturnType<typeof agentToolToPiTool>;
  readonly anyProviders: readonly ProviderId[];
  readonly credentialRequiredProviders: ReadonlySet<ProviderId>;
}

const hosted = (
  tool: Parameters<typeof agentToolToPiTool>[0],
  anyProviders: readonly ProviderId[],
  credentialRequiredProviders: readonly ProviderId[] = [],
): HostedToolPolicy => ({
  tool: agentToolToPiTool(tool),
  anyProviders,
  credentialRequiredProviders: new Set(credentialRequiredProviders),
});

function withParameters<TParams extends TSchema, TDetails, TState>(
  tool: ToolDefinition<TParams, TDetails, TState>,
  parameters: TSchema,
): ReturnType<typeof agentToolToPiTool> {
  // The hosted schemas only narrow parameters accepted by the canonical tool.
  return { ...tool, parameters } as unknown as ReturnType<typeof agentToolToPiTool>;
}

const DAILY_ONLY_STOCK_HISTORY = withParameters(
  agentToolToPiTool(stockHistoryTool),
  Type.Composite([
    Type.Omit(stockHistoryTool.parameters, ["interval"]),
    Type.Object({
      interval: Type.Optional(
        Type.Union([Type.Literal("1d"), Type.Literal("1wk"), Type.Literal("1mo")], {
          description: "Data interval: 1d, 1wk, or 1mo. Default: 1d",
        }),
      ),
    }),
  ]),
);

const DAILY_ONLY_PRICE_COMPARISON = withParameters(
  agentToolToPiTool(priceComparisonTool),
  Type.Composite([
    Type.Omit(priceComparisonTool.parameters, ["interval"]),
    Type.Object({
      interval: Type.Optional(
        Type.Union([Type.Literal("1d"), Type.Literal("1wk"), Type.Literal("1mo")], {
          description: "Data interval: 1d, 1wk, or 1mo. Default: 1d",
        }),
      ),
    }),
  ]),
);

const HOSTED_SCREEN_STOCKS = withParameters(
  agentToolToPiTool(screenStocksTool),
  Type.Composite([
    Type.Omit(screenStocksTool.parameters, ["market"]),
    Type.Object({
      market: Type.Optional(
        Type.Union([Type.Literal("america"), Type.Literal("global")], {
          description: "TradingView market: america or global. Default: america",
        }),
      ),
    }),
  ]),
);

const HOSTED_STOCK_HISTORY = hosted(
  stockHistoryTool,
  ["alpha_vantage", "lse", "yahoo"],
  ["alpha_vantage", "lse"],
);

function hostedSearchProviders(available: ReadonlySet<string>) {
  return [
    ...(available.has("exa") ? (["exa"] as const) : []),
    ...(available.has("brave") && hasCredential("brave") ? (["brave"] as const) : []),
    ...(available.has("ddg") ? (["ddg"] as const) : []),
  ];
}

function hostedWebSearchTool(available: ReadonlySet<string>) {
  const allowedProviders = hostedSearchProviders(available);
  const providers = allowedProviders.map((provider) => Type.Literal(provider));
  if (providers.length === 0) return null;
  const providerSchema =
    providers.length === 1
      ? providers[0]
      : Type.Union(providers as [(typeof providers)[number], (typeof providers)[number]]);
  const tool = withParameters(
    agentToolToPiTool(createWebSearchTool(allowedProviders)),
    Type.Composite([
      Type.Omit(webSearchParameters, ["provider"]),
      Type.Object({
        provider: Type.Optional(
          Type.Intersect([providerSchema], {
            description: "Override the hosted search provider. Default: automatic cascade.",
          }),
        ),
      }),
    ]),
  );
  return Object.assign(tool, { __hostedAllowedProviders: allowedProviders });
}

/**
 * Read-only tools whose dependencies are browser-safe once their HTTP
 * providers are direct or negotiated through the audited relay.
 *
 * Native CLIs, shell tools, alerts, notification delivery, scheduled reports,
 * and dynamic package tools are deliberately absent.
 */
const HOSTED_TOOLS: readonly HostedToolPolicy[] = [
  hosted(searchTickerTool, ["yahoo", "tradingview"]),
  hosted(stockQuoteTool, ["alpha_vantage", "yahoo"], ["alpha_vantage"]),
  HOSTED_STOCK_HISTORY,
  hosted(priceComparisonTool, ["alpha_vantage", "lse", "yahoo"], ["alpha_vantage", "lse"]),
  {
    tool: HOSTED_SCREEN_STOCKS,
    anyProviders: ["tradingview"],
    credentialRequiredProviders: new Set(),
  },
  hosted(cryptoPriceTool, ["coingecko"]),
  hosted(cryptoHistoryTool, ["coingecko"]),
  hosted(companyOverviewTool, ["alpha_vantage"], ["alpha_vantage"]),
  hosted(financialsTool, ["alpha_vantage", "lse"], ["alpha_vantage", "lse"]),
  hosted(earningsTool, ["alpha_vantage"], ["alpha_vantage"]),
  hosted(dcfTool, ["yahoo"]),
  hosted(compsTool, ["alpha_vantage"], ["alpha_vantage"]),
  hosted(secFilingsTool, ["sec_edgar"]),
  hosted(eventProbabilitiesTool, ["polymarket"]),
  hosted(fredDataTool, ["fred"], ["fred"]),
  hosted(fearGreedTool, ["fear_greed"]),
  hosted(technicalIndicatorsTool, ["yahoo"]),
  hosted(backtestTool, ["yahoo"]),
  hosted(riskAnalysisTool, ["yahoo"]),
  hosted(correlationTool, ["yahoo"]),
  hosted(holdingsOverlapTool, ["yahoo"]),
  hosted(optionChainTool, ["yahoo"]),
];

export function getHostedOpenCandleToolDefinitions(
  options: { relayProviders?: readonly string[] } = {},
) {
  const available = new Set(
    resolveHostedBrowserCapabilityReport(options.relayProviders).available.map(
      (provider) => provider.id,
    ),
  );
  const providerIsUsable = (provider: ProviderId, credentialRequired: ReadonlySet<ProviderId>) =>
    available.has(provider) && (!credentialRequired.has(provider) || hasCredential(provider));
  const hasIntradayHistory =
    available.has("yahoo") ||
    providerIsUsable("lse", HOSTED_STOCK_HISTORY.credentialRequiredProviders);
  const tools = HOSTED_TOOLS.filter(({ anyProviders, credentialRequiredProviders }) =>
    anyProviders.some((provider) => providerIsUsable(provider, credentialRequiredProviders)),
  ).map(({ tool }) => {
    if (hasIntradayHistory) return tool;
    if (tool.name === "get_stock_history") return DAILY_ONLY_STOCK_HISTORY;
    if (tool.name === "get_price_comparison") return DAILY_ONLY_PRICE_COMPARISON;
    return tool;
  });
  const search = hostedWebSearchTool(available);
  const sentimentProviders = hostedSearchProviders(available);
  const sentimentEvidenceProviders = [
    ...(available.has("yahoo") ? (["yahoo"] as const) : []),
    ...(available.has("finnhub") && hasCredential("finnhub") ? (["finnhub"] as const) : []),
  ];
  const sentiment =
    sentimentProviders.length > 0
      ? Object.assign(
          agentToolToPiTool(
            createHostedSentimentSummaryTool(sentimentProviders, sentimentEvidenceProviders),
          ) as ReturnType<typeof agentToolToPiTool>,
          {
            __hostedAllowedProviders: sentimentProviders,
            __hostedEvidenceProviders: sentimentEvidenceProviders,
          },
        )
      : null;
  if (search) {
    tools.push(search);
  }
  if (sentiment) tools.push(sentiment);
  return tools;
}
