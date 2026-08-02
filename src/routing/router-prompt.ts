import { ROUTE_CAPABILITY_MANIFEST, WORKFLOW_CAPABILITY_MANIFEST } from "./route-manifest.js";
import type { RouterInputContext } from "./router-types.js";

/**
 * Privacy note — priorTurns rendering:
 * Conversational text rendered into the router prompt via `priorTurns` is NOT
 * filtered by `src/memory/types.ts::NEVER_TRUST_FROM_MEMORY` (which governs
 * structured market-sensitive memory keys such as `stock_price` and
 * `target_price`). A future `/forget` command is the designated scrubbing
 * primitive for removing or masking matching entries from the session branch
 * so they no longer reach the router. See
 * `openspec/changes/router-context-and-observability/` for the follow-up.
 */

function renderCatalog(): string {
  const descriptions: Record<string, string> = {
    portfolio_builder: "user asks to build/allocate a portfolio, invest a budget across positions",
    options_screener: "user asks for options trades / calls / puts on a specific ticker",
    compare_assets: "user asks to compare two or more symbols (vs / versus / which is better)",
    single_asset_analysis:
      "user asks for a full analysis / deep dive / 'is X attractive' on ONE symbol",
    watchlist_or_tracking: "user manages or asks about their saved watchlist or tracked positions",
    general_finance_qa:
      "definitional / conceptual questions plus broad market structure, sector, industry, monetary policy, and emerging markets research",
  };

  return Object.values(WORKFLOW_CAPABILITY_MANIFEST)
    .map((w) => {
      const required =
        w.requiredSlots.length > 0 ? ` [required: ${w.requiredSlots.join(", ")}]` : "";
      const mode = w.dispatchable ? "dispatchable workflow" : "agent-task workflow label";
      return `- "${w.workflow}" (${mode}): ${descriptions[w.workflow]}${required}`;
    })
    .join("\n");
}

function renderRouteKinds(): string {
  return Object.values(ROUTE_CAPABILITY_MANIFEST)
    .map((route) => `- "${route.routeKind}" -> legacy route "${route.legacyRoute}"`)
    .join("\n");
}

function renderProfile(profile: Record<string, unknown>): string {
  const entries = Object.entries(profile);
  if (entries.length === 0) return "(empty)";
  return entries.map(([k, v]) => `- ${k}: ${JSON.stringify(v)}`).join("\n");
}

function renderPriorTurns(turns: Array<{ role: "user" | "assistant"; text: string }>): string {
  if (turns.length === 0) return "(none)";
  return turns.map((t) => `[${t.role}] ${t.text.replace(/\n+/g, " ").slice(0, 400)}`).join("\n");
}

function renderRecentRuns(
  runs: Array<{
    workflowType: string;
    turnType: string;
    resolvedSlots?: Record<string, unknown>;
    createdAt: string;
  }>,
): string {
  if (runs.length === 0) return "(none)";
  return runs
    .map(
      (r) =>
        `- ${r.createdAt} ${r.turnType}/${r.workflowType} ${r.resolvedSlots ? JSON.stringify(r.resolvedSlots) : ""}`,
    )
    .join("\n");
}

const SCHEMA_SPEC = `You MUST respond with a SINGLE JSON object and nothing else (no markdown fences, no prose outside the JSON). The object MUST conform to this TypeScript interface exactly:

interface RouterOutput {
  routeKind: "workflow_dispatch" | "agent_task" | "clarification" | "pass_through";
  route: "workflow" | "fallback";
  workflow?: "portfolio_builder" | "options_screener" | "compare_assets" | "single_asset_analysis" | "watchlist_or_tracking" | "general_finance_qa";
  entities: {
    symbols: string[];               // UPPERCASE tickers the user mentioned or implied
    budget?: number;                 // dollar amount if user stated one
    maxPremium?: number;
    timeHorizon?: string;            // e.g. "6mo", "1y_plus", "short", "long"
    assetScope?: string;             // e.g. "stocks_only", "stocks_and_etfs", "etf_focused"
    positionCount?: number;          // explicit requested number of portfolio positions
    maxSinglePositionPct?: number;   // explicit per-position allocation cap as a percentage
    riskProfile?: string;            // "conservative" | "balanced" | "aggressive"
    direction?: "bullish" | "bearish";
    dteHint?: string;
    optionStrategy?: "covered_call" | "protective_put";  // set when user explicitly asks for a known option strategy
    heldSymbol?: string;              // for covered calls/protective puts: ticker the user owns/holds
    catalystSymbols?: string[];        // tickers mentioned as event/catalyst context, not the option-chain underlying
    costBasis?: number;                // per-share basis when user says "cost basis is $X"
    shareQuantity?: number;            // number of shares owned when stated, e.g. "200 shares"
    compareMetrics?: string[];        // optional compare focus tags, e.g. "sentiment", "macro_hedge"
  };
  slots: Record<string, {
    value: unknown;
    source: "user" | "preference" | "default" | "prior_context" | "memory";
    confidence: "high" | "medium" | "low";
  }>;
  preference_updates: Array<{
    key: string;                      // e.g. "risk_profile", "time_horizon", "asset_scope", "options_liquidity"
    value: string;
    confidence: "high" | "medium" | "low";
    source: "inferred";
  }>;
  missing_required: string[];         // required slot names the turn/profile/defaults did not fill
  tool_bundles: Array<"core_market" | "options" | "macro" | "sentiment" | "sec" | "clarification">;
  diagnostics: Array<{ code: string; message: string }>;
  reasoning: string;                  // one or two short sentences; used for debugging only
}`;

