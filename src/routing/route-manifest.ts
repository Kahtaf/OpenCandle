import type { MemoryCategory } from "../memory/types.js";
import type { RouterOutput, RouterRoute, RouterRouteKind, ToolBundleName } from "./router-types.js";
import type { ExtractedEntities, WorkflowType } from "./types.js";

export const ROUTE_KINDS: readonly RouterRouteKind[] = [
  "workflow_dispatch",
  "agent_task",
  "clarification",
  "pass_through",
];

export const TOOL_BUNDLE_TOOLS: Record<ToolBundleName, readonly string[]> = {
  core_market: [
    "search_ticker",
    "get_stock_quote",
    "get_stock_history",
    "get_price_comparison",
    "screen_stocks",
    "get_crypto_price",
    "get_crypto_history",
    "get_company_overview",
    "get_financials",
    "get_earnings",
    "compare_companies",
    "compute_dcf",
    "get_technical_indicators",
    "backtest_strategy",
    "analyze_risk",
    "analyze_correlation",
    "analyze_holdings_overlap",
    "track_portfolio",
    "manage_watchlist",
    "manage_alerts",
    "daily_watchlist_report",
    "manage_notifications",
    "search_web",
  ],
  options: ["get_option_chain", "get_stock_quote", "search_ticker", "search_web"],
  macro: ["get_economic_data", "get_event_probabilities", "get_fear_greed", "search_web"],
  sentiment: [
    "get_reddit_sentiment",
    "get_twitter_sentiment",
    "get_web_sentiment",
    "get_sentiment_trend",
    "get_sentiment_summary",
    "get_fear_greed",
    "search_web",
  ],
  sec: ["get_sec_filings", "get_company_overview", "search_web"],
  clarification: ["ask_user"],
};

export type PromptPlaybookId =
  | "workflow_dispatch"
  | "agent_task"
  | "clarification"
  | "pass_through";

interface RouteCapability {
  routeKind: RouterRouteKind;
  legacyRoute: RouterRoute;
  promptPlaybook: PromptPlaybookId;
  toolBundles: ToolBundleName[];
  memoryScopes: MemoryCategory[];
  allowWorkflow: boolean;
}

interface WorkflowCapability {
  workflow: Exclude<WorkflowType, "unclassified">;
  dispatchable: boolean;
  requiredSlots: string[];
  toolBundles: ToolBundleName[];
  memoryScopes: MemoryCategory[];
  promptPlaybook: PromptPlaybookId;
}

export const ROUTE_CAPABILITY_MANIFEST: Record<RouterRouteKind, RouteCapability> = {
  workflow_dispatch: {
    routeKind: "workflow_dispatch",
    legacyRoute: "workflow",
    promptPlaybook: "workflow_dispatch",
    toolBundles: ["core_market"],
    memoryScopes: ["investor_profile", "workflow_history"],
    allowWorkflow: true,
  },
  agent_task: {
    routeKind: "agent_task",
    legacyRoute: "fallback",
    promptPlaybook: "agent_task",
    toolBundles: ["core_market"],
    memoryScopes: ["investor_profile", "workflow_history"],
    allowWorkflow: false,
  },
  clarification: {
    routeKind: "clarification",
    legacyRoute: "fallback",
    promptPlaybook: "clarification",
    toolBundles: ["clarification"],
    memoryScopes: ["investor_profile", "workflow_history"],
    allowWorkflow: true,
  },
  pass_through: {
    routeKind: "pass_through",
    legacyRoute: "fallback",
    promptPlaybook: "pass_through",
    toolBundles: [],
    memoryScopes: [],
    allowWorkflow: false,
  },
};

export const WORKFLOW_CAPABILITY_MANIFEST: Record<
  Exclude<WorkflowType, "unclassified">,
  WorkflowCapability
> = {
  portfolio_builder: {
    workflow: "portfolio_builder",
    dispatchable: true,
    requiredSlots: ["budget"],
    toolBundles: ["core_market", "macro", "sentiment", "clarification"],
    memoryScopes: ["investor_profile", "interaction_feedback", "workflow_history"],
    promptPlaybook: "workflow_dispatch",
  },
  options_screener: {
    workflow: "options_screener",
    dispatchable: true,
    requiredSlots: ["symbol"],
    toolBundles: ["core_market", "options", "sentiment", "clarification"],
    memoryScopes: ["investor_profile", "interaction_feedback", "workflow_history"],
    promptPlaybook: "workflow_dispatch",
  },
  compare_assets: {
    workflow: "compare_assets",
    dispatchable: true,
    requiredSlots: ["symbols"],
    toolBundles: ["core_market", "macro", "sentiment", "clarification"],
    memoryScopes: ["investor_profile", "workflow_history"],
    promptPlaybook: "workflow_dispatch",
  },
  single_asset_analysis: {
    workflow: "single_asset_analysis",
    dispatchable: false,
    requiredSlots: ["symbol"],
    toolBundles: ["core_market", "options", "sentiment", "sec", "clarification"],
    memoryScopes: ["investor_profile", "workflow_history"],
    promptPlaybook: "agent_task",
  },
  watchlist_or_tracking: {
    workflow: "watchlist_or_tracking",
    dispatchable: false,
    requiredSlots: [],
    toolBundles: ["core_market", "clarification"],
    memoryScopes: ["investor_profile", "workflow_history"],
    promptPlaybook: "agent_task",
  },
  general_finance_qa: {
    workflow: "general_finance_qa",
    dispatchable: false,
    requiredSlots: [],
    toolBundles: ["core_market", "macro", "sentiment", "sec", "clarification"],
    memoryScopes: ["investor_profile", "workflow_history"],
    promptPlaybook: "agent_task",
  },
};

