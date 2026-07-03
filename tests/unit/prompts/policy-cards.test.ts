import { describe, expect, it } from "vitest";
import {
  getPolicyCard,
  POLICY_CARD_IDS,
  renderPolicyCardForPlanning,
  validatePolicyCardRegistry,
} from "../../../src/prompts/policy-cards.js";
import type { PlanningEnvelope } from "../../../src/routing/planning.js";

function planning(overrides: Partial<PlanningEnvelope> = {}): PlanningEnvelope {
  return {
    version: "planning-v1",
    taskFamily: "ticker_disambiguation",
    commitmentMode: "framework",
    policyCardId: "ticker_disambiguation",
    evidencePlanId: "ticker_disambiguation",
    answerContractId: "ticker_disambiguation",
    structuredCheckIds: ["required_evidence_present"],
    capabilityGapIds: ["earnings_event_risk"],
    behaviorMode: "dual_run",
    workspacePlaceholderIds: [],
    artifactPlaceholderIds: [],
    diagnostics: [],
    ...overrides,
  };
}

describe("policy cards", () => {
  it("declares stable IDs for V1 policy-card candidates", () => {
    expect(POLICY_CARD_IDS).toEqual([
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
    ]);
  });

  it("implements selected policy cards and leaves unrelated cards as placeholders", () => {
    expect(getPolicyCard("ticker_disambiguation").status).toBe("implemented");
    expect(getPolicyCard("single_asset_decision").status).toBe("implemented");
    expect(getPolicyCard("sentiment_snapshot").status).toBe("implemented");
    expect(getPolicyCard("filing_thesis_review").status).toBe("implemented");
    expect(getPolicyCard("retail_finance_tradeoff").status).toBe("implemented");
    expect(getPolicyCard("concept_explainer").status).toBe("implemented");
    expect(getPolicyCard("concept_options_education").status).toBe("implemented");
    expect(getPolicyCard("concept_inflation_cash_education").status).toBe("implemented");
    expect(getPolicyCard("concept_valuation_metric_education").status).toBe("implemented");
    expect(getPolicyCard("asset_compare").status).toBe("implemented");
    expect(getPolicyCard("portfolio_build").status).toBe("placeholder");
    expect(getPolicyCard("portfolio_review").status).toBe("implemented");
    expect(getPolicyCard("portfolio_rebalance_review").status).toBe("implemented");
    expect(getPolicyCard("macro_allocation_review").status).toBe("implemented");
    expect(getPolicyCard("options_strategy").status).toBe("implemented");
    expect(getPolicyCard("backtest_review").status).toBe("implemented");
    expect(getPolicyCard("stateful_tracking_update").status).toBe("implemented");
    expect(getPolicyCard("general_fallback")).toMatchObject({
      id: "general_fallback",
      taskFamily: "general_fallback",
      status: "placeholder",
      content: "",
    });
  });

  it("renders only the selected concept education subtype policy card", () => {
    const rendered = renderPolicyCardForPlanning(
      planning({
        taskFamily: "concept_explainer",
        policyCardId: "concept_options_education",
        evidencePlanId: "placeholder_concept_explainer",
        answerContractId: "concept_explainer",
        structuredCheckIds: ["commitment_mode_respected"],
        capabilityGapIds: [],
        behaviorMode: "replacement_active",
      }),
    );

    expect(rendered).toContain("Options Education Policy");
    expect(rendered).toContain("assignment risk");
    expect(rendered).not.toContain("Inflation and Cash Education Policy");
    expect(rendered).not.toContain("Valuation Metric Education Policy");
    expect(
      renderPolicyCardForPlanning(
        planning({
          taskFamily: "concept_explainer",
          policyCardId: "concept_options_education",
          evidencePlanId: "placeholder_concept_explainer",
          answerContractId: "concept_explainer",
          structuredCheckIds: ["commitment_mode_respected"],
          capabilityGapIds: [],
          behaviorMode: "observe_only",
        }),
      ),
    ).toBe("");
  });

  it("covers judged education gaps in targeted concept subtype cards", () => {
    const inflation = getPolicyCard("concept_inflation_cash_education").content;
    const options = getPolicyCard("concept_options_education").content;

    expect(inflation).toContain("time horizon");
    expect(inflation).toContain("tax");
    expect(inflation).toContain("debt");
    expect(inflation).toContain("mental framework");
    expect(inflation).toContain("Do not return an empty answer");
    expect(inflation).toContain("framework checklist");
    expect(options).toContain("When it is not ideal");
    expect(options).toContain("wash-sale");
    expect(options).toContain("simple table");
    expect(options).toContain("long-term holdings");
    expect(options).toContain("For volatility strategies such as long strangles or straddles");
    expect(options).toContain("hypothetical stock price");
    expect(options).toContain("break-even");
    expect(options).toContain("IV crush");
    expect(options).toContain("IV rank");
    expect(options).toContain("profit target");
    expect(options).toContain("position sizing");
    expect(options).toContain("strangle versus straddle");
    expect(options).toContain("pre-trade checklist");
    expect(options).toContain("paper trading");
    expect(options).toContain("tax treatment");
    expect(options).toContain("Vega");
    expect(options).toContain("Theta");
    const valuation = getPolicyCard("concept_valuation_metric_education").content;
    expect(valuation).toContain("simple analogy");
    expect(valuation).toContain("rules of thumb");
    expect(valuation).toContain("growth companies");
    expect(valuation).toContain("value companies");
    expect(valuation).toContain("set of considerations");
  });

  it("renders implemented policy only for dual-run or replacement-active planning", () => {
    expect(renderPolicyCardForPlanning(planning())).toContain("Ticker Disambiguation Policy");
    expect(renderPolicyCardForPlanning(planning({ behaviorMode: "replacement_active" }))).toContain(
      "Ticker Disambiguation Policy",
    );
    expect(renderPolicyCardForPlanning(planning({ behaviorMode: "observe_only" }))).toBe("");
  });

  it("renders single-asset policy only after the slice leaves observe-only mode", () => {
    const singleAssetPlanning = planning({
      taskFamily: "single_asset_decision",
      commitmentMode: "decision",
      policyCardId: "single_asset_decision",
      evidencePlanId: "placeholder_single_asset_decision",
      answerContractId: "single_asset_decision",
      structuredCheckIds: [
        "required_evidence_present",
        "freshness_disclosed",
        "data_gap_disclosed",
      ],
      capabilityGapIds: [],
      behaviorMode: "dual_run",
    });

    const rendered = renderPolicyCardForPlanning(singleAssetPlanning);
    expect(rendered).toContain("Single Asset Decision Policy");
    expect(rendered).toContain("quote or tool-output date");
    expect(rendered).toContain("market-closed");
    expect(rendered).toContain("unavailable DCF");
    expect(rendered).toContain("clear call");
    expect(rendered).toContain("If provider financials fail");
    expect(rendered).toContain("business model");
    expect(rendered).toContain("dividend profile");
    expect(rendered).toContain(
      "financial-health, stability, revenue-trend, or profit-trend prompts",
    );
    expect(rendered).toContain("targeted web earnings context or SEC filing evidence");
    expect(rendered).toContain("If the user explicitly asks for a metric");
    expect(rendered).toContain("comparison is incomplete");
    expect(rendered).toContain("do not make a strong buy/sell verdict");
    expect(rendered).toContain("latest earnings report");
    expect(rendered).toContain("revenue, EPS, guidance");
    expect(rendered).toContain("analyst outlook");
    expect(rendered).toContain("12-18 month");
    expect(rendered).toContain("growth drivers");
    expect(
      renderPolicyCardForPlanning({
        ...singleAssetPlanning,
        behaviorMode: "observe_only",
      }),
    ).toBe("");
  });

  it("allows supplied-but-unverified event-risk prompts to clarify ambiguous tickers", () => {
    const rendered = renderPolicyCardForPlanning(
      planning({
        behaviorMode: "replacement_active",
      }),
    );

    expect(rendered).toContain(
      "explicitly say whether the supplied symbol is still the current primary ticker",
    );
    expect(rendered).toContain("it is appropriate to call ask_user to clarify the intended ticker");
    expect(rendered).toContain(
      "If the supplied ticker cannot be confirmed by lookup, quote, or user clarification evidence",
    );
    expect(rendered).toContain("risk-first trim/hedge/hold framework");
  });

  it("treats company-name and ticker mismatches as a speculative-red-flag framework", () => {
    const rendered = renderPolicyCardForPlanning(
      planning({
        behaviorMode: "replacement_active",
      }),
    );

    expect(rendered).toContain(
      "If the supplied company name and ticker resolve to different businesses",
    );
    expect(rendered).toContain("red flag");
    expect(rendered).toContain("rumor-driven short-squeeze");
    expect(rendered).toContain("SEC filings");
    expect(rendered).toContain("short interest");
    expect(rendered).toContain("should not act on the hype until the company identity is verified");
  });

  it("renders asset-compare policy only after the slice leaves observe-only mode", () => {
    const assetPlanning = planning({
      taskFamily: "asset_compare",
      policyCardId: "asset_compare",
      evidencePlanId: "placeholder_asset_compare",
      answerContractId: "asset_compare_tradeoff",
      structuredCheckIds: [
        "required_evidence_present",
        "data_gap_disclosed",
        "capability_gap_disclosure",
      ],
      capabilityGapIds: ["etf_holdings_overlap"],
      behaviorMode: "dual_run",
    });

    const rendered = renderPolicyCardForPlanning(assetPlanning);
    expect(rendered).toContain("Asset Compare Policy");
    expect(rendered).toContain("Compare the requested assets before portfolio construction");
    expect(rendered).toContain("provider-backed holdings-overlap evidence");
    expect(rendered).toContain("partial or unavailable provider coverage");
    expect(rendered).toContain("dividend");
    expect(rendered).toContain("growth");
    expect(rendered).toContain("tax");
    expect(rendered).toContain("explicitly requested metric");
    expect(rendered).toContain("lead with that data gap");
    expect(rendered).toContain("cannot fully answer the comparison");
    expect(rendered).toContain("do not rank a winner");
    expect(rendered).toContain("If the requested metric is missing for multiple peers");
    expect(
      renderPolicyCardForPlanning({
        ...assetPlanning,
        behaviorMode: "observe_only",
      }),
    ).toBe("");
  });

  it("renders portfolio-review policy only after the slice leaves observe-only mode", () => {
    const portfolioPlanning = planning({
      taskFamily: "portfolio_review",
      commitmentMode: "decision",
      policyCardId: "portfolio_review",
      evidencePlanId: "placeholder_portfolio_review",
      answerContractId: "portfolio_review",
      structuredCheckIds: [
        "required_evidence_present",
        "data_gap_disclosed",
        "commitment_mode_respected",
      ],
      capabilityGapIds: [],
      behaviorMode: "dual_run",
    });

    const rendered = renderPolicyCardForPlanning(portfolioPlanning);
    expect(rendered).toContain("Portfolio Review Policy");
    expect(rendered).toContain("existing allocation");
    expect(rendered).toContain("Do not build a new portfolio");
    expect(rendered).toContain("Structural allocation read");
    expect(rendered).toContain("rebalance");
    expect(
      renderPolicyCardForPlanning({
        ...portfolioPlanning,
        behaviorMode: "observe_only",
      }),
    ).toBe("");
  });

  it("renders rebalance portfolio-review policy with honest execution caveats", () => {
    const rebalancePlanning = planning({
      taskFamily: "portfolio_review",
      commitmentMode: "decision",
      policyCardId: "portfolio_rebalance_review",
      evidencePlanId: "placeholder_portfolio_review",
      answerContractId: "portfolio_review",
      structuredCheckIds: [
        "required_evidence_present",
        "data_gap_disclosed",
        "commitment_mode_respected",
      ],
      capabilityGapIds: [],
      behaviorMode: "replacement_active",
    });

    const rendered = renderPolicyCardForPlanning(rebalancePlanning);
    expect(rendered).toContain("Portfolio Rebalance Review Policy");
    expect(rendered).toContain("hidden overlap");
    expect(rendered).toContain("S&P 500");
    expect(rendered).toContain("tax lots");
    expect(rendered).toContain("target bands");
    expect(rendered).toContain("risk tolerance");
    expect(rendered).toContain("several allocation dials");
    expect(rendered).toContain("why the current allocation is conservative or moderate");
    expect(rendered).toContain("international diversification");
    expect(rendered).toContain("home-country bias");
    expect(rendered).toContain("Things to avoid");
    expect(rendered).toContain("stress test");
    expect(rendered).toContain("explicit assumptions");
    expect(rendered).toContain("ETF-overlap");
    expect(
      renderPolicyCardForPlanning({
        ...rebalancePlanning,
        behaviorMode: "observe_only",
      }),
    ).toBe("");
  });

  it("renders macro allocation policy only after the slice leaves observe-only mode", () => {
    const macroPlanning = planning({
      taskFamily: "macro_allocation_review",
      commitmentMode: "decision",
      policyCardId: "macro_allocation_review",
      evidencePlanId: "market_status",
      answerContractId: "macro_allocation_review",
      structuredCheckIds: [
        "required_evidence_present",
        "freshness_disclosed",
        "data_gap_disclosed",
      ],
      capabilityGapIds: ["market_calendar", "forward_rate_probabilities"],
      behaviorMode: "dual_run",
    });

    const rendered = renderPolicyCardForPlanning(macroPlanning);
    expect(rendered).toContain("Macro Allocation Review Policy");
    expect(rendered).toContain("Current macro evidence");
    expect(rendered).toContain("provider gaps");
    expect(rendered).toContain("Data gap:");
    expect(rendered).toContain("forward-rate pricing");
    expect(rendered).toContain("forward-looking rate-impact prompts");
    expect(rendered).toContain("Do not use the conceptual-education");
    expect(rendered).toContain("Sleeve-by-sleeve implications");
    expect(rendered).toContain("Watchlist and invalidation");
    expect(rendered).toContain("Do not assert a Fed meeting outcome");
    expect(rendered).toContain("named policymaker");
    expect(rendered).toContain("If the exact Fed announcement cannot be verified");
    expect(rendered).toContain("official Federal Reserve or FOMC source");
    expect(rendered).toContain("Hard official-source gate");
    expect(rendered).toContain("federalreserve.gov");
    expect(rendered).toContain("treat non-official search results as market commentary only");
    expect(rendered).toContain("Ignore general web claims about Fed leadership");
    expect(rendered).toContain("omit named policymakers and leadership changes entirely");
    expect(rendered).toContain("Do not name specific geopolitical events");
    expect(rendered).toContain("do not stop at rate datapoints");
    expect(rendered).toContain("Verified announcement status");
    expect(rendered).toContain("Bond impact");
    expect(rendered).toContain("market_calendar");
    expect(rendered).toContain("forward_rate_probabilities");
    expect(rendered).toContain("2-year yield is above the 10-year yield");
    expect(rendered).toContain("Do not call a 10Y > 2Y curve inverted");
    expect(
      renderPolicyCardForPlanning({
        ...macroPlanning,
        behaviorMode: "observe_only",
      }),
    ).toBe("");
  });

  it("renders options policy only after the slice leaves observe-only mode", () => {
    const optionsPlanning = planning({
      taskFamily: "options_strategy",
      commitmentMode: "decision",
      policyCardId: "options_strategy",
      evidencePlanId: "placeholder_options_strategy",
      answerContractId: "options_strategy",
      structuredCheckIds: ["required_evidence_present", "freshness_disclosed"],
      capabilityGapIds: [],
      behaviorMode: "dual_run",
    });

    const rendered = renderPolicyCardForPlanning(optionsPlanning);
    expect(rendered).toContain("Options Strategy Policy");
    expect(rendered).toContain("owned underlying");
    expect(rendered).toContain("catalyst");
    expect(rendered).toContain("premium received");
    expect(rendered).toContain("protective put");
    expect(rendered).toContain("good covered-call candidate only if");
    expect(rendered).toContain("assignment outcomes");
    expect(rendered).toContain("ex-dividend");
    expect(rendered).toContain("annualized premium yield");
    expect(rendered).toContain("roll, close, or let assignment happen");
    expect(rendered).toContain("If the option chain is stale, empty, or unusable");
    expect(rendered).toContain("do not stop at cannot rank contracts");
    expect(rendered).toContain("labeled hypothetical example");
    expect(rendered).toContain("hedge floor");
    expect(rendered).toContain("premium as a percent of the stock position");
    expect(rendered).toContain("whether it makes sense");
    expect(rendered).toContain("Do not create a ranked contract table");
    expect(rendered).toContain("How it works");
    expect(rendered).toContain("Strike and expiration tradeoff");
    expect(rendered).toContain("Alternatives");
    expect(
      renderPolicyCardForPlanning({
        ...optionsPlanning,
        behaviorMode: "observe_only",
      }),
    ).toBe("");
  });

  it("renders backtest policy only after the slice leaves observe-only mode", () => {
    const backtestPlanning = planning({
      taskFamily: "backtest_review",
      commitmentMode: "framework",
      policyCardId: "backtest_review",
      evidencePlanId: "placeholder_backtest_review",
      answerContractId: "backtest_review",
      structuredCheckIds: [
        "required_evidence_present",
        "data_gap_disclosed",
        "source_coverage_disclosed",
      ],
      capabilityGapIds: [],
      behaviorMode: "dual_run",
    });

    const rendered = renderPolicyCardForPlanning(backtestPlanning);
    expect(rendered).toContain("Backtest Review Policy");
    expect(rendered).toContain("strategy return");
    expect(rendered).toContain("buy-and-hold return");
    expect(rendered).toContain("win rate");
    expect(rendered).toContain("costs and slippage");
    expect(
      renderPolicyCardForPlanning({
        ...backtestPlanning,
        behaviorMode: "observe_only",
      }),
    ).toBe("");
  });

  it("renders stateful tracking policy only after the slice leaves observe-only mode", () => {
    const statefulPlanning = planning({
      taskFamily: "stateful_tracking_update",
      commitmentMode: "update_state",
      policyCardId: "stateful_tracking_update",
      evidencePlanId: "placeholder_stateful_tracking_update",
      answerContractId: "stateful_tracking_update",
      structuredCheckIds: ["commitment_mode_respected"],
      capabilityGapIds: [],
      behaviorMode: "dual_run",
    });

    const rendered = renderPolicyCardForPlanning(statefulPlanning);
    expect(rendered).toContain("Stateful Tracking Update Policy");
    expect(rendered).toContain("track_portfolio");
    expect(rendered).toContain("manage_watchlist");
    expect(rendered).toContain("Confirm the persisted state update");
    expect(rendered).toContain("Do not turn a state update into a buy/sell recommendation");
    expect(
      renderPolicyCardForPlanning({
        ...statefulPlanning,
        behaviorMode: "observe_only",
      }),
    ).toBe("");
  });

  it("does not inject unrelated placeholder policy cards", () => {
    const rendered = renderPolicyCardForPlanning(
      planning({
        taskFamily: "portfolio_build",
        policyCardId: "portfolio_build",
        evidencePlanId: "placeholder_portfolio_build",
        answerContractId: "portfolio_build",
        capabilityGapIds: [],
      }),
    );

    expect(rendered).toBe("");
  });

  it("renders current-event policy only after the slice leaves observe-only mode", () => {
    const currentEventPlanning = planning({
      taskFamily: "current_event_explanation",
      policyCardId: "current_event_explanation",
      evidencePlanId: "market_status",
      answerContractId: "current_event_explanation",
      structuredCheckIds: ["required_evidence_present", "freshness_disclosed"],
      capabilityGapIds: ["market_calendar"],
      behaviorMode: "dual_run",
    });

    const rendered = renderPolicyCardForPlanning(currentEventPlanning);
    expect(rendered).toContain("Current Event Explanation Policy");
    expect(rendered).toContain(
      "Fetch quote or market-status evidence before searching for news or event catalysts",
    );
    expect(
      renderPolicyCardForPlanning({
        ...currentEventPlanning,
        behaviorMode: "observe_only",
      }),
    ).toBe("");
  });

  it("renders concept policy only after the slice leaves observe-only mode", () => {
    const conceptPlanning = planning({
      taskFamily: "concept_explainer",
      policyCardId: "concept_explainer",
      evidencePlanId: "placeholder_concept_explainer",
      answerContractId: "concept_explainer",
      structuredCheckIds: ["commitment_mode_respected"],
      capabilityGapIds: [],
      behaviorMode: "dual_run",
    });

    const rendered = renderPolicyCardForPlanning(conceptPlanning);
    expect(rendered).toContain("Concept Explainer Policy");
    expect(rendered).toContain("Bottom line");
    expect(rendered).toContain("Core mental model");
    expect(rendered).toContain("Practical workflow");
    expect(rendered).toContain("Where it misleads");
    expect(rendered).toContain("Cross-checks");
    expect(rendered).toContain("Quick checklist");
    expect(rendered).toContain("For inflation");
    expect(rendered).toContain("nominal returns");
    expect(rendered).toContain("For options education");
    expect(rendered).toContain("Main risks");
    expect(rendered).toContain("simple analogy");
    expect(rendered).toContain("simple numerical example");
    expect(rendered).toContain("common misconception");
    expect(rendered).toContain("typical ranges or rules of thumb");
    expect(rendered).toContain("spikes often accompany");
    expect(rendered).toContain("For pure definition or interpretation prompts");
    expect(rendered).toContain("do not force the Practical workflow");
    expect(rendered).toContain("options-implied annualized volatility");
    expect(rendered).toContain("daily expected-move rule");
    expect(rendered).toContain("magnitude, not direction");
    expect(rendered).toContain("Use direct Q&A headings");
    expect(rendered).toContain("What a high reading means");
    expect(rendered).toContain("What a low reading means");
    expect(rendered).toContain("VIX / sqrt(252)");
    expect(rendered).toContain("small range table");
    expect(rendered).toContain("Practical takeaways");
    expect(rendered).toContain("thermometer, not a forecast");
    expect(rendered).toContain("term structure");
    expect(rendered).toContain("Key things to keep straight");
    expect(rendered).toContain("For high-risk speculation education");
    expect(rendered).toContain("opportunity cost");
    expect(rendered).toContain("do not use Practical workflow, Cross-checks, or Quick checklist");
    expect(rendered).toContain("Why the win story is misleading");
    expect(rendered).toContain("If you insist");
    expect(
      renderPolicyCardForPlanning({
        ...conceptPlanning,
        behaviorMode: "observe_only",
      }),
    ).toBe("");
  });

  it("keeps portfolio diversification reviews broad and synthesis-consistent", () => {
    const rendered = renderPolicyCardForPlanning(
      planning({
        taskFamily: "portfolio_review",
        policyCardId: "portfolio_review",
        evidencePlanId: "placeholder_portfolio_review",
        answerContractId: "portfolio_review",
        structuredCheckIds: ["data_gap_disclosed"],
        capabilityGapIds: [],
        behaviorMode: "replacement_active",
      }),
    );

    expect(rendered).toContain("For tech-heavy diversification");
    expect(rendered).toContain("healthcare");
    expect(rendered).toContain("financials");
    expect(rendered).toContain("industrials");
    expect(rendered).toContain("international");
    expect(rendered).toContain("core/satellite");
    expect(rendered).toContain("do not present only one sector");
    expect(rendered).toContain("exposure diagnosis");
    expect(rendered).toContain("mega-cap concentration");
    expect(rendered).toContain("valuation-multiple sensitivity");
    expect(rendered).toContain("pre-purchase checks");
    expect(rendered).toContain("target allocation bands");
    expect(rendered).toContain("examples of fund types");
    expect(rendered).toContain("equal-weight");
    expect(rendered).toContain("value or dividend");
    expect(rendered).toContain("systematic trimming");
    expect(rendered).toContain("tax-aware");
    expect(rendered).toContain("tax-loss harvesting");
    expect(rendered).toContain("donating appreciated shares");
    expect(rendered).toContain("across tax years");
    expect(rendered).toContain("cost basis");
    expect(rendered).toContain("target-date fund");
    expect(rendered).toContain("glide path");
    expect(rendered).toContain("already addresses inflation");
    expect(rendered).toContain("core and satellite");
  });

  it("renders sentiment policy only after the slice leaves observe-only mode", () => {
    const sentimentPlanning = planning({
      taskFamily: "sentiment_snapshot",
      policyCardId: "sentiment_snapshot",
      evidencePlanId: "placeholder_sentiment_snapshot",
      answerContractId: "sentiment_snapshot",
      structuredCheckIds: [
        "required_evidence_present",
        "source_coverage_disclosed",
        "data_gap_disclosed",
      ],
      capabilityGapIds: ["sentiment_sample_depth"],
      behaviorMode: "dual_run",
    });

    const rendered = renderPolicyCardForPlanning(sentimentPlanning);
    expect(rendered).toContain("Sentiment Snapshot Policy");
    expect(rendered).toContain("direction and strength");
    expect(rendered).toContain("score scale");
    expect(rendered).toContain("key positive and negative drivers");
    expect(rendered).toContain("representative source evidence");
    expect(rendered).toContain("missing sources");
    expect(rendered).toContain("source-coverage risk");
    expect(rendered).toContain("low sample counts");
    expect(rendered).toContain("diverges from price action");
    expect(
      renderPolicyCardForPlanning({
        ...sentimentPlanning,
        behaviorMode: "observe_only",
      }),
    ).toBe("");
  });

  it("renders filing policy only after the slice leaves observe-only mode", () => {
    const filingPlanning = planning({
      taskFamily: "filing_thesis_review",
      policyCardId: "filing_thesis_review",
      evidencePlanId: "placeholder_filing_thesis_review",
      answerContractId: "filing_thesis_review",
      structuredCheckIds: ["required_evidence_present", "data_gap_disclosed"],
      capabilityGapIds: [],
      behaviorMode: "dual_run",
    });

    const rendered = renderPolicyCardForPlanning(filingPlanning);
    expect(rendered).toContain("Filing Thesis Review Policy");
    expect(rendered).toContain("get_sec_filings");
    expect(rendered).toContain("filing metadata");
    expect(rendered).toContain("filing-section summaries");
    expect(rendered).toContain("market data");
    expect(rendered).toContain("Do not claim");
    expect(
      renderPolicyCardForPlanning({
        ...filingPlanning,
        behaviorMode: "observe_only",
      }),
    ).toBe("");
  });

  it("renders retail policy only after the slice leaves observe-only mode", () => {
    const retailPlanning = planning({
      taskFamily: "retail_finance_tradeoff",
      policyCardId: "retail_finance_tradeoff",
      evidencePlanId: "placeholder_retail_finance_tradeoff",
      answerContractId: "retail_tradeoff_framework",
      structuredCheckIds: ["data_gap_disclosed", "capability_gap_disclosure"],
      capabilityGapIds: ["brokerage_comparison", "cash_yield_products", "fund_tax_efficiency"],
      behaviorMode: "dual_run",
    });

    const rendered = renderPolicyCardForPlanning(retailPlanning);
    expect(rendered).toContain("Retail Finance Tradeoff Policy");
    expect(rendered).toContain("Do not punt");
    expect(rendered).toContain("brokerage");
    expect(rendered).toContain("cash sweep yields");
    expect(rendered).toContain("current yield facts");
    expect(rendered).toContain("the supplied debt rate");
    expect(rendered).not.toContain("6.8% mortgage");
    expect(rendered).toContain("direct comparison table");
    expect(rendered).toContain("cash drag");
    expect(rendered).toContain("verify current fees");
    expect(rendered).toContain("Debt payoff");
    expect(rendered).toContain("avalanche");
    expect(rendered).toContain("High-risk speculation");
    expect(rendered).toContain("survivorship bias");
    expect(rendered).toContain("opportunity cost");
    expect(rendered).toContain("play-money bucket");
    expect(rendered).toContain("safer alternatives");
    expect(rendered).toContain("Do not use Practical workflow, Cross-checks, or Quick checklist");
    expect(
      renderPolicyCardForPlanning({
        ...retailPlanning,
        behaviorMode: "observe_only",
      }),
    ).toBe("");
  });

  it("asserts policy cards disclose capability gaps instead of claiming them", () => {
    expect(validatePolicyCardRegistry()).toEqual([]);
  });
});
