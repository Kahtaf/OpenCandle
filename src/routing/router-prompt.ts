import type { RouterInputContext } from "./router-types.js";

/**
 * List of workflows the router may emit. Keep this in sync with
 * `WorkflowType` in `src/routing/types.ts` minus the `unclassified` sentinel.
 */
const WORKFLOW_CATALOG = [
  {
    name: "portfolio_builder",
    when: "user asks to build/allocate a portfolio, invest a budget across positions",
    required: ["budget"],
  },
  {
    name: "options_screener",
    when: "user asks for options trades / calls / puts on a specific ticker",
    required: ["symbol"],
  },
  {
    name: "compare_assets",
    when: "user asks to compare two or more symbols (vs / versus / which is better)",
    required: ["symbols (>=2)"],
  },
  {
    name: "single_asset_analysis",
    when: "user asks for a full analysis / deep dive / 'is X attractive' on ONE symbol",
    required: ["symbol"],
  },
  {
    name: "watchlist_or_tracking",
    when: "user manages or asks about their saved watchlist / prediction history",
    required: [],
  },
  {
    name: "general_finance_qa",
    when: "definitional / conceptual 'what is X', 'explain Y' questions",
    required: [],
  },
];

function renderCatalog(): string {
  return WORKFLOW_CATALOG.map(
    (w) =>
      `- "${w.name}": ${w.when}${w.required.length > 0 ? ` [required: ${w.required.join(", ")}]` : ""}`,
  ).join("\n");
}

function renderProfile(profile: Record<string, unknown>): string {
  const entries = Object.entries(profile);
  if (entries.length === 0) return "(empty)";
  return entries.map(([k, v]) => `- ${k}: ${JSON.stringify(v)}`).join("\n");
}

function renderPriorTurns(
  turns: Array<{ role: "user" | "assistant"; text: string }>,
): string {
  if (turns.length === 0) return "(none)";
  return turns
    .map((t) => `[${t.role}] ${t.text.replace(/\n+/g, " ").slice(0, 400)}`)
    .join("\n");
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
  route: "workflow" | "fallback";
  workflow?: "portfolio_builder" | "options_screener" | "compare_assets" | "single_asset_analysis" | "watchlist_or_tracking" | "general_finance_qa";
  entities: {
    symbols: string[];               // UPPERCASE tickers the user mentioned or implied
    budget?: number;                 // dollar amount if user stated one
    maxPremium?: number;
    timeHorizon?: string;            // e.g. "6mo", "1y_plus", "short", "long"
    riskProfile?: string;            // "conservative" | "balanced" | "aggressive"
    direction?: "bullish" | "bearish";
    dteHint?: string;
  };
  slots: Record<string, {
    value: unknown;
    source: "user" | "preference" | "default"; // user = stated this turn; preference = from profileSnapshot; default = workflow fallback
    confidence: "high" | "medium" | "low";
  }>;
  preference_updates: Array<{
    key: string;                      // e.g. "risk_profile", "time_horizon", "asset_scope", "options_liquidity"
    value: string;
    confidence: "high" | "medium" | "low";
    source: "inferred";
  }>;
  missing_required: string[];         // required slot names the turn/profile/defaults did not fill
  reasoning: string;                  // one or two short sentences; used for debugging only
}`;

const ROUTING_RULES = `Routing rules:
- Choose route = "workflow" ONLY when the turn clearly matches one of the workflows below AND required slots are filled (from the turn OR the profile snapshot).
- Choose route = "fallback" for anything else — including simple data fetches like "AAPL quote", open-ended questions like "entry levels on ASTS for 6 months", or cases where required slots are missing.
- DO NOT invent a "direct_tool" or "needs_clarification" route. Only "workflow" or "fallback" are valid.
- If required slots are missing (e.g. options workflow needs a symbol, portfolio needs a budget), still pick the closest route but list the missing slot names in missing_required. The main agent will use ask_user to collect them.
- Source attribution rules (per-slot source field):
  - source = "user": the value came from THIS turn's text.
  - source = "preference": the value came from profileSnapshot (not this turn).
  - source = "default": a sensible default was applied (workflow fallback).
- Preference updates:
  - Emit preference_updates ONLY for stable user-dispositions stated (or very strongly implied) in the current turn. E.g. "I'm aggressive" → risk_profile=aggressive, high.
  - Do NOT emit preference_updates that merely echo profileSnapshot.
  - Only confidence="high" updates will be persisted; medium/low are logged but dropped.
- You have NO tools. Do not request tool execution. Classify on text alone.`;

export function buildRouterPrompt(input: RouterInputContext): string {
  return `You are OpenCandle's routing agent. Your job is to classify the user's turn into one of the known workflows (or fallback), extract entities + per-slot provenance, and surface any stable preferences the user expressed. Your output feeds the main analyst agent — it does NOT go to the user.

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