export function isRouteKind(value: string): value is RouterRouteKind {
  return ROUTE_KINDS.includes(value as RouterRouteKind);
}

export function isToolBundleName(value: string): value is ToolBundleName {
  return Object.hasOwn(TOOL_BUNDLE_TOOLS, value);
}

export function legacyRouteForRouteKind(routeKind: RouterRouteKind): RouterRoute {
  return ROUTE_CAPABILITY_MANIFEST[routeKind].legacyRoute;
}

export function isDispatchableWorkflow(
  workflow: Exclude<WorkflowType, "unclassified"> | undefined,
): boolean {
  if (!workflow) return false;
  return WORKFLOW_CAPABILITY_MANIFEST[workflow]?.dispatchable === true;
}

export function routeKindFromLegacyRoute(
  route: RouterRoute,
  missingRequired: readonly string[] = [],
): RouterRouteKind {
  if (missingRequired.length > 0) return "clarification";
  return route === "workflow" ? "workflow_dispatch" : "agent_task";
}

export function workflowRequiredSlots(
  workflow: Exclude<WorkflowType, "unclassified"> | undefined,
): string[] {
  if (!workflow) return [];
  return WORKFLOW_CAPABILITY_MANIFEST[workflow]?.requiredSlots ?? [];
}

export function computeMissingRequiredSlots(
  workflow: Exclude<WorkflowType, "unclassified"> | undefined,
  entities: ExtractedEntities,
  slots: RouterOutput["slots"] = {},
  existingMissing: readonly string[] = [],
): string[] {
  const missing = new Set<string>();
  const existing = new Set(existingMissing);
  for (const slot of workflowRequiredSlots(workflow)) {
    if (slot === "budget" && entities.budget === undefined && !slotHasValue(slots.budget)) {
      missing.add("budget");
    }
    if (slot === "symbol" && entities.symbols.length === 0 && !slotHasValue(slots.symbol)) {
      missing.add("symbol");
    }
    if (
      slot === "symbols" &&
      entities.symbols.length < 2 &&
      !slotHasSymbolListValue(slots.symbols, 2)
    ) {
      missing.add("symbols");
    }
    existing.delete(slot);
  }
  for (const slot of existing) {
    if (!slotHasValue(slots[slot])) missing.add(slot);
  }
  return Array.from(missing);
}

function slotHasValue(slot: RouterOutput["slots"][string] | undefined): boolean {
  if (!slot) return false;
  if (Array.isArray(slot.value)) return slot.value.length > 0;
  return slot.value !== undefined && slot.value !== null && slot.value !== "";
}

function slotHasSymbolListValue(
  slot: RouterOutput["slots"][string] | undefined,
  minLength: number,
): boolean {
  if (!slot) return false;
  if (Array.isArray(slot.value))
    return slot.value.filter((value) => typeof value === "string").length >= minLength;
  return false;
}

export function selectToolBundles(
  output: Pick<RouterOutput, "routeKind" | "workflow" | "entities">,
): ToolBundleName[] {
  if (output.routeKind === "pass_through") return [];
  if (output.routeKind === "clarification") return ["clarification"];

  const bundles = new Set<ToolBundleName>();
  const routeBundles = ROUTE_CAPABILITY_MANIFEST[output.routeKind]?.toolBundles ?? [];
  for (const bundle of routeBundles) {
    bundles.add(bundle);
  }

  if (output.workflow) {
    const workflow = WORKFLOW_CAPABILITY_MANIFEST[output.workflow];
    if (workflow) {
      for (const bundle of workflow.toolBundles) {
        bundles.add(bundle);
      }
    }
  }

  const metrics = output.entities.compareMetrics ?? [];
  const horizon = output.entities.timeHorizon ?? "";
  if (
    metrics.includes("macro_hedge") ||
    metrics.includes("interest_rates") ||
    /\b(?:macro|rate|inflation)\b/i.test(horizon)
  ) {
    bundles.add("macro");
  }

  if (output.entities.symbols.length > 0) {
    bundles.add("core_market");
  }
  if (output.entities.optionStrategy) {
    bundles.add("options");
  }

  return Array.from(bundles);
}

export function activeToolsForBundles(
  bundles: readonly ToolBundleName[],
  availableToolNames?: readonly string[],
): string[] {
  const selected = new Set<string>();
  for (const bundle of bundles) {
    for (const tool of TOOL_BUNDLE_TOOLS[bundle] ?? []) {
      selected.add(tool);
    }
  }

  if (!availableToolNames) return Array.from(selected);
  const available = new Set(availableToolNames);
  return Array.from(selected).filter((tool) => available.has(tool));
}

export function memoryScopesForRoute(
  routeKind: RouterRouteKind,
  workflow?: Exclude<WorkflowType, "unclassified">,
): MemoryCategory[] {
  if (workflow) return WORKFLOW_CAPABILITY_MANIFEST[workflow]?.memoryScopes ?? [];
  return ROUTE_CAPABILITY_MANIFEST[routeKind]?.memoryScopes ?? [];
}
