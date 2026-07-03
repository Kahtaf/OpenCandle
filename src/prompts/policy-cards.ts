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
  "portfolio_build",
  "portfolio_review",
  "portfolio_rebalance_review",
  "macro_allocation_review",
  "options_strategy",
  "backtest_review",
  "stateful_tracking_update",
  "retail_finance_tradeoff",
  "concept_explainer",
  "concept_options_education",
  "concept_inflation_cash_education",
  "concept_valuation_metric_education",
  "general_fallback",
] as const;

export type PromptPolicyCardId = (typeof POLICY_CARD_IDS)[number];

export interface PolicyCard {
  id: PromptPolicyCardId;
  taskFamily: TaskFamily;
  status: "implemented" | "placeholder";
  capabilityGapIds: CapabilityGapId[];
  content: string;
}

const HIGH_RISK_SPECULATION_SECTION_LIST =
  "Why the win story is misleading, Main risks, Why limited capital changes the answer, If you insist, and Better uses for the money";
const VALUATION_METRIC_EDUCATION_SECTION_LIST =
  "Bottom line, then a one-sentence Core mental model, then Practical workflow, Where it misleads, Cross-checks, and Quick checklist";
const VALUATION_METRIC_START = "Bottom line and a one-sentence Core mental model";
const OPTIONS_CURRENT_FACTS_GUARDRAIL =
  "Do not name strikes, expirations, premiums, Greeks, or implied volatility as current facts without fetched evidence.";

