export const OPENCANDLE_WORKFLOWS = [
  {
    id: "comprehensive_analysis",
    name: "Comprehensive Analysis",
    description: "Run the multi-analyst stock analysis workflow.",
    prompt: "/analyze {symbol}",
    slots: [{ name: "symbol", label: "Symbol", type: "text" }],
  },
  {
    id: "portfolio_builder",
    name: "Portfolio Builder",
    description: "Build a diversified portfolio from goals and constraints.",
    prompt: "Build me a portfolio for {objective}",
    slots: [{ name: "objective", label: "Objective", type: "text" }],
  },
  {
    id: "options_screener",
    name: "Options Screener",
    description: "Screen option chains for a target symbol.",
    prompt: "Screen options for {symbol}",
    slots: [{ name: "symbol", label: "Symbol", type: "text" }],
  },
  {
    id: "compare_assets",
    name: "Compare Assets",
    description: "Compare two or more assets side by side.",
    prompt: "Compare {symbols}",
    slots: [{ name: "symbols", label: "Symbols", type: "text" }],
  },
] as const;

export function inferToolDomain(toolName: string): string {
  if (toolName.includes("option")) return "options";
  if (
    toolName.includes("portfolio") ||
    toolName.includes("risk") ||
    toolName.includes("correlation")
  )
    return "portfolio";
  if (
    toolName.includes("sentiment") ||
    toolName.includes("reddit") ||
    toolName.includes("twitter") ||
    toolName.includes("web")
  )
    return "sentiment";
  if (toolName.includes("economic") || toolName.includes("fear")) return "macro";
  if (toolName.includes("technical") || toolName.includes("backtest")) return "technical";
  if (
    toolName.includes("company") ||
    toolName.includes("financial") ||
    toolName.includes("earnings") ||
    toolName.includes("dcf") ||
    toolName.includes("sec")
  )
    return "fundamentals";
  if (toolName.includes("ask_user") || toolName.includes("login")) return "interaction";
  return "market";
}