const ROUTING_RULES = `Routing rules:
- Choose routeKind = "workflow_dispatch" ONLY when the turn clearly matches a dispatchable workflow (portfolio_builder, options_screener, or compare_assets) AND required slots are filled from the turn, trusted prior context, or profile snapshot.
- For single_asset_analysis, watchlist_or_tracking, and general_finance_qa, set routeKind = "agent_task" even when you set the workflow label. These are workflow labels for prompt/tool policy, not structured workflow dispatch.
- Choose routeKind = "agent_task" for in-scope finance work that should be answered by the main agent, including simple data fetches like "AAPL quote" and open-ended questions like "entry levels on ASTS for 6 months".
- Choose routeKind = "clarification" when required slots are missing (e.g. options workflow needs a symbol, portfolio needs a budget). List specific slot names in missing_required. The main agent will use ask_user to collect them.
- Choose routeKind = "pass_through" when the request is outside OpenCandle's finance task surface.
- Set legacy route = "workflow" only for routeKind = "workflow_dispatch"; otherwise set legacy route = "fallback".
- DO NOT invent a "direct_tool" route. Tool execution belongs to the main agent.
- For covered call prompts, distinguish the owned underlying from catalyst tickers. Put the owned symbol first in symbols, set heldSymbol to the owned symbol, put event/context tickers in catalystSymbols, set workflow="options_screener", and preserve costBasis if stated.
- For protective put prompts, treat the owned/held ticker as the option-chain underlying, set optionStrategy="protective_put", direction="bearish", and preserve shareQuantity if stated. This is a hedge on an existing long share position, not a bullish call screen.
- Source attribution rules (per-slot source field):
  - source = "user": the value came from THIS turn's text.
  - source = "preference": the value came from profileSnapshot (not this turn).
  - source = "default": a sensible default was applied (workflow fallback).
  - source = "prior_context": the value came from prior conversation turns.
  - source = "memory": the value came from retrieved non-profile memory.
- Preference updates:
  - Emit preference_updates ONLY for stable user-dispositions stated (or very strongly implied) in the current turn. E.g. "I'm aggressive" → risk_profile=aggressive, high.
  - Do NOT emit preference_updates that merely echo profileSnapshot.
  - Only confidence="high" updates will be persisted; medium/low are logged but dropped.
- You have NO tools. Do not request tool execution. Classify on text alone.`;

export function buildRouterPrompt(input: RouterInputContext): string {
  return `You are OpenCandle's routing agent. Your job is to classify the user's turn into one of the known workflows (or fallback), extract entities + per-slot provenance, and surface any stable preferences the user expressed. Your output feeds the main analyst agent — it does NOT go to the user.

ROUTE KINDS:
${renderRouteKinds()}

WORKFLOW CATALOG:
${renderCatalog()}

${SCHEMA_SPEC}

${ROUTING_RULES}

--- CONTEXT ---

Profile snapshot (persisted preferences from prior sessions):
${renderProfile(input.profileSnapshot)}

Recent workflow runs (most recent last):
${renderRecentRuns(input.recentWorkflowRuns)}

Prior conversation turns (most recent last):
${renderPriorTurns(input.priorTurns)}

--- CURRENT TURN ---
${input.text}

Respond with the JSON object. Nothing else.`;
}
