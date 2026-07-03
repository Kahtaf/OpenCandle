import {
  Activity,
  AlertTriangle,
  AtSign,
  BarChart3,
  BookOpen,
  Briefcase,
  Building2,
  Calculator,
  CandlestickChart,
  CircleHelp,
  Coins,
  FileText,
  Gauge,
  GitCompare,
  Globe,
  Layers,
  LineChart,
  ListChecks,
  MessageCircle,
  Network,
  PieChart,
  Receipt,
  Search,
  TrendingUp,
  Wrench,
} from "lucide-react";
import { cn } from "../../lib/utils.js";

// Per-tool icon + display label + grouping category. The drawer step row, the
// in-thread StepsCard title, and the source patterns all key off this map, so
// new tools should be registered here in one place.
const TOOL_META = {
  // Market / price
  get_stock_quote: { icon: LineChart, label: "Stock quote", group: "market" },
  get_crypto_price: { icon: Coins, label: "Crypto price", group: "market" },
  compare_companies: { icon: GitCompare, label: "Comparison", group: "market" },
  get_stock_history: { icon: CandlestickChart, label: "Price history", group: "market" },
  get_crypto_history: { icon: CandlestickChart, label: "Price history", group: "market" },

  // Fundamentals
  get_company_overview: { icon: Building2, label: "Company overview", group: "fundamentals" },
  get_financials: { icon: BookOpen, label: "Financials", group: "fundamentals" },
  get_earnings: { icon: Receipt, label: "Earnings", group: "fundamentals" },
  compute_dcf: { icon: Calculator, label: "DCF valuation", group: "fundamentals" },

  // Options
  get_option_chain: { icon: Layers, label: "Options chain", group: "options" },

  // Technical
  get_technical_indicators: { icon: Activity, label: "Technical indicators", group: "technical" },

  // Macro
  get_economic_data: { icon: BarChart3, label: "Economic data", group: "macro" },
  get_fear_greed: { icon: Gauge, label: "Fear & greed", group: "macro" },

  // News / web
  search_web: { icon: Search, label: "Web search", group: "research" },
  get_sec_filings: { icon: FileText, label: "SEC filings", group: "research" },

  // Sentiment
  get_web_sentiment: { icon: Globe, label: "Web sentiment", group: "sentiment" },
  get_reddit_sentiment: { icon: MessageCircle, label: "Reddit sentiment", group: "sentiment" },
  get_twitter_sentiment: { icon: AtSign, label: "Twitter sentiment", group: "sentiment" },
  get_sentiment_summary: { icon: PieChart, label: "Sentiment summary", group: "sentiment" },
  get_sentiment_trend: { icon: TrendingUp, label: "Sentiment trend", group: "sentiment" },

  // Portfolio
  track_portfolio: { icon: Briefcase, label: "Portfolio", group: "portfolio" },
  analyze_risk: { icon: AlertTriangle, label: "Risk analysis", group: "portfolio" },
  analyze_correlation: { icon: Network, label: "Correlation", group: "portfolio" },
  manage_watchlist: { icon: ListChecks, label: "Watchlist", group: "portfolio" },

  // Interaction
  ask_user: { icon: CircleHelp, label: "Question", group: "interaction" },
};

export function toolMeta(name) {
  return TOOL_META[name] || { icon: Wrench, label: prettifyToolName(name), group: "tool" };
}

function prettifyToolName(name) {
  return String(name || "tool")
    .replace(/^get_/, "")
    .replace(/_/g, " ");
}

// Yellow-tinted tool icon square (llmchat-style). Compact, recognizable.
// Three sizes: sm (16px) for inline pills, md (20px) for drawer step rows,
// lg (24px) for the in-thread StepsCard.
export function ToolIcon({ name, size = "md", className, status }) {
  const meta = toolMeta(name);
  const Icon = meta.icon;
  const isError = status === "error";
  const dims =
    size === "sm"
      ? "size-5 [&_svg]:size-3"
      : size === "lg"
        ? "size-7 [&_svg]:size-4"
        : "size-6 [&_svg]:size-3.5";
  const colorClass = isError
    ? "border-destructive/40 bg-destructive/10 text-destructive"
    : "border-amber-700/40 bg-amber-100/70 text-amber-800 dark:border-amber-300/30 dark:bg-amber-950/40 dark:text-amber-300";
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md border",
        dims,
        colorClass,
        className,
      )}
    >
      <Icon strokeWidth={2} />
    </span>
  );
}

// Heuristic run title shown on the in-thread StepsCard + drawer header.
// Picks a contextual phrase based on the groups of tools used.
export function summarizeRunTitle(toolNames) {
  if (!toolNames?.length) return "Working";
  const groups = new Set(toolNames.map((n) => toolMeta(n).group));
  if (groups.has("research") || groups.has("sentiment")) {
    if (groups.has("market") || groups.has("fundamentals")) return "Research & analysis";
    return "Research";
  }
  if (groups.has("portfolio")) return "Portfolio analysis";
  if (groups.has("interaction")) return "Question";
  if (groups.has("fundamentals")) return "Fundamental analysis";
  if (groups.has("technical")) return "Technical analysis";
  if (groups.has("macro")) return "Macro lookup";
  if (groups.has("market")) return "Market lookup";
  if (toolNames.length === 1) return toolMeta(toolNames[0]).label;
  return "Steps";
}
