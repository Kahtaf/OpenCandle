import type { AgentTool } from "@earendil-works/pi-agent-core";
import { stockQuoteTool } from "./market/stock-quote.js";
import { stockHistoryTool } from "./market/stock-history.js";
import { cryptoPriceTool } from "./market/crypto-price.js";
import { cryptoHistoryTool } from "./market/crypto-history.js";
import { searchTickerTool } from "./market/search-ticker.js";
import { companyOverviewTool } from "./fundamentals/company-overview.js";
import { financialsTool } from "./fundamentals/financials.js";
import { earningsTool } from "./fundamentals/earnings.js";
import { fredDataTool } from "./macro/fred-data.js";
import { fearGreedTool } from "./macro/fear-greed.js";
import { redditSentimentTool } from "./sentiment/reddit-sentiment.js";
import { twitterSentimentTool } from "./sentiment/twitter-sentiment.js";
import { technicalIndicatorsTool } from "./technical/indicators.js";
import { portfolioTrackerTool } from "./portfolio/tracker.js";
import { riskAnalysisTool } from "./portfolio/risk-analysis.js";
import { watchlistTool } from "./portfolio/watchlist.js";
import { correlationTool } from "./portfolio/correlation.js";
import { holdingsOverlapTool } from "./portfolio/holdings-overlap.js";
import { optionChainTool } from "./options/option-chain.js";
import { dcfTool } from "./fundamentals/dcf.js";
import { compsTool } from "./fundamentals/comps.js";
import { secFilingsTool } from "./fundamentals/sec-filings.js";
import { backtestTool } from "./technical/backtest.js";
import { predictionsTool } from "./portfolio/predictions.js";
import { alertsTool } from "./portfolio/alerts.js";
import { dailyReportTool } from "./portfolio/daily-report.js";
import { webSearchTool } from "./sentiment/web-search.js";
import { webSentimentTool } from "./sentiment/web-sentiment.js";
import { sentimentTrendTool } from "./sentiment/sentiment-trend.js";
import { sentimentSummaryTool } from "./sentiment/sentiment-summary.js";

export { stockQuoteTool } from "./market/stock-quote.js";
export { stockHistoryTool } from "./market/stock-history.js";
export { cryptoPriceTool } from "./market/crypto-price.js";
export { cryptoHistoryTool } from "./market/crypto-history.js";
export { searchTickerTool } from "./market/search-ticker.js";
export { companyOverviewTool } from "./fundamentals/company-overview.js";
export { financialsTool } from "./fundamentals/financials.js";
export { earningsTool } from "./fundamentals/earnings.js";
export { dcfTool } from "./fundamentals/dcf.js";
export { compsTool } from "./fundamentals/comps.js";
export { secFilingsTool } from "./fundamentals/sec-filings.js";
export { fredDataTool } from "./macro/fred-data.js";
export { fearGreedTool } from "./macro/fear-greed.js";
export { redditSentimentTool } from "./sentiment/reddit-sentiment.js";
export { twitterSentimentTool } from "./sentiment/twitter-sentiment.js";
export { webSearchTool } from "./sentiment/web-search.js";
export { webSentimentTool } from "./sentiment/web-sentiment.js";
export { sentimentTrendTool } from "./sentiment/sentiment-trend.js";
export { sentimentSummaryTool } from "./sentiment/sentiment-summary.js";
export { technicalIndicatorsTool } from "./technical/indicators.js";
export { backtestTool } from "./technical/backtest.js";
export { portfolioTrackerTool } from "./portfolio/tracker.js";
export { riskAnalysisTool } from "./portfolio/risk-analysis.js";
export { watchlistTool } from "./portfolio/watchlist.js";
export { correlationTool } from "./portfolio/correlation.js";
export { holdingsOverlapTool } from "./portfolio/holdings-overlap.js";
export { predictionsTool } from "./portfolio/predictions.js";
export { alertsTool } from "./portfolio/alerts.js";
export { dailyReportTool } from "./portfolio/daily-report.js";
export { optionChainTool } from "./options/option-chain.js";

export function getAllTools(): AgentTool<any>[] {
  return [
    searchTickerTool,
    stockQuoteTool,
    stockHistoryTool,
    cryptoPriceTool,
    cryptoHistoryTool,
    companyOverviewTool,
    financialsTool,
    earningsTool,
    dcfTool,
    compsTool,
    secFilingsTool,
    fredDataTool,
    fearGreedTool,
    redditSentimentTool,
    twitterSentimentTool,
    technicalIndicatorsTool,
    backtestTool,
    portfolioTrackerTool,
    riskAnalysisTool,
    watchlistTool,
    correlationTool,
    holdingsOverlapTool,
    predictionsTool,
    alertsTool,
    dailyReportTool,
    optionChainTool,
    webSearchTool,
    webSentimentTool,
    sentimentTrendTool,
    sentimentSummaryTool,
  ];
}
