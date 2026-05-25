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
Use ticker lookup evidence to distinguish the current primary ticker from a legacy ticker, former ticker, ETF, ADR, foreign listing, or exchange-specific symbol. For old-symbol or "is this still the right ticker" prompts, explicitly say whether the supplied symbol is still the current primary ticker and name the current primary ticker when evidence supports one. Explain the current-vs-legacy relationship before less-common interpretations. If lookup or company overview evidence is unavailable or conflicts, disclose the ambiguity and do not invent listing facts. For unresolved earnings, event-risk, or holdings-risk questions, do not stop with a clarification question as the final output. Do not call ask_user merely because a supplied ticker-like symbol is unverified; treat the supplied symbol as unresolved evidence and continue. If any clarification attempt returns no usable answer, say the ticker could not be verified, avoid current earnings claims, then give an unresolved-ticker event-risk framework covering expected move/gap risk, beat-or-miss versus guidance, revenue and margin drivers, position size, trim/hedge/stop choices, and the specific facts that would change the answer. For business-model questions, explain durable mechanics such as licensing, royalties, products, customers, or distribution only when supported by fetched evidence or stable general knowledge.`,
  },
  current_event_explanation: {
    id: "current_event_explanation",
    taskFamily: "current_event_explanation",
    status: "implemented",
    capabilityGapIds: ["market_calendar"],
    content: `## Current Event Explanation Policy
For "today", "right now", "this morning", "after close", or "why did it move" prompts, check market-status evidence before causal claims. Fetch quote or market-status evidence before searching for news or event catalysts. Distinguish the current date from the most recent trading day when the market is closed, after-hours, on a weekend, or on a holiday. Use fetched quote, news, filing, or event evidence for catalysts when available, and do not invent an intraday move or causal catalyst without supporting evidence. Disclose when exact exchange-calendar coverage is unavailable and lower confidence when quote/news/event evidence is missing. If current evidence is unavailable, continue with a useful framework that labels what is known, what is missing, and what facts would confirm the catalyst.`,
  },
  sentiment_snapshot: {
    id: "sentiment_snapshot",
    taskFamily: "sentiment_snapshot",
    status: "implemented",
    capabilityGapIds: ["sentiment_sample_depth"],
    content: `## Sentiment Snapshot Policy
For sentiment-only prompts, include the direction and strength of the sentiment signal, the score scale when available, missing sources, why missing sources matter for the user's question, source-coverage risk, low sample counts, and how those gaps downgrade confidence. For ticker-specific sentiment prompts, compare sentiment with fetched price action and state whether sentiment diverges from price action. Treat sentiment as supporting evidence, not a standalone buy/sell verdict. Disclose sparse source coverage, unavailable Twitter/X sessions, provider gaps, or low sample depth instead of implying full-market sentiment coverage.`,
  },
  filing_thesis_review: {
    id: "filing_thesis_review",
    taskFamily: "filing_thesis_review",
    status: "implemented",
    capabilityGapIds: [],
    content: `## Filing Thesis Review Policy
For SEC filing or thesis-change prompts, call get_sec_filings first, then use targeted search_web queries for requested filing sections or adjacent themes such as risk factors, MD&A, litigation, regulatory disclosures, revenue concentration, management commentary, and recent 8-K events. Separate filing metadata, filing-section summaries or filing-body gaps, news or management commentary, and market data. Do not treat search_web or news results as SEC filing evidence unless they point back to the same primary filing fact in get_sec_filings output. Do not claim an Item 5.02, management change, risk-factor change, or thesis-changing event unless that fact appears in SEC filing evidence. If the full filing body was not parsed, say that directly and avoid implying every filing section was read. Prioritize thesis-changing deltas, dates, source type, and 6-12 month impact over generic company background.`,
  },
  asset_compare: placeholder("asset_compare", "asset_compare", ["etf_holdings_overlap"]),
  retail_finance_tradeoff: placeholder("retail_finance_tradeoff", "retail_finance_tradeoff", [
    "brokerage_comparison",
    "cash_yield_products",
    "fund_tax_efficiency",
  ]),
  concept_explainer: {
    id: "concept_explainer",
    taskFamily: "concept_explainer",
    status: "implemented",
    capabilityGapIds: [],
    content: `## Concept Explainer Policy
For conceptual or educational finance prompts, use a decision-framework shape instead of a stock-analysis shape. Do not fetch live data unless the user asks for current examples, named securities, or live comparisons. Do not mention OpenCandle tool names unless the user asks how to apply the concept with OpenCandle. Do not append Analyst View, Commitment, Reasoning Chain, Confidence Band, or Invalidation Level sections. For valuation-metric education, start with Bottom line, then a one-sentence Core mental model, then Practical workflow, Where it misleads, Cross-checks, and Quick checklist. Frame metrics as screening tools or question generators, not verdicts; cover earnings-quality distortions, variants such as trailing, forward, normalized, or cyclically adjusted, and cross-checks such as cash flow or enterprise-value lenses.`,
  },
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
