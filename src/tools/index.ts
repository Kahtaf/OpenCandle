import type { AskUserHandler } from "../types/index.js";
import { companyOverviewTool } from "./fundamentals/company-overview.js";
import { compsTool } from "./fundamentals/comps.js";
import { dcfTool } from "./fundamentals/dcf.js";
import { earningsTool } from "./fundamentals/earnings.js";
import { financialsTool } from "./fundamentals/financials.js";
import { secFilingsTool } from "./fundamentals/sec-filings.js";
import { eventProbabilitiesTool } from "./macro/event-probabilities.js";
import { fearGreedTool } from "./macro/fear-greed.js";
import { fredDataTool } from "./macro/fred-data.js";
import { cryptoHistoryTool } from "./market/crypto-history.js";
import { cryptoPriceTool } from "./market/crypto-price.js";
import { priceComparisonTool } from "./market/price-comparison.js";
import { screenStocksTool } from "./market/screen-stocks.js";
import { searchTickerTool } from "./market/search-ticker.js";
import { stockHistoryTool } from "./market/stock-history.js";
import { stockQuoteTool } from "./market/stock-quote.js";
import { optionChainTool } from "./options/option-chain.js";
import { alertsTool } from "./portfolio/alerts.js";
import { correlationTool } from "./portfolio/correlation.js";
import { dailyReportTool } from "./portfolio/daily-report.js";
import { holdingsOverlapTool } from "./portfolio/holdings-overlap.js";
import { notificationsTool } from "./portfolio/notifications.js";
import { riskAnalysisTool } from "./portfolio/risk-analysis.js";
import { portfolioTrackerTool } from "./portfolio/tracker.js";
import { watchlistTool } from "./portfolio/watchlist.js";
import { createRedditSentimentTool } from "./sentiment/reddit-sentiment.js";
import { createSentimentSummaryTool } from "./sentiment/sentiment-summary.js";
import { sentimentTrendTool } from "./sentiment/sentiment-trend.js";
import { createTwitterSentimentTool } from "./sentiment/twitter-sentiment.js";
import { webSearchTool } from "./sentiment/web-search.js";
import { webSentimentTool } from "./sentiment/web-sentiment.js";
import { backtestTool } from "./technical/backtest.js";
import { technicalIndicatorsTool } from "./technical/indicators.js";

export { companyOverviewTool } from "./fundamentals/company-overview.js";
export { compsTool } from "./fundamentals/comps.js";
export { dcfTool } from "./fundamentals/dcf.js";
export { earningsTool } from "./fundamentals/earnings.js";
export { financialsTool } from "./fundamentals/financials.js";
export { secFilingsTool } from "./fundamentals/sec-filings.js";
export { eventProbabilitiesTool } from "./macro/event-probabilities.js";
export { fearGreedTool } from "./macro/fear-greed.js";
export { fredDataTool } from "./macro/fred-data.js";
export { cryptoHistoryTool } from "./market/crypto-history.js";
export { cryptoPriceTool } from "./market/crypto-price.js";
export { priceComparisonTool } from "./market/price-comparison.js";
export { screenStocksTool } from "./market/screen-stocks.js";
export { searchTickerTool } from "./market/search-ticker.js";
export { stockHistoryTool } from "./market/stock-history.js";
export { stockQuoteTool } from "./market/stock-quote.js";
export { optionChainTool } from "./options/option-chain.js";
export { alertsTool } from "./portfolio/alerts.js";
export { correlationTool } from "./portfolio/correlation.js";
export { dailyReportTool } from "./portfolio/daily-report.js";
export { holdingsOverlapTool } from "./portfolio/holdings-overlap.js";
export { notificationsTool } from "./portfolio/notifications.js";
export { riskAnalysisTool } from "./portfolio/risk-analysis.js";
export { portfolioTrackerTool } from "./portfolio/tracker.js";
export { watchlistTool } from "./portfolio/watchlist.js";
export { redditSentimentTool } from "./sentiment/reddit-sentiment.js";
export { createSentimentSummaryTool, sentimentSummaryTool } from "./sentiment/sentiment-summary.js";
export { sentimentTrendTool } from "./sentiment/sentiment-trend.js";
export { twitterSentimentTool } from "./sentiment/twitter-sentiment.js";
export { webSearchTool } from "./sentiment/web-search.js";
export { webSentimentTool } from "./sentiment/web-sentiment.js";
export { backtestTool } from "./technical/backtest.js";
export { technicalIndicatorsTool } from "./technical/indicators.js";

export function getAllTools(options: { askUserHandler?: AskUserHandler } = {}) {
  return [
    searchTickerTool,
    stockQuoteTool,
    stockHistoryTool,
    priceComparisonTool,
    screenStocksTool,
    cryptoPriceTool,
    cryptoHistoryTool,
    companyOverviewTool,
    financialsTool,
    earningsTool,
    dcfTool,
    compsTool,
    secFilingsTool,
    eventProbabilitiesTool,
    fredDataTool,
    fearGreedTool,
    createRedditSentimentTool({ askUserHandler: options.askUserHandler }),
    createTwitterSentimentTool({ askUserHandler: options.askUserHandler }),
    technicalIndicatorsTool,
    backtestTool,
    portfolioTrackerTool,
    riskAnalysisTool,
    watchlistTool,
    correlationTool,
    holdingsOverlapTool,
    alertsTool,
    dailyReportTool,
    notificationsTool,
    optionChainTool,
    webSearchTool,
    webSentimentTool,
    sentimentTrendTool,
    createSentimentSummaryTool({ askUserHandler: options.askUserHandler }),
  ];
}
