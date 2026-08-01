import { type ProviderId, resolveHostedBrowserCapabilityReport } from "../onboarding/providers.js";
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
import { hostedSentimentSummaryTool } from "../tools/sentiment/hosted-sentiment-summary.js";
import { webSearchTool } from "../tools/sentiment/web-search.js";
import { backtestTool } from "../tools/technical/backtest.js";
import { technicalIndicatorsTool } from "../tools/technical/indicators.js";
import { agentToolToPiTool } from "./tool-adapter-core.js";

interface HostedToolPolicy {
  readonly tool: ReturnType<typeof agentToolToPiTool>;
  readonly anyProviders: readonly ProviderId[];
}

const hosted = (
  tool: Parameters<typeof agentToolToPiTool>[0],
  anyProviders: readonly ProviderId[],
): HostedToolPolicy => ({ tool: agentToolToPiTool(tool), anyProviders });

/**
 * Read-only tools whose dependencies are browser-safe once their HTTP
 * providers are direct or negotiated through the audited relay.
 *
 * Native CLIs, shell tools, alerts, notification delivery, scheduled reports,
 * and dynamic package tools are deliberately absent.
 */
const HOSTED_TOOLS: readonly HostedToolPolicy[] = [
  hosted(searchTickerTool, ["yahoo", "tradingview"]),
  hosted(stockQuoteTool, ["alpha_vantage", "yahoo"]),
  hosted(stockHistoryTool, ["alpha_vantage", "lse", "yahoo"]),
  hosted(priceComparisonTool, ["alpha_vantage", "lse", "yahoo"]),
  hosted(screenStocksTool, ["tradingview"]),
  hosted(cryptoPriceTool, ["coingecko"]),
  hosted(cryptoHistoryTool, ["coingecko"]),
  hosted(companyOverviewTool, ["alpha_vantage"]),
  hosted(financialsTool, ["alpha_vantage", "lse"]),
  hosted(earningsTool, ["alpha_vantage"]),
  hosted(dcfTool, ["alpha_vantage", "lse", "yahoo"]),
  hosted(compsTool, ["alpha_vantage"]),
  hosted(secFilingsTool, ["sec_edgar"]),
  hosted(eventProbabilitiesTool, ["polymarket"]),
  hosted(fredDataTool, ["fred"]),
  hosted(fearGreedTool, ["fear_greed"]),
  hosted(technicalIndicatorsTool, ["yahoo"]),
  hosted(backtestTool, ["yahoo"]),
  hosted(riskAnalysisTool, ["yahoo"]),
  hosted(correlationTool, ["yahoo"]),
  hosted(holdingsOverlapTool, ["yahoo"]),
  hosted(optionChainTool, ["yahoo"]),
  hosted(webSearchTool, ["exa", "brave"]),
  hosted(hostedSentimentSummaryTool, ["exa", "brave"]),
];

export function getHostedOpenCandleToolDefinitions(
  options: { relayProviders?: readonly string[] } = {},
) {
  const available = new Set(
    resolveHostedBrowserCapabilityReport(options.relayProviders).available.map(
      (provider) => provider.id,
    ),
  );
  return HOSTED_TOOLS.filter(({ anyProviders }) =>
    anyProviders.some((provider) => available.has(provider)),
  ).map(({ tool }) => tool);
}