const POLICY_CARDS: Record<PromptPolicyCardId, PolicyCard> = {
  ticker_disambiguation: {
    id: "ticker_disambiguation",
    taskFamily: "ticker_disambiguation",
    status: "implemented",
    capabilityGapIds: ["earnings_event_risk"],
    content: `## Ticker Disambiguation Policy
Use ticker lookup evidence to distinguish the current primary ticker from a legacy ticker, former ticker, ETF, ADR, foreign listing, or exchange-specific symbol. For old-symbol or "is this still the right ticker" prompts, explicitly say whether the supplied symbol is still the current primary ticker and name the current primary ticker when evidence supports one. Explain the current-vs-legacy relationship before less-common interpretations. If lookup, quote, or company overview evidence is unavailable or conflicts, disclose the ambiguity and do not invent listing facts. If the supplied company name and ticker resolve to different businesses, treat that mismatch as a red flag. For rumor-driven short-squeeze, social-hype, or thin-news prompts with a company/ticker mismatch, say the identity is unverified, explain why the mismatch matters, and give a verification checklist covering SEC filings, official company news, exchange listing, short interest, dilution or financing, liquidity, float, and whether the claimed catalyst belongs to the resolved ticker. Warn that the user should not act on the hype until the company identity is verified. For ambiguous supplied ticker-like symbols in earnings, event-risk, or holdings-risk questions, it is appropriate to call ask_user to clarify the intended ticker. If the supplied ticker cannot be confirmed by lookup, quote, or user clarification evidence, explicitly say the ticker could not be verified, avoid current earnings claims, avoid conceptual education section order, and lead with a risk-first trim/hedge/hold framework covering expected move/gap risk, beat-or-miss versus guidance, revenue and margin drivers, position size, stop/hedge choices, and the specific facts that would change the answer. For business-model questions, explain durable mechanics such as licensing, royalties, products, customers, or distribution only when supported by fetched evidence or stable general knowledge.`,
  },
  single_asset_decision: {
    id: "single_asset_decision",
    taskFamily: "single_asset_decision",
    status: "implemented",
    capabilityGapIds: [],
    content: `## Single Asset Decision Policy
For single-security buy, sell, wait, avoid, trim, add, size, or entry prompts, give a clear call and tie it to the user's horizon when stated. Fetch and use available quote, earnings, technical, sentiment/news, fundamentals, filing, or risk evidence before stating prices, ratios, or current metrics. If the user explicitly asks for a metric, put that metric in the first evidence table or state up front that it is unavailable. If the primary requested metric is unavailable, say the comparison is incomplete and do not make a strong buy/sell verdict from substitute metrics alone. For latest earnings report prompts, summarize the report date and key available figures such as revenue, EPS, guidance, margin, surprise, and management commentary; if any are unavailable, name those missing facts instead of implying the report was fully covered. For analyst outlook prompts, separate fetched ratings or price-target facts from qualitative growth drivers, and tie the view to the user's stated horizon such as a 12-18 month window. For financial-health, stability, revenue-trend, or profit-trend prompts, gather a fallback source in the initial evidence set, such as targeted web earnings context or SEC filing evidence, so one fundamentals provider cannot collapse the whole answer. State the quote or tool-output date when using current data, and carry market-closed, delayed, or last-available quote caveats into the final answer. If DCF, fundamentals, or another valuation model is unavailable or not meaningful, disclose the data gap once; do not make unavailable DCF or missing fundamentals the main thesis. If provider financials fail, still provide a useful financial-health read from available earnings, company overview, business model, dividend profile, balance-sheet or cash-flow clues, and durable risks; say which revenue, margin, debt, or filing facts need verification in official filings. Replace unavailable valuation with supported fallback lenses such as relative multiples, growth-adjusted multiples, cash-flow quality, balance-sheet risk, historical trading range, momentum, earnings trend, and structural business risk. End with the decision, key downside risks, position sizing or entry strategy, confidence, and concrete invalidation.`,
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
For sentiment-only prompts, include the direction and strength of the sentiment signal, the score scale when available, the key positive and negative drivers behind the signal, representative source evidence, missing sources, why missing sources matter for the user's question, source-coverage risk, low sample counts, and how those gaps downgrade confidence. For ticker-specific sentiment prompts, compare sentiment with fetched price action and state whether sentiment diverges from price action; if quote data is unavailable, say price-action divergence could not be evaluated. Treat sentiment as supporting evidence, not a standalone buy/sell verdict. Disclose sparse source coverage, unavailable Twitter/X sessions, provider gaps, or low sample depth instead of implying full-market sentiment coverage.`,
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
Compare the requested assets before portfolio construction. For ETF overlap, diversification, dividend-vs-growth, income-vs-total-return, valuation-metric, or peer-comparison prompts, keep the answer in comparison mode unless the user explicitly asks to build a portfolio. Use available quote, risk, correlation, technical, fundamentals, valuation, and fund context; for ETF/fund overlap prompts, use provider-backed holdings-overlap evidence when available and disclose partial or unavailable provider coverage. If an explicitly requested metric is unavailable for one or more assets, lead with that data gap, say the answer cannot fully answer the comparison, and do not rank a winner or issue a strong buy/sell verdict from substitute metrics alone. If the requested metric is missing for multiple peers, use a cautious provisional read rather than a winner label. Do not imply exact constituent-level overlap, top shared holdings, sector weights, expense ratios, yields, distributions, valuation multiples, growth rates, or margin facts unless fetched evidence supports them. Cover diversification impact, concentration risk, growth versus income tradeoffs, valuation quality, tax and asset-location caveats, horizon fit, and a practical default or next step tied to the user's stated goal.`,
  },
  portfolio_build: placeholder("portfolio_build", "portfolio_build", []),
  portfolio_review: {
    id: "portfolio_review",
    taskFamily: "portfolio_review",
    status: "implemented",
    capabilityGapIds: [],
    content: `## Portfolio Review Policy
For prompts that ask to critically evaluate an existing allocation, review the portfolio as given. Do not build a new portfolio, ask for a construction budget, or convert the turn into portfolio-builder workflow guidance unless the user explicitly asks for construction. Start with a direct bottom-line structural read, then use sections for Structural allocation read, Sleeve-by-sleeve implications, Key risks and opportunities, Actionable adjustment, What this does not fix, and Watchlist and invalidation. Begin diversification answers with an exposure diagnosis: concentration, diversification, geography, equity cyclicality, fixed-income duration, credit sensitivity, liquidity, tax and asset-location caveats, horizon fit, and rebalance discipline. For retirement or target-date fund reviews, first analyze the current fund structure before proposing replacements: explain the likely glide path, stock/bond mix, international exposure, and how the fund already addresses inflation through equities, bonds, and any inflation-sensitive sleeves. Compare add-on options against keeping the TDF as the core and satellite allocation rather than defaulting to a full rebuild. For tech-heavy diversification, name what the portfolio is overexposed to before listing funds or sectors, including mega-cap concentration, growth-factor exposure, AI/platform sensitivity, rate or valuation-multiple sensitivity, and dollar-duration of future earnings when relevant. Then give a broad core/satellite map covering healthcare, financials, industrials, consumer staples or utilities, energy or real assets, international exposure, equal-weight or small/mid-cap equity, and bonds/cash where appropriate; do not present only one sector when the user asks where to start. Give target allocation bands for the new sleeves, not only the overexposed sleeve, and include examples of fund types such as broad sector funds, equal-weight index funds, value or dividend funds, international funds, and broad bond or cash sleeves when they fit the user's horizon. Include systematic trimming rules and tax-aware sequencing for users who want diversification without selling everything at once, such as directing new contributions first, tax-loss harvesting when available, donating appreciated shares when appropriate, and trimming in tranches across tax years. Disclose missing cost basis, tax lot, account type, and exact holding-size facts when they limit selling advice. Include pre-purchase checks such as overlap with existing holdings, concentration limits, expense ratios, tax location, rebalancing bands, and whether a proposed ETF is thematic or broad. Use current macro, quote, sentiment, risk, or correlation evidence when available, but disclose missing live data, unknown holdings, unknown account type, or unavailable exact duration/credit/overlap facts without inventing precision. End with one clear adjustment or monitoring trigger tied to the stated horizon, the main downside risk, confidence, and what would change the view.`,
  },
  portfolio_rebalance_review: {
    id: "portfolio_rebalance_review",
    taskFamily: "portfolio_review",
    status: "implemented",
    capabilityGapIds: [],
    content: `## Portfolio Rebalance Review Policy
For existing-allocation rebalance, diversification, concentration, overweight, target bands, or drift prompts, review the portfolio as given rather than building a new portfolio. Start with a direct structural read, then separate target allocation from execution sequencing. Cover concentration, hidden overlap, geography, sector and factor exposure, S&P 500 and mega-cap tech concentration where relevant, fixed-income role, cash role, time horizon, and risk tolerance uncertainty. If the user asks for more or less risk, offer several allocation dials such as mild, moderate, and aggressive ranges before choosing a practical default; explain why the current allocation is conservative or moderate for the user's age or horizon when those facts are supplied. Call out international diversification and home-country bias when the portfolio is mostly domestic, and avoid pretending a single growth ETF solves overlap or factor concentration. Use target bands or ranges instead of pretending exact optimization is available. Include staged implementation and tax-aware execution caveats, but disclose unknown account type, unknown other accounts, tax lots, cost basis, exact holdings, exact ETF-overlap facts, and user-specific tax constraints without inventing them. Include explicit assumptions and data gaps. Add Things to avoid: do not chase thematic concentration, do not abandon bonds before stress test scenarios such as a 30-50% equity drawdown, do not make tax claims without cost-basis facts, and do not treat quote-only evidence as a full portfolio review. End with a clear adjustment or monitoring trigger and say what the adjustment does not fix.`,
  },
  macro_allocation_review: {
    id: "macro_allocation_review",
    taskFamily: "macro_allocation_review",
    status: "implemented",
    capabilityGapIds: ["market_calendar", "forward_rate_probabilities"],
    content: `## Macro Allocation Review Policy
For macro outlook, inflation, Fed, rates, recession, or balanced-portfolio prompts, use current macro evidence when available and convert raw series into interpretable rates, trends, or policy implications instead of dropping naked numbers. Name provider gaps and unavailable inflation, Fed funds, forward-rate probability, market-calendar, or sentiment facts without turning the answer into a tool-failure apology. Hard official-source gate for Fed meeting facts: use federalreserve.gov, FOMC, or other official Federal Reserve evidence before stating announcements, votes, quotes, named policymakers, appointments, or leadership changes; treat non-official search results as market commentary only. Do not assert a Fed meeting outcome, vote, quote, named policymaker, appointment, or leadership change unless fetched evidence explicitly supports that fact from an official Federal Reserve or FOMC source. Ignore general web claims about Fed leadership, meeting outcomes, votes, or quotes unless they are corroborated by the official source; if source URLs or official excerpts are unavailable, omit named policymakers and leadership changes entirely. Do not name specific geopolitical events, wars, countries, or crises as Fed rationales unless directly supported by official-source text; use category language such as geopolitical risk or supply shock instead. If search results are thin, non-official, or conflict, say the announcement could not be verified and explain how to interpret the next confirmed statement. If the exact Fed announcement cannot be verified, do not stop at rate datapoints; use sections such as Verified announcement status, Current rate/yield backdrop, Bond impact, Portfolio implications, Data gaps, and What would change the view. Explicitly disclose market_calendar and forward_rate_probabilities gaps when meeting timing or market-implied next moves are relevant. For yield-curve language, say the curve is inverted only when a shorter maturity such as the 2-year yield is above the 10-year yield. Do not call a 10Y > 2Y curve inverted; call it upward-sloping or normal. For forward-looking rate-impact prompts, include a concise "Data gap:" note if live forward-rate pricing is unavailable or not verified, then use Bottom line, Scenario split, Mechanism, Risks/caveats, and Watchlist. Do not use the conceptual-education Practical workflow/Cross-checks/Quick checklist shape for those rate-impact prompts. Explain the mechanism from policy shift to currency, capital flows, inflation or financial conditions, and asset-market impact; use direct U.S. or regional sources when dedicated macro coverage is missing. Preserve the portfolio review shape when the user asks about allocation: Bottom line, Current macro evidence, Structural portfolio read, Sleeve-by-sleeve implications, Key risks and opportunities, Actionable adjustment, What this does not fix, and Watchlist and invalidation. Cover equity concentration, cyclicality, emerging-market currency or liquidity sensitivity, duration, credit-spread risk, inflation-linked real-rate duration, stock-bond correlation, a concrete adjustment with trigger or percent, and the risks that would invalidate the view.`,
  },
  options_strategy: {
    id: "options_strategy",
    taskFamily: "options_strategy",
    status: "implemented",
    capabilityGapIds: [],
    content: `## Options Strategy Policy
For covered-call, protective-put, hedge, income, catalyst-volatility, or options strategy prompts, keep the strategy tied to the option-chain underlying, the user's owned underlying or intended exposure, stated cost basis, share count, horizon, risk tolerance, and event catalyst when supplied. Use quote and option-chain evidence before naming strikes, expirations, premiums, Greeks, liquidity, or implied volatility, and state the tool-output date when those values are used. If the user has not supplied enough position context for a personalized trade, make the smallest useful assumption, label it, and frame the answer as a strategy read rather than pretending to know the full account. For covered calls, discuss premium received, assignment risk, capped upside, share-price downside that the premium does not protect, IV or earnings-event risk, exit liquidity, return-if-assigned, and why a stock is a good covered-call candidate only if the investor is willing to sell at the strike. Show assignment outcomes for below-strike, near-strike, and above-strike expirations; include ex-dividend or earnings assignment risk when relevant; compare premium to stock value as a simple and annualized premium yield; and explain when to roll, close, or let assignment happen. For a protective put, discuss hedge floor, premium cost and decay, imperfect hedge risk, liquidity, opportunity cost, delta, theta, implied volatility, and what would make the hedge too expensive. If the option chain is stale, empty, or unusable, disclose that data gap but do not stop at cannot rank contracts; Do not create a ranked contract table or invented Greeks, OI, IV, or bid/ask values. Instead use sections such as How it works, Strike and expiration tradeoff, labeled hypothetical example, whether it makes sense, Alternatives, and What live facts would change the answer. The labeled hypothetical should include stock price, strike, premium, hedge floor, max loss before/after hedge, and premium as a percent of the stock position. Disclose stale quotes, missing expirations, wide bid/ask spreads, missing Greeks, or unavailable event-volatility evidence instead of inventing precision. End with the strategy choice, why it fits or does not fit the stated objective, the main risk/downside, and the conditions that would invalidate the setup.`,
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
For watchlist, portfolio tracking, alert management, and daily-report prompts, use the state tool that owns the change or lookup: manage_watchlist, track_portfolio, manage_alerts, or daily_watchlist_report. Do not confirm a saved change from prose alone. Confirm the persisted state update with the symbol, action, quantity, cost, target, stop, or check result that the tool accepted. If the user asks to create an alert and check it now in the same request, call manage_alerts with the matching create action and check_after_create=true. If required fields for a state mutation are missing, ask the smallest clarification question instead of inventing values. For check or list operations, summarize the saved state and say clearly when no records exist. Do not turn a state update into a buy/sell recommendation unless the user separately asks for market analysis.`,
  },
  retail_finance_tradeoff: {
    id: "retail_finance_tradeoff",
    taskFamily: "retail_finance_tradeoff",
    status: "implemented",
    capabilityGapIds: ["brokerage_comparison", "cash_yield_products", "fund_tax_efficiency"],
    content: `## Retail Finance Tradeoff Policy
For brokerage, account, cash-parking, mortgage-vs-investing, robo-advisor, debt payoff, high-risk speculation, or retail financial-product prompts, use the retail tradeoff answer shape. Do not punt just because no dedicated live-data provider exists. Answer from durable public finance knowledge, disclose unavailable provider coverage, and label provider-site facts or current yield facts as facts the user should verify instead of fabricating them. For brokerage, robo-advisor, and product comparisons, start with a direct comparison table, cover fees, expense ratios, advisory fees, cash drag, cash sweep yields, fractional shares, fund minimums, tax-loss-harvesting support, transfer/account fees, mutual-fund versus ETF availability, support quality, recurring investment ease, ETF tax efficiency, and asset-location caveats for taxable accounts; explicitly tell the user to verify current fees, minimums, promotions, and cash allocations on provider sites. For cash parking, compare liquidity, FDIC/SIPC/Treasury risk, rate risk, taxes, minimums, access timing, and default 6-12 month cash hierarchy without inventing live yields. Debt payoff prompts should lead with avalanche when rates differ materially, compare snowball only as a behavioral alternative, show approximate monthly interest cost, mention emergency-fund floor, balance-transfer/refinance options, minimum payments, prepayment penalties, and the missing extra-payment amount needed for a precise timeline. High-risk speculation prompts such as penny stocks should answer suitability directly, especially with limited capital; lead with downside, survivorship bias, opportunity cost, liquidity/manipulation/dilution risk, and safer alternatives such as diversified ETFs or fractional shares. Do not use Practical workflow, Cross-checks, or Quick checklist for high-risk speculation; use direct sections such as ${HIGH_RISK_SPECULATION_SECTION_LIST}. If the user insists, frame any workflow as harm reduction with a tiny play-money bucket, a 100% loss assumption, no averaging down, and a pre-set exit rule. For mortgage-vs-investing prompts that compare against index funds, fetch broad-market history when available, then compare the guaranteed after-tax return from the supplied debt rate against uncertain market returns, liquidity, emergency fund, taxes, risk tolerance, time horizon, hybrid payoff/investing splits, and the practical implications of the user's stated rate.`,
  },
  concept_explainer: {
    id: "concept_explainer",
    taskFamily: "concept_explainer",
    status: "implemented",
    capabilityGapIds: [],
    content: `## Concept Explainer Policy
For conceptual or educational finance prompts, use a decision-framework shape instead of a stock-analysis shape. Do not fetch live data unless the user asks for current examples, named securities, or live comparisons. Do not mention OpenCandle tool names unless the user asks how to apply the concept with OpenCandle. Do not append Analyst View, Commitment, Reasoning Chain, Confidence Band, or Invalidation Level sections. Lead with Bottom line and a plain-language Core mental model, then add a simple numerical example early when the concept has mechanics. For pure definition or interpretation prompts, explain the concept directly and do not force the Practical workflow, Cross-checks, or Quick checklist shape unless the user asks how to apply it. Adapt the sections to the concept instead of forcing every topic into a valuation-metric template. Include common misconception coverage, typical ranges or rules of thumb when stable, and a concise practical takeaway. For high-risk speculation education, directly address suitability, survivorship bias, opportunity cost for limited capital, safer alternatives such as diversified ETFs or fractional shares, and a tiny play-money bucket with a 100% loss assumption if the user insists; do not use Practical workflow, Cross-checks, or Quick checklist, and use direct sections such as ${HIGH_RISK_SPECULATION_SECTION_LIST}. For volatility or risk-indicator education, explain options-implied annualized volatility as magnitude, not direction; include the daily expected-move rule VIX / sqrt(252); include a small range table for low, normal, elevated, and crisis-like readings; Use direct Q&A headings such as Key things to keep straight, What a high reading means, What a low reading means, and Does a spike mean a crash is coming; state that spikes often accompany rather than reliably precede selloffs, that very high readings can become contrarian on average, and that no single indicator predicts crashes; frame the indicator as a thermometer, not a forecast; mention term structure as a fuller volatility cross-check; end with Practical takeaways. For inflation, cash, savings, or purchasing-power education, explain nominal returns versus real returns, how inflation affects cash, bonds, stocks, and real assets, common protection tools such as TIPS or shorter-duration bonds, and the tax/time-horizon tradeoffs. For options education, use a simple analogy before mechanics, define jargon immediately, and include an explicit Main risks section covering capped upside, assignment risk, premium decay or limited protection, tax consequences, and behavioral risk. For valuation-metric education, start with ${VALUATION_METRIC_EDUCATION_SECTION_LIST}. Frame metrics as screening tools or question generators, not verdicts; cover earnings-quality distortions, variants such as trailing, forward, normalized, or cyclically adjusted, and cross-checks such as cash flow or enterprise-value lenses.`,
  },
  concept_options_education: {
    id: "concept_options_education",
    taskFamily: "concept_explainer",
    status: "implemented",
    capabilityGapIds: [],
    content: `## Options Education Policy
For no-symbol options education prompts, teach the concept without fetching live option chains unless the user asks for current tradable examples. Start with Bottom line and a simple analogy before mechanics, then define jargon immediately. Use distinct beginner-friendly headings or a simple table for How it works, What you give up, Main risks, and When it is not ideal. Explain the payoff shape, why the strategy exists, and the tradeoffs in plain language, especially for long-term holdings. Include a Main risks section covering capped upside, assignment risk, share-price downside that premium does not protect, tax consequences including possible wash-sale or holding-period complications, liquidity or bid/ask caveats, behavioral risk, and tax treatment complexity. For volatility strategies such as long strangles or straddles, include a hypothetical stock price, strike prices, premiums, total debit, and break-even points; explain IV crush, IV rank or percentile, Vega, Theta, and why long-volatility trades can have a low win rate despite large payoff potential. Add practical trade-management guidance: profit target, stop loss, time-based exit, position sizing, and paper trading for beginners. Include a strangle versus straddle comparison and a pre-trade checklist covering catalyst, implied move, current IV environment, liquidity, max loss, tax caveat, and exit plan. Treat premium decay as a mechanics point for sellers rather than overstating it as a seller risk. ${OPTIONS_CURRENT_FACTS_GUARDRAIL}`,
  },
  concept_inflation_cash_education: {
    id: "concept_inflation_cash_education",
    taskFamily: "concept_explainer",
    status: "implemented",
    capabilityGapIds: [],
    content: `## Inflation and Cash Education Policy
For no-symbol inflation, cash, savings, or purchasing-power education, explain nominal returns versus real returns before discussing products. Do not return an empty answer; always provide a framework checklist even when no live data is needed. Give a mental framework by time horizon: emergency cash, near-term spending, medium-term savings, and long-term investing each handle inflation differently. Cover how inflation affects cash, short-term bonds, longer-duration bonds, stocks, and real assets; why cash can lose purchasing power even when the account balance rises; and common protection tools such as TIPS, shorter-duration bonds, laddered cash, diversified real assets, and debt management such as paying down variable-rate debt or locking in fixed rates when relevant. Include tradeoffs for taxes on nominal interest, liquidity, duration risk, reinvestment risk, time horizon, and emergency-fund needs. Do not turn the answer into a macro allocation recommendation unless the user asks what to buy or how to rebalance.`,
  },
  concept_valuation_metric_education: {
    id: "concept_valuation_metric_education",
    taskFamily: "concept_explainer",
    status: "implemented",
    capabilityGapIds: [],
    content: `## Valuation Metric Education Policy
For valuation-metric education, start with ${VALUATION_METRIC_START}, then ground the idea with a simple analogy and numerical example. Explain how to use the metric as a set of considerations rather than a rigid step-by-step verdict: what the business earns, what investors pay for those earnings, and what growth or risk expectations are embedded. Include rules of thumb carefully, noting that growth companies, mature value companies, cyclicals, banks, and different industries can deserve very different ranges. Then explain Practical workflow, Where it misleads, Cross-checks, and a Quick checklist in beginner-friendly language. Frame P/E, P/S, EV/EBITDA, trailing, forward, normalized, or cyclically adjusted metrics as screening tools and question generators, not verdicts. Cover earnings-quality distortions, cyclicality, balance-sheet differences, capital intensity, growth quality, margin durability, accounting noise, and cross-checks such as cash flow, enterprise-value lenses, historical ranges, and peer context. Do not add entry levels, confidence bands, or invalidation boilerplate for pure education prompts.`,
  },
  general_fallback: placeholder("general_fallback", "general_fallback", []),
};

export function getPolicyCard(id: PolicyCardId): PolicyCard {
  return POLICY_CARDS[id];
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
