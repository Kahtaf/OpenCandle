import { PlainOutput, ToolCard } from "./_shared.jsx";
import { CompanyOverviewCard, DcfCard, EarningsCard, FinancialsCard } from "./fundamentals.jsx";
import { FearGreedCard, MacroSeriesCard } from "./macro.jsx";
import { CompareCard, CryptoPriceCard, HistoryCard, StockQuoteCard } from "./market.jsx";
import {
  SentimentSummaryCard,
  SocialSentimentCard,
  WebSearchCard,
  WebSentimentCard,
} from "./news.jsx";
import { OptionsChainCard } from "./options.jsx";
import {
  CorrelationCard,
  PortfolioCard,
  RiskCard,
  SECFilingsCard,
  WatchlistCard,
} from "./portfolio.jsx";
import { PriceComparisonCard } from "./price-comparison.jsx";
import { TechnicalIndicatorsCard } from "./technical.jsx";

const RENDERERS = new Map([
  ["get_stock_quote", { category: "Stock quote", Component: StockQuoteCard }],
  ["get_crypto_price", { category: "Crypto price", Component: CryptoPriceCard }],
  ["compare_companies", { category: "Comparison", Component: CompareCard }],
  ["get_price_comparison", { category: "Comparison", Component: PriceComparisonCard }],
  ["get_stock_history", { category: "Price history", Component: HistoryCard }],
  ["get_crypto_history", { category: "Price history", Component: HistoryCard }],

  ["get_company_overview", { category: "Company", Component: CompanyOverviewCard }],
  ["get_financials", { category: "Financials", Component: FinancialsCard }],
  ["get_earnings", { category: "Earnings", Component: EarningsCard }],
  ["compute_dcf", { category: "DCF", Component: DcfCard }],

  ["get_option_chain", { category: "Options chain", Component: OptionsChainCard }],

  [
    "get_technical_indicators",
    { category: "Technical indicators", Component: TechnicalIndicatorsCard },
  ],

  ["get_economic_data", { category: "Macro series", Component: MacroSeriesCard }],
  ["get_fear_greed", { category: "Fear & greed", Component: FearGreedCard }],

  ["search_web", { category: "Web search", Component: WebSearchCard }],
  ["get_web_sentiment", { category: "Web sentiment", Component: WebSentimentCard }],
  [
    "get_reddit_sentiment",
    {
      category: "Reddit sentiment",
      Component: (props) => <SocialSentimentCard {...props} sourceLabel="Reddit" />,
    },
  ],
  [
    "get_twitter_sentiment",
    {
      category: "Twitter sentiment",
      Component: (props) => <SocialSentimentCard {...props} sourceLabel="Twitter / X" />,
    },
  ],
  ["get_sentiment_summary", { category: "Sentiment summary", Component: SentimentSummaryCard }],
  ["get_sentiment_trend", { category: "Sentiment trend", Component: SentimentSummaryCard }],

  ["get_sec_filings", { category: "SEC filings", Component: SECFilingsCard }],

  ["track_portfolio", { category: "Portfolio", Component: PortfolioCard }],
  ["analyze_risk", { category: "Risk", Component: RiskCard }],
  ["analyze_correlation", { category: "Correlation", Component: CorrelationCard }],
  ["manage_watchlist", { category: "Watchlist", Component: WatchlistCard }],
]);

export function rendererFor(toolName) {
  return RENDERERS.get(toolName) || null;
}

export function GenericCard({ header, text }) {
  return (
    <ToolCard>
      {header}
      <PlainOutput text={text} />
    </ToolCard>
  );
}
