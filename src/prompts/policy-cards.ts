import type {
  CapabilityGapId,
  PlanningEnvelope,
  PolicyCardId,
  TaskFamily,
} from "../routing/planning.js";

export const POLICY_CARD_IDS = [
  "ticker_disambiguation",
  "current_event_explanation",
  "sentiment_snapshot",
  "filing_thesis_review",
  "asset_compare",
  "retail_finance_tradeoff",
  "concept_explainer",
] as const;

export type PromptPolicyCardId = typeof POLICY_CARD_IDS[number];

export interface PolicyCard {
  id: PromptPolicyCardId;
  taskFamily: TaskFamily;
  status: "implemented" | "placeholder";
  capabilityGapIds: CapabilityGapId[];
  content: string;
}

const POLICY_CARDS: Record<PromptPolicyCardId, PolicyCard> = {
  ticker_disambiguation: {
    id: "ticker_disambiguation",
    taskFamily: "ticker_disambiguation",
    status: "implemented",
    capabilityGapIds: ["earnings_event_risk"],
    content: `## Ticker Disambiguation Policy
Use ticker lookup evidence to distinguish the current primary ticker from a legacy ticker, former ticker, ETF, ADR, foreign listing, or exchange-specific symbol. Explain the current-vs-legacy relationship before less-common interpretations. If lookup or company overview evidence is unavailable or conflicts, disclose the ambiguity and do not invent listing facts. For unresolved earnings, event-risk, or holdings-risk questions, do not stop with a clarification question as the final output. Say the ticker could not be verified, avoid current earnings claims, then give an event-risk framework covering expected move/gap risk, beat-or-miss versus guidance, revenue and margin drivers, position size, trim/hedge/stop choices, and the specific facts that would change the answer. For business-model questions, explain durable mechanics such as licensing, royalties, products, customers, or distribution only when supported by fetched evidence or stable general knowledge.`,
  },
  current_event_explanation: {
    id: "current_event_explanation",
    taskFamily: "current_event_explanation",
    status: "implemented",
    capabilityGapIds: ["market_calendar"],
    content: `## Current Event Explanation Policy
For "today", "right now", "this morning", "after close", or "why did it move" prompts, check market-status evidence before causal claims. Fetch quote or market-status evidence before searching for news or event catalysts. Distinguish the current date from the most recent trading day when the market is closed, after-hours, on a weekend, or on a holiday. Use fetched quote, news, filing, or event evidence for catalysts when available, and do not invent an intraday move or causal catalyst without supporting evidence. Disclose when exact exchange-calendar coverage is unavailable and lower confidence when quote/news/event evidence is missing. If current evidence is unavailable, continue with a useful framework that labels what is known, what is missing, and what facts would confirm the catalyst.`,
  },
  sentiment_snapshot: placeholder("sentiment_snapshot", "sentiment_snapshot", ["sentiment_sample_depth"]),
  filing_thesis_review: placeholder("filing_thesis_review", "filing_thesis_review", []),
  asset_compare: placeholder("asset_compare", "asset_compare", ["etf_holdings_overlap"]),
  retail_finance_tradeoff: placeholder("retail_finance_tradeoff", "retail_finance_tradeoff", [
    "brokerage_comparison",
    "cash_yield_products",
    "fund_tax_efficiency",
  ]),
  concept_explainer: placeholder("concept_explainer", "concept_explainer", []),
};

export function getPolicyCard(id: PolicyCardId): PolicyCard {
  if (isPromptPolicyCardId(id)) return POLICY_CARDS[id];
  return {
    id: "concept_explainer",
    taskFamily: "concept_explainer",
    status: "placeholder",
    capabilityGapIds: [],
    content: "",
  };
}

export function renderPolicyCardForPlanning(planning: PlanningEnvelope | undefined): string {
  if (!planning || planning.behaviorMode === "observe_only") return "";
  const card = getPolicyCard(planning.policyCardId);
  if (card.status !== "implemented") return "";
  return card.content;
}

export function validatePolicyCardRegistry(): string[] {
  const errors: string[] = [];
  for (const card of Object.values(POLICY_CARDS)) {
    if (card.status === "placeholder" && card.content.trim() !== "") {
      errors.push(`${card.id} placeholder must not include active content`);
    }
    if (card.status === "implemented" && card.capabilityGapIds.length > 0) {
      const lower = card.content.toLowerCase();
      if (!lower.includes("disclose") && !lower.includes("unavailable")) {
        errors.push(`${card.id} has capability gaps but does not instruct disclosure`);
      }
    }
  }
  return errors;
}

function placeholder(
  id: PromptPolicyCardId,
  taskFamily: TaskFamily,
  capabilityGapIds: CapabilityGapId[],
): PolicyCard {
  return {
    id,
    taskFamily,
    status: "placeholder",
    capabilityGapIds,
    content: "",
  };
}

function isPromptPolicyCardId(id: PolicyCardId): id is PromptPolicyCardId {
  return (POLICY_CARD_IDS as readonly string[]).includes(id);
}
