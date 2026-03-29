import type { AgentTool } from "@mariozechner/pi-agent-core";
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
import { newsSentimentTool } from "./sentiment/news-sentiment.js";
import { technicalIndicatorsTool } from "./technical/indicators.js";
import { portfolioTrackerTool } from "./portfolio/tracker.js";
import { riskAnalysisTool } from "./portfolio/risk-analysis.js";
import { optionChainTool } from "./options/option-chain.js";

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
    fredDataTool,
    fearGreedTool,
    redditSentimentTool,
    newsSentimentTool,
    technicalIndicatorsTool,
    portfolioTrackerTool,
    riskAnalysisTool,
    optionChainTool,
  ];
}
