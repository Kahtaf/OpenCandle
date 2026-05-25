import type {
  CapabilityGapId,
  PlanningEnvelope,
  PolicyCardId,
  TaskFamily,
} from "../routing/planning.js";

export const POLICY_CARD_IDS = [
  "ticker_disambiguation",
  "single_asset_decision",
  "current_event_explanation",
  "sentiment_snapshot",
  "filing_thesis_review",
  "asset_compare",
  "portfolio_review",
  "macro_allocation_review",
  "options_strategy",
  "backtest_review",
  "stateful_tracking_update",
  "retail_finance_tradeoff",
  "concept_explainer",
  "concept_options_education",
  "concept_inflation_cash_education",
  "concept_valuation_metric_education",
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
  single_asset_decision: {
    id: "single_asset_decision",
    taskFamily: "single_asset_decision",
    status: "implemented",
    capabilityGapIds: [],
    content: `## Single Asset Decision Policy
For single-security buy, sell, wait, avoid, trim, add, size, or entry prompts, give a clear call and tie it to the user's horizon when stated. Fetch and use available quote, earnings, technical, sentiment/news, fundamentals, filing, or risk evidence before stating prices, ratios, or current metrics. State the quote or tool-output date when using current data, and carry market-closed, delayed, or last-available quote caveats into the final answer. If DCF, fundamentals, or another valuation model is unavailable or not meaningful, disclose the data gap once; do not make unavailable DCF or missing fundamentals the main thesis. Replace unavailable valuation with supported fallback lenses such as relative multiples, growth-adjusted multiples, cash-flow quality, balance-sheet risk, historical trading range, momentum, earnings trend, and structural business risk. End with the decision, key downside risks, position sizing or entry strategy, confidence, and concrete invalidation.`,
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
  asset_compare: {
    id: "asset_compare",
    taskFamily: "asset_compare",
    status: "implemented",
    capabilityGapIds: ["etf_holdings_overlap"],
    content: `## Asset Compare Policy
Compare the requested assets before portfolio construction. For ETF overlap, diversification, dividend-vs-growth, or income-vs-total-return prompts, keep the answer in comparison mode unless the user explicitly asks to build a portfolio. Use available quote, risk, correlation, technical, or fund context, but disclose that exact holdings overlap by weight requires a dedicated holdings provider when unavailable. Do not imply exact constituent-level overlap, top shared holdings, sector weights, expense ratios, yields, or distribution facts unless fetched evidence supports them. Cover diversification impact, concentration risk, growth versus income tradeoffs, tax and asset-location caveats, horizon fit, and a practical default or next step tied to the user's stated goal.`,
  },
  portfolio_review: {
    id: "portfolio_review",
    taskFamily: "portfolio_review",
    status: "implemented",
    capabilityGapIds: [],
    content: `## Portfolio Review Policy
For prompts that ask to critically evaluate an existing allocation, review the portfolio as given. Do not build a new portfolio, ask for a construction budget, or convert the turn into portfolio-builder workflow guidance unless the user explicitly asks for construction. Start with a direct bottom-line structural read, then use sections for Structural allocation read, Sleeve-by-sleeve implications, Key risks and opportunities, Actionable adjustment, What this does not fix, and Watchlist and invalidation. Evaluate concentration, diversification, geography, equity cyclicality, fixed-income duration, credit sensitivity, liquidity, tax and asset-location caveats, horizon fit, and rebalance discipline. Use current macro, quote, sentiment, risk, or correlation evidence when available, but disclose missing live data, unknown holdings, unknown account type, or unavailable exact duration/credit/overlap facts without inventing precision. End with one clear adjustment or monitoring trigger tied to the stated horizon, the main downside risk, confidence, and what would change the view.`,
  },
  macro_allocation_review: {
    id: "macro_allocation_review",
    taskFamily: "macro_allocation_review",
    status: "implemented",
    capabilityGapIds: ["market_calendar", "forward_rate_probabilities"],
    content: `## Macro Allocation Review Policy
For macro outlook, inflation, Fed, rates, recession, or balanced-portfolio prompts, use current macro evidence when available and convert raw series into interpretable rates, trends, or policy implications instead of dropping naked numbers. Name provider gaps and unavailable inflation, Fed funds, forward-rate probability, market-calendar, or sentiment facts without turning the answer into a tool-failure apology. Explain the mechanism from policy shift to currency, capital flows, inflation or financial conditions, and asset-market impact; use direct U.S. or regional sources when dedicated macro coverage is missing. Preserve the portfolio review shape when the user asks about allocation: Bottom line, Current macro evidence, Structural portfolio read, Sleeve-by-sleeve implications, Key risks and opportunities, Actionable adjustment, What this does not fix, and Watchlist and invalidation. Cover equity concentration, cyclicality, emerging-market currency or liquidity sensitivity, duration, credit-spread risk, inflation-linked real-rate duration, stock-bond correlation, a concrete adjustment with trigger or percent, and the risks that would invalidate the view.`,
  },
  options_strategy: {
    id: "options_strategy",
    taskFamily: "options_strategy",
    status: "implemented",
    capabilityGapIds: [],
    content: `## Options Strategy Policy
For covered-call, protective-put, hedge, income, catalyst-volatility, or options strategy prompts, keep the strategy tied to the option-chain underlying, the user's owned underlying or intended exposure, stated cost basis, share count, horizon, risk tolerance, and event catalyst when supplied. Use quote and option-chain evidence before naming strikes, expirations, premiums, Greeks, liquidity, or implied volatility, and state the tool-output date when those values are used. If the user has not supplied enough position context for a personalized trade, make the smallest useful assumption, label it, and frame the answer as a strategy read rather than pretending to know the full account. For covered calls, discuss premium received, assignment risk, capped upside, share-price downside that the premium does not protect, IV or earnings-event risk, exit liquidity, and return-if-assigned. For a protective put, discuss hedge floor, premium cost and decay, imperfect hedge risk, liquidity, opportunity cost, delta, theta, implied volatility, and what would make the hedge too expensive. Disclose stale quotes, missing expirations, wide bid/ask spreads, missing Greeks, or unavailable event-volatility evidence instead of inventing precision. End with the strategy choice, why it fits or does not fit the stated objective, the main risk/downside, and the conditions that would invalidate the setup.`,
  },
  backtest_review: {
    id: "backtest_review",
    taskFamily: "backtest_review",
    status: "implemented",
    capabilityGapIds: [],
    content: `## Backtest Review Policy
For strategy backtest prompts, use backtest_strategy evidence before judging whether the edge is practical. Report strategy return, buy-and-hold return, outperformance, trade count, win rate, max drawdown, and risk-adjusted metrics such as Sharpe or Sortino when available. If Sharpe, Sortino, costs, slippage, dividends, taxes, liquidity, survivorship bias, or enough history are unavailable, disclose the data gap without turning the answer into a tool-failure apology. Explain why the strategy worked or failed in the tested regime, whether the result is robust or likely overfit, and what market condition would invalidate it. When the user asks whether the edge is practical, discuss costs and slippage, turnover, signal frequency, drawdown tolerance, and implementation discipline. Do not reduce a backtest answer to return-only; end with a concise practical read and the main downside risk.`,
  },
  stateful_tracking_update: {
    id: "stateful_tracking_update",
    taskFamily: "stateful_tracking_update",
    status: "implemented",
    capabilityGapIds: [],
    content: `## Stateful Tracking Update Policy
For watchlist, portfolio tracking, prediction recording, and prediction-check prompts, use the state tool that owns the change or lookup: manage_watchlist, track_prediction, or track_portfolio. Do not confirm a saved change from prose alone. Confirm the persisted state update with the symbol, action, direction, entry price, target, stop, conviction, timeframe, or check result that the tool accepted. If required fields for a state mutation are missing, ask the smallest clarification question instead of inventing values. For check or list operations, summarize the saved state and say clearly when no records exist. Do not turn a state update into a buy/sell recommendation unless the user separately asks for market analysis.`,
  },
  retail_finance_tradeoff: {
    id: "retail_finance_tradeoff",
    taskFamily: "retail_finance_tradeoff",
    status: "implemented",
    capabilityGapIds: ["brokerage_comparison", "cash_yield_products", "fund_tax_efficiency"],
    content: `## Retail Finance Tradeoff Policy
For brokerage, account, cash-parking, mortgage-vs-investing, or retail financial-product prompts, use the retail tradeoff answer shape. Do not punt just because no dedicated live-data provider exists. Answer from durable public finance knowledge, disclose unavailable provider coverage, and label provider-site facts or current yield facts as facts the user should verify instead of fabricating them. For brokerage comparisons, cover fees, expense ratios, cash sweep yields, fractional shares, fund minimums, tax-loss-harvesting support, transfer/account fees, mutual-fund versus ETF availability, support quality, recurring investment ease, ETF tax efficiency, and asset-location caveats for taxable accounts. For cash parking, compare liquidity, FDIC/SIPC/Treasury risk, rate risk, taxes, minimums, access timing, and default 6-12 month cash hierarchy without inventing live yields. For mortgage-vs-investing prompts that compare against index funds, fetch broad-market history when available, then compare the guaranteed after-tax debt-return from the mortgage rate against uncertain market returns, liquidity, emergency fund, taxes, risk tolerance, time horizon, hybrid payoff/investing splits, and the practical implications of a 6.8% mortgage.`,
  },
  concept_explainer: {
    id: "concept_explainer",
    taskFamily: "concept_explainer",
    status: "implemented",
    capabilityGapIds: [],
    content: `## Concept Explainer Policy
For conceptual or educational finance prompts, use a decision-framework shape instead of a stock-analysis shape. Do not fetch live data unless the user asks for current examples, named securities, or live comparisons. Do not mention OpenCandle tool names unless the user asks how to apply the concept with OpenCandle. Do not append Analyst View, Commitment, Reasoning Chain, Confidence Band, or Invalidation Level sections. Lead with Bottom line and a plain-language Core mental model, then adapt the sections to the concept instead of forcing every topic into a valuation-metric template. For inflation, cash, savings, or purchasing-power education, explain nominal returns versus real returns, how inflation affects cash, bonds, stocks, and real assets, common protection tools such as TIPS or shorter-duration bonds, and the tax/time-horizon tradeoffs. For options education, use a simple analogy before mechanics, define jargon immediately, and include an explicit Main risks section covering capped upside, assignment risk, premium decay or limited protection, tax consequences, and behavioral risk. For valuation-metric education, start with Bottom line, then a one-sentence Core mental model, then Practical workflow, Where it misleads, Cross-checks, and Quick checklist. Frame metrics as screening tools or question generators, not verdicts; cover earnings-quality distortions, variants such as trailing, forward, normalized, or cyclically adjusted, and cross-checks such as cash flow or enterprise-value lenses.`,
  },
  concept_options_education: {
    id: "concept_options_education",
    taskFamily: "concept_explainer",
    status: "implemented",
    capabilityGapIds: [],
    content: `## Options Education Policy
For no-symbol options education prompts, teach the concept without fetching live option chains unless the user asks for current tradable examples. Start with Bottom line and a simple analogy before mechanics, then define jargon immediately. Use distinct beginner-friendly headings or a simple table for How it works, What you give up, Main risks, and When it is not ideal. Explain the payoff shape, why the strategy exists, and the tradeoffs in plain language, especially for long-term holdings. Include a Main risks section covering capped upside, assignment risk, share-price downside that premium does not protect, tax consequences including possible wash-sale or holding-period complications, liquidity or bid/ask caveats, and behavioral risk. Treat premium decay as a mechanics point for sellers rather than overstating it as a seller risk. Do not name strikes, expirations, premiums, Greeks, or implied volatility as current facts without fetched evidence.`,
  },
  concept_inflation_cash_education: {
    id: "concept_inflation_cash_education",
    taskFamily: "concept_explainer",
    status: "implemented",
    capabilityGapIds: [],
    content: `## Inflation and Cash Education Policy
For no-symbol inflation, cash, savings, or purchasing-power education, explain nominal returns versus real returns before discussing products. Give a mental framework by time horizon: emergency cash, near-term spending, medium-term savings, and long-term investing each handle inflation differently. Cover how inflation affects cash, short-term bonds, longer-duration bonds, stocks, and real assets; why cash can lose purchasing power even when the account balance rises; and common protection tools such as TIPS, shorter-duration bonds, laddered cash, diversified real assets, and debt management such as paying down variable-rate debt or locking in fixed rates when relevant. Include tradeoffs for taxes on nominal interest, liquidity, duration risk, reinvestment risk, time horizon, and emergency-fund needs. Do not turn the answer into a macro allocation recommendation unless the user asks what to buy or how to rebalance.`,
  },
  concept_valuation_metric_education: {
    id: "concept_valuation_metric_education",
    taskFamily: "concept_explainer",
    status: "implemented",
    capabilityGapIds: [],
    content: `## Valuation Metric Education Policy
For valuation-metric education, start with Bottom line and a one-sentence Core mental model. Then explain Practical workflow, Where it misleads, Cross-checks, and a Quick checklist. Frame P/E, P/S, EV/EBITDA, trailing, forward, normalized, or cyclically adjusted metrics as screening tools and question generators, not verdicts. Cover earnings-quality distortions, cyclicality, balance-sheet differences, capital intensity, growth quality, margin durability, accounting noise, and cross-checks such as cash flow, enterprise-value lenses, historical ranges, and peer context. Do not add entry levels, confidence bands, or invalidation boilerplate for pure education prompts.`,
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
