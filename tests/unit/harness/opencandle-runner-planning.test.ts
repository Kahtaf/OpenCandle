import { describe, expect, it } from "vitest";
import { toEvalTrace } from "../../harness/opencandle-runner.js";
import type { AgentTrace, ToolCallTrace } from "../../harness/types.js";

interface PlanningTraceOptions {
  prompt: string;
  finalText: string;
  taskFamily: string;
  commitmentMode: string;
  answerContractId: string;
  evidencePlanId: string;
  policyCardId?: string;
  structuredCheckIds?: string[];
  capabilityGapIds?: string[];
  toolCalls?: ToolCallTrace[];
}

function planningTrace(options: PlanningTraceOptions): AgentTrace {
  const toolCalls = options.toolCalls ?? [];
  return {
    prompt: options.prompt,
    turns: [{ text: options.finalText, toolCalls }],
    interactions: [],
    finalText: options.finalText,
    toolSequence: toolCalls.map((call) => call.name),
    durationMs: 100,
    customEntries: [
      {
        customType: "opencandle-route-context",
        timestamp: "2026-05-24T00:00:00.000Z",
        data: {
          routeKind: "agent_task",
          workflow: "general_finance_qa",
          entities: { symbols: [] },
          toolBundles: [],
          activeToolNames: [],
          memoryQueryPlan: { categories: [] },
          diagnostics: [],
          planning: {
            version: "planning-v1",
            behaviorMode: "replacement_active",
            taskFamily: options.taskFamily,
            commitmentMode: options.commitmentMode,
            policyCardId: options.policyCardId ?? options.answerContractId,
            evidencePlanId: options.evidencePlanId,
            answerContractId: options.answerContractId,
            structuredCheckIds: options.structuredCheckIds ?? [],
            workspacePlaceholderIds: [],
            artifactPlaceholderIds: [],
            capabilityGapIds: options.capabilityGapIds ?? [],
            diagnostics: [],
          },
        },
      },
    ],
  };
}

// Real provider-error evidence: the same tagged credential failure the live
// Alpha Vantage fundamentals call returns when no key is configured.
const alphaVantageCredentialError: ToolCallTrace = {
  name: "get_fundamentals",
  args: { symbol: "AAPL" },
  result:
    '[OPENCANDLE_CREDENTIAL_REQUIRED provider=alpha_vantage reason=missing unlocks="fundamentals, DCF" fallback=none]',
  isError: false,
  durationMs: 5,
};

function failureIds(trace: ReturnType<typeof toEvalTrace>): string[] {
  return (trace.planning?.structuredCheckFailures ?? []).map((failure) => failure.checkId);
}

describe("OpenCandle harness planning telemetry", () => {
  it("extends eval traces with planning, minimal evidence, structured checks, and retry eligibility", () => {
    const agentTrace: AgentTrace = {
      prompt: "Why did BA move today after close?",
      turns: [
        {
          text: "answer",
          toolCalls: [
            {
              name: "get_stock_quote",
              args: { symbol: "BA" },
              result: { symbol: "BA", price: 180 },
              isError: false,
              durationMs: 10,
            },
          ],
        },
      ],
      interactions: [],
      finalText: "answer",
      toolSequence: ["get_stock_quote"],
      durationMs: 100,
      customEntries: [
        {
          customType: "opencandle-route-context",
          timestamp: "2026-05-24T00:00:00.000Z",
          data: {
            routeKind: "agent_task",
            workflow: "general_finance_qa",
            entities: { symbols: ["BA"] },
            toolBundles: ["core_market"],
            activeToolNames: ["get_stock_quote"],
            memoryQueryPlan: { categories: [] },
            diagnostics: [],
            planning: {
              version: "planning-v1",
              behaviorMode: "observe_only",
              taskFamily: "current_event_explanation",
              commitmentMode: "framework",
              policyCardId: "current_event_explanation",
              evidencePlanId: "market_status",
              answerContractId: "current_event_explanation",
              structuredCheckIds: ["required_evidence_present", "freshness_disclosed"],
              workspacePlaceholderIds: ["research_workspace_v1_placeholder"],
              artifactPlaceholderIds: ["artifact_source_coverage_placeholder"],
              capabilityGapIds: ["market_calendar"],
              diagnostics: [],
            },
          },
        },
      ],
    };

    const trace = toEvalTrace(agentTrace);

    expect(trace.planning).toEqual(
      expect.objectContaining({
        version: "planning-v1",
        taskFamily: "current_event_explanation",
        policyCardId: "current_event_explanation",
        evidencePlanId: "market_status",
        answerContractId: "current_event_explanation",
        workspacePlaceholderIds: ["research_workspace_v1_placeholder"],
        artifactPlaceholderIds: ["artifact_source_coverage_placeholder"],
        capabilityGapIds: ["market_calendar"],
      }),
    );
    expect(
      trace.planning?.evidenceRecords.some((record) => record.evidenceType === "market_status"),
    ).toBe(true);
    expect(
      trace.planning?.evidenceRecords.some(
        (record) => record.rawTracePointer?.toolName === "get_stock_quote",
      ),
    ).toBe(true);
    expect(trace.planning?.structuredCheckFailures.map((failure) => failure.checkId)).toContain(
      "freshness_disclosed",
    );
    expect(trace.planning?.retryEligibility.activeRetryAllowed).toBe(false);
  });

  it("infers framework final-answer fields for concept education traces", () => {
    const agentTrace: AgentTrace = {
      prompt: "Explain covered calls for a beginner.",
      turns: [{ text: "answer", toolCalls: [] }],
      interactions: [],
      finalText:
        "Bottom line: covered calls are income for capped upside.\n\nHow it works:\n- You sell a call.\n\nMain risks:\n- Assignment risk.",
      toolSequence: [],
      durationMs: 100,
      customEntries: [
        {
          customType: "opencandle-route-context",
          timestamp: "2026-05-24T00:00:00.000Z",
          data: {
            routeKind: "agent_task",
            workflow: "general_finance_qa",
            entities: { symbols: [] },
            toolBundles: [],
            activeToolNames: [],
            memoryQueryPlan: { categories: [] },
            diagnostics: [],
            planning: {
              version: "planning-v1",
              behaviorMode: "replacement_active",
              taskFamily: "concept_explainer",
              commitmentMode: "framework",
              policyCardId: "concept_options_education",
              evidencePlanId: "placeholder_concept_explainer",
              answerContractId: "concept_explainer",
              structuredCheckIds: ["commitment_mode_respected"],
              workspacePlaceholderIds: [],
              artifactPlaceholderIds: [],
              capabilityGapIds: [],
              diagnostics: [],
            },
          },
        },
      ],
    };

    const trace = toEvalTrace(agentTrace);

    expect(trace.planning?.structuredCheckFailures).toEqual([]);
    expect(trace.planning?.retryEligibility.eligible).toBe(false);
  });

  it("does not infer sentiment rationale from generic findings headings", () => {
    const agentTrace: AgentTrace = {
      prompt: "What is sentiment around NVDA?",
      turns: [{ text: "answer", toolCalls: [] }],
      interactions: [],
      finalText:
        "Findings: source coverage used Reddit and Twitter. Confidence is low because sample size is thin.",
      toolSequence: [],
      durationMs: 100,
      customEntries: [
        {
          customType: "opencandle-route-context",
          timestamp: "2026-05-24T00:00:00.000Z",
          data: {
            routeKind: "agent_task",
            workflow: "general_finance_qa",
            entities: { symbols: ["NVDA"] },
            toolBundles: [],
            activeToolNames: [],
            memoryQueryPlan: { categories: [] },
            diagnostics: [],
            planning: {
              version: "planning-v1",
              behaviorMode: "observe_only",
              taskFamily: "sentiment_snapshot",
              commitmentMode: "framework",
              policyCardId: "sentiment_snapshot",
              evidencePlanId: "placeholder_sentiment_snapshot",
              answerContractId: "sentiment_snapshot",
              structuredCheckIds: ["commitment_mode_respected"],
              workspacePlaceholderIds: [],
              artifactPlaceholderIds: [],
              capabilityGapIds: ["sentiment_sample_depth"],
              diagnostics: [],
            },
          },
        },
      ],
    };

    const trace = toEvalTrace(agentTrace);

    expect(trace.planning?.structuredCheckFailures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          checkId: "required_final_fields_present",
          failureReason: expect.stringContaining("sentiment_rationale"),
        }),
      ]),
    );
  });

  it("infers sentiment rationale from explicit driver evidence", () => {
    const agentTrace: AgentTrace = {
      prompt: "What is sentiment around NVDA?",
      turns: [{ text: "answer", toolCalls: [] }],
      interactions: [],
      finalText:
        "Bottom line: source coverage used Reddit and Twitter with a data gap from low sample size. " +
        "Positive drivers: datacenter demand and AI order momentum. Confidence is medium with caveats.",
      toolSequence: [],
      durationMs: 100,
      customEntries: [
        {
          customType: "opencandle-route-context",
          timestamp: "2026-05-24T00:00:00.000Z",
          data: {
            routeKind: "agent_task",
            workflow: "general_finance_qa",
            entities: { symbols: ["NVDA"] },
            toolBundles: [],
            activeToolNames: [],
            memoryQueryPlan: { categories: [] },
            diagnostics: [],
            planning: {
              version: "planning-v1",
              behaviorMode: "observe_only",
              taskFamily: "sentiment_snapshot",
              commitmentMode: "framework",
              policyCardId: "sentiment_snapshot",
              evidencePlanId: "placeholder_sentiment_snapshot",
              answerContractId: "sentiment_snapshot",
              structuredCheckIds: ["commitment_mode_respected"],
              workspacePlaceholderIds: [],
              artifactPlaceholderIds: [],
              capabilityGapIds: ["sentiment_sample_depth"],
              diagnostics: [],
            },
          },
        },
      ],
    };

    const trace = toEvalTrace(agentTrace);

    expect(trace.planning?.structuredCheckFailures).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ checkId: "required_final_fields_present" }),
      ]),
    );
  });

  it("adds portfolio exposure-map evidence for portfolio rebalance planning traces", () => {
    const agentTrace: AgentTrace = {
      prompt: "I have 45% tech, 25% S&P 500 index, 20% bonds, and 10% cash. Should I rebalance?",
      turns: [{ text: "answer", toolCalls: [] }],
      interactions: [],
      finalText:
        "Bottom line: assuming your stated allocation is current, rebalance toward 5% target bands. " +
        "Based on your stated percentages, exact ETF holdings overlap is not verified and tax costs depend on account type.",
      toolSequence: [],
      durationMs: 100,
      customEntries: [
        {
          customType: "opencandle-route-context",
          timestamp: "2026-05-24T00:00:00.000Z",
          data: {
            routeKind: "agent_task",
            workflow: "general_finance_qa",
            entities: { symbols: [] },
            toolBundles: [],
            activeToolNames: [],
            memoryQueryPlan: { categories: [] },
            diagnostics: [],
            planning: {
              version: "planning-v1",
              behaviorMode: "replacement_active",
              taskFamily: "portfolio_review",
              commitmentMode: "decision",
              policyCardId: "portfolio_rebalance_review",
              evidencePlanId: "placeholder_portfolio_review",
              answerContractId: "portfolio_review",
              structuredCheckIds: ["required_evidence_present"],
              workspacePlaceholderIds: [],
              artifactPlaceholderIds: [],
              capabilityGapIds: ["etf_holdings_overlap"],
              diagnostics: [],
            },
          },
        },
      ],
    };

    const trace = toEvalTrace(agentTrace);

    expect(trace.planning?.evidenceRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          evidenceType: "portfolio_exposure_map",
          normalizedFacts: expect.objectContaining({
            broadIndexOverlapCaveat: true,
            targetBandGuidanceNeeded: true,
          }),
        }),
      ]),
    );
    expect(trace.planning?.structuredCheckFailures.map((failure) => failure.checkId)).not.toEqual(
      expect.arrayContaining([
        "data_gap_disclosed",
        "source_coverage_disclosed",
        "capability_gap_disclosure",
        "assumption_disclosed",
        "target_bands_present",
      ]),
    );
  });
});

// Verbatim final answer from the observed live trace
// `frozen-portfolio-review-not-builder` (2026-09-24 run).
const observedPortfolioReviewAnswer = `The classic 60/40 portfolio faces a challenging and potentially rewarding year ahead. While the fixed-income component now offers attractive yields, the equity portion may contend with higher interest rates and moderating economic growth. The portfolio's diversification benefits are likely to be tested by the current macro regime.

### Structural Allocation Read

The 60% equity component is susceptible to higher borrowing costs and a potentially slowing economy. The 40% fixed-income component, however, has become more compelling, offering a substantial income stream due to elevated interest rates. This makes the fixed-income portion a more effective diversifier and source of total return than it has been in over a decade.

### Sleeve-by-Sleeve Implications

**60% Equities:**
*   **Implications:** The current Federal Funds Rate of 3.63% (as of 2026-08-01) and the 10-Year Treasury Yield at 5.11% (as of 2026-09-23) create a higher discount rate environment, which generally pressures equity valuations, particularly for growth-oriented companies. Corporate earnings growth may moderate as the economy navigates this tighter monetary policy.
*   **Opportunities:** Should inflation continue to recede (currently 3.35% YoY CPI as of 2026-08-01) without a hard landing, a supportive, albeit slower, economic environment could still allow quality companies to perform.
*   **Risks:** A prolonged period of high interest rates, a deeper-than-expected economic slowdown, or a re-acceleration of inflation would be significant headwinds for equity performance.

**40% Fixed Income:**
*   **Implications:** The 10-Year Treasury Yield of 5.11% (as of 2026-09-23) provides a compelling current income. If interest rates stabilize or decline due to an economic slowdown or disinflation, existing bond holdings would experience capital appreciation.
*   **Opportunities:** High yields offer a stronger defensive component against equity volatility. If central banks begin to cut rates in the next year, bonds are likely to generate strong returns.
*   **Risks:** The primary risk is if inflation persists, forcing central banks to maintain or further raise rates, which would lead to capital losses on current bond holdings.

### Key Risks and Opportunities

*   **Risk: Persistent Inflation:** If CPI (currently 3.35% YoY as of 2026-08-01) remains elevated or re-accelerates, both equities (due to margin pressure and higher discount rates) and bonds (due to further capital depreciation) would likely suffer.
*   **Risk: Recession:** A significant economic downturn, potentially signaled by a rising unemployment rate (currently 4.1% as of 2026-08-01), would negatively impact corporate earnings and could lead to credit risk in bond markets (though less so for high-quality government bonds).
*   **Opportunity: Disinflation and Rate Cuts:** A clear path of disinflation could lead to central bank rate cuts, which would be a tailwind for both equities (lower discount rates, potential valuation expansion) and bonds (capital appreciation).
*   **Opportunity: Attractive Bond Yields:** The current yield environment for fixed income offers a higher income stream, enhancing the portfolio's overall return potential and defensive characteristics.

### Actionable Adjustment

An investor might consider **reducing duration risk** within the fixed-income sleeve. This could involve favoring shorter-to-intermediate term bonds or bond funds, or implementing a bond laddering strategy. This adjustment aims to mitigate potential losses if interest rates continue to rise, while still capturing the currently attractive yields. On the equity side, a focus on **quality companies** with robust balance sheets, strong free cash flow, and proven profitability could offer more resilience than highly speculative growth stocks in this environment.

### What This Does Not Fix

This evaluation is based on a generic 60/40 allocation and does not account for:
*   The specific types of equities (e.g., sector allocation, geographic exposure, market capitalization) or fixed income instruments (e.g., credit quality, specific maturities).
*   Individual investor risk tolerance, specific investment objectives, time horizon beyond the next year, or tax situation.
*   Unforeseen economic or geopolitical events.

### Watchlist and Invalidation

*   **Watchlist:** Monitor key economic indicators such as CPI, the Federal Funds Rate, 10-Year Treasury yields, and the unemployment rate. Pay close attention to central bank communications regarding monetary policy and corporate earnings reports for signs of economic resilience or stress.
*   **Invalidation:**
    *   **Thesis breaks (bearish for portfolio) if:** The year-over-year CPI consistently rises above 4% for an extended period, indicating a re-entrenchment of inflation, or if the unemployment rate rises sharply above 5%, signaling a significant economic contraction.
    *   **Confidence band:** Moderate conviction. The next year presents a complex macro landscape where both the equity and fixed income sleeves have distinct opportunities and risks.
    *   **Reasoning Chain:** The evaluation considers the current high interest rate environment (FEDFUNDS 3.63%, DGS10 5.11%), moderate inflation (CPI 3.35%), and a stable unemployment rate (UNRATE 4.1%) as key drivers for both equity and fixed income performance.

**Data gaps**
*   **Alpha Vantage:** Deeper fundamental analysis (P/E ratio, EPS, profit margin, revenue growth, earnings surprise) was not performed due to the tool requiring credentials.
*   **FRED:** Only the most recent data point was retrieved for each economic series, limiting the ability to analyze historical trends.`;

// Verbatim final answer from the observed live probe
// `2026-09-24T22-24-44-070Z_competitive-finance.json` (options hedge sizing).
const observedOptionsStrategyAnswer = `To protect your 450 shares of AAPL against downside risk through the next month, you should consider purchasing **4 or 5 put options contracts** expiring on October 23, 2026. Each standard option contract controls 100 shares.

Here's a breakdown of the number of contracts and the associated tradeoffs:

**Number of Contracts:**

*   **4 Contracts:** This would cover 400 of your 450 shares, leaving 50 shares (11%) exposed to downside risk below the chosen strike price. This option offers substantial protection while minimizing premium cost.
*   **5 Contracts:** This would cover all 450 of your shares, plus an additional 50 shares. This provides full protection for your existing position but means you are paying for protection on shares you don't own, increasing your total premium cost.

**Tradeoffs to Consider:**

The choice of strike price directly impacts the cost of protection and the level of downside coverage. Lower strike prices are cheaper but offer protection only after a larger decline in the stock price. Higher strike prices are more expensive but provide protection sooner.

Here are examples using the AAPL options chain for October 23, 2026, with the underlying stock at $335.92 (as of 2026-09-24):

| Strike Price | Bid/Ask (per share) | Cost per Contract (approx. midpoint) | Cost for 4 Contracts (400 shares) | Cost for 5 Contracts (500 shares) | Protection Level |
| :----------- | :------------------ | :---------------------------------- | :--------------------------------- | :--------------------------------- | :--------------- |
| **$335.00**  | $7.20 / $7.75       | $747.50                             | $2,990.00                          | $3,737.50                          | Near current price (At-the-money) |
| **$330.00**  | $5.30 / $5.55       | $542.50                             | $2,170.00                          | $2,712.50                          | Below current price (Out-of-the-money) |
| **$320.00**  | $2.68 / $2.94       | $281.00                             | $1,124.00                          | $1,405.00                          | Further below current price (Out-of-the-money) |

*(Note: Option bid/ask quotes may be stale outside regular options trading hours; verify live executable prices after the market opens. Do not treat zero bid/ask as confirmed live illiquidity without broker verification.)*

**Key Tradeoffs:**

1.  **Premium Cost (The Cost of Protection):**
    *   **Higher Strikes = Higher Premium:** Puts with strike prices closer to or above the current stock price (in-the-money or at-the-money) cost more because they offer more immediate protection and have intrinsic value or a higher probability of expiring in-the-money.
    *   **Lower Strikes = Lower Premium:** Puts with strike prices further below the current stock price (out-of-the-money) are cheaper but only provide protection once the stock has fallen significantly.
    *   The total cost is the premium per share multiplied by 100 (per contract) and then by the number of contracts. This premium is a sunk cost regardless of whether you exercise the put or not.

2.  **Protection Level:**
    *   **Higher Strikes = More Protection:** A put with a strike of $335 means your shares are protected from falling below $335 (minus the premium paid) by the expiration date.
    *   **Lower Strikes = Less Protection:** A put with a strike of $320 means you are protected only if AAPL falls below $320. You would still incur losses between the current price and $320.

3.  **Time Decay (Theta):**
    *   Options lose value as they get closer to expiration, a phenomenon known as time decay (Theta). As you are looking for "next month" protection, the October 23rd puts will experience time decay over the next four weeks. This means that even if the stock price remains flat, the value of your put options will erode.

4.  **Implied Volatility (Vega):**
    *   The price of options is influenced by implied volatility (IV). Higher IV generally means higher option premiums, reflecting the market's expectation of larger price swings. If AAPL's implied volatility decreases over the next month, the value of your puts could decline, even if the stock price doesn't move much. Conversely, a spike in IV could increase their value.

5.  **Liquidity:**
    *   Always check the bid-ask spread and open interest (OI) for the specific option contract you are considering. A wide bid-ask spread or low open interest can make it harder to enter or exit the position at a fair price. The provided chain shows reasonable volume and open interest for the strikes around the money, which is good.

**Analyst View:**

Given your objective of downside protection for 450 shares over the next month, the data suggests considering either 4 or 5 contracts with the **2026-10-23 expiration**.

*   For a balance of cost and protection, buying **4 contracts of the $330 strike puts** would provide protection for 400 shares against a significant drop, costing approximately $2,170. This allows some initial downside but caps significant losses.
*   If you desire more robust protection closer to the current price for a larger portion of your holdings, **4 contracts of the $335 strike puts** would cost approximately $2,990 but provide protection closer to the current market price for 400 shares.

**Commitment:** Our read suggests that purchasing **4 to 5 put option contracts with a 2026-10-23 expiration** at a strike price between **$330 and $335** offers a reasonable balance of cost and protection for your 450 shares.

**Reasoning Chain:** The current AAPL price is $335.92. Options contracts are for 100 shares, so 4 contracts cover 400 shares and 5 contracts cover 500 shares. The 2026-10-23 expiration offers approximately one month of protection. The chosen strike price determines the cost and the level at which downside protection begins.

**Confidence Band:** Moderate conviction. This is a standard protective put strategy, and the options market for AAPL is liquid enough to execute this.

**Invalidation Level:** This thesis would be invalidated if:
*   AAPL experiences a significant upward movement, making the put options expire worthless and the premium a sunk cost.
*   Implied volatility collapses unexpectedly, diminishing the value of the puts faster than anticipated.
*   The options market for AAPL becomes illiquid for the chosen strikes and expiration, making it difficult to manage the position.

**Data gaps**:
*   Options bid/ask quotes may be stale outside regular options trading hours; verify live executable prices after the market opens. Do not treat zero bid/ask as confirmed live illiquidity without broker verification; do not stop at the stale quote caveat. Disclose the gap, avoid naming tradable live premiums, and finish the strategy explanation with mechanics, assignment outcomes, labeled hypotheticals, and what live broker quotes would change.`;

describe("OpenCandle harness final-answer field inference", () => {
  it("honors plural data-gap and credential disclosures from the observed portfolio-review trace", () => {
    const trace = toEvalTrace(
      planningTrace({
        prompt:
          "Critically evaluate a 60/40 portfolio for the next year. Do not build a new portfolio; just review the existing allocation.",
        taskFamily: "portfolio_review",
        commitmentMode: "decision",
        answerContractId: "portfolio_review",
        evidencePlanId: "placeholder_portfolio_review",
        structuredCheckIds: [
          "required_evidence_present",
          "data_gap_disclosed",
          "commitment_mode_respected",
        ],
        toolCalls: [
          {
            name: "get_economic_data",
            args: { series_id: "DGS10", limit: 1 },
            result: { series_id: "DGS10", value: 5.11 },
            isError: false,
            durationMs: 4,
          },
          alphaVantageCredentialError,
        ],
        finalText: observedPortfolioReviewAnswer,
      }),
    );

    expect(failureIds(trace)).not.toContain("data_gap_disclosed");
    expect(failureIds(trace)).not.toContain("commitment_mode_respected");
    expect(failureIds(trace)).not.toContain("required_final_fields_present");
  });

  it("does not treat a positive 'no data gaps' statement as a disclosure of observed provider gaps", () => {
    const trace = toEvalTrace(
      planningTrace({
        prompt: "Review my 60/40 portfolio.",
        taskFamily: "portfolio_review",
        commitmentMode: "decision",
        answerContractId: "portfolio_review",
        evidencePlanId: "placeholder_portfolio_review",
        toolCalls: [alphaVantageCredentialError],
        finalText:
          "### Structural Allocation Read\n" +
          "The allocation is defensible but the equity sleeve carries downside in a higher-rate regime.\n\n" +
          "Data disclosure: there are no data gaps; all providers responded normally.",
      }),
    );

    expect(failureIds(trace)).toContain("data_gap_disclosed");
    expect(
      trace.planning?.structuredCheckFailures.find(
        (failure) => failure.checkId === "required_final_fields_present",
      )?.failureReason,
    ).toContain("data_gap_disclosure");
  });

  it("does not treat merely naming a provider as a disclosure of an observed failure", () => {
    const trace = toEvalTrace(
      planningTrace({
        prompt: "Review my 60/40 portfolio.",
        taskFamily: "portfolio_review",
        commitmentMode: "decision",
        answerContractId: "portfolio_review",
        evidencePlanId: "placeholder_portfolio_review",
        toolCalls: [alphaVantageCredentialError],
        finalText:
          "### Structural Allocation Read\n" +
          "The allocation is defensible, though the equity sleeve carries downside in a higher-rate regime.\n\n" +
          "Some data gaps remain in the fundamental screen. Alpha Vantage supplied the screen referenced above.",
      }),
    );

    expect(failureIds(trace)).toContain("data_gap_disclosed");
  });

  it("infers a cautious review judgment for a substantive structural portfolio review", () => {
    const trace = toEvalTrace(
      planningTrace({
        prompt: "Critically evaluate a 60/40 portfolio for the next year.",
        taskFamily: "portfolio_review",
        commitmentMode: "decision",
        answerContractId: "portfolio_review",
        evidencePlanId: "placeholder_portfolio_review",
        finalText:
          "### Structural Allocation Read\n" +
          "The fixed-income sleeve is the stronger diversifier at current yields, so the allocation remains " +
          "reasonable for the next year while the equity sleeve faces a higher discount-rate environment.\n\n" +
          "### Key Risks\n* A deeper slowdown or sticky inflation is the main downside for both sleeves.",
      }),
    );

    expect(failureIds(trace)).not.toContain("commitment_mode_respected");
  });

  it("does not infer a review judgment from a vague portfolio review", () => {
    const trace = toEvalTrace(
      planningTrace({
        prompt: "Review my 60/40 portfolio.",
        taskFamily: "portfolio_review",
        commitmentMode: "decision",
        answerContractId: "portfolio_review",
        evidencePlanId: "placeholder_portfolio_review",
        finalText: "Overall this portfolio review looks reasonable. There may be risks.",
      }),
    );

    expect(failureIds(trace)).toContain("commitment_mode_respected");
  });

  it("does not infer a review judgment from a heading plus risk keyword", () => {
    const trace = toEvalTrace(
      planningTrace({
        prompt: "Review my 60/40 portfolio.",
        taskFamily: "portfolio_review",
        commitmentMode: "decision",
        answerContractId: "portfolio_review",
        evidencePlanId: "placeholder_portfolio_review",
        finalText: "Structural review. Risk.",
      }),
    );

    expect(failureIds(trace)).toContain("commitment_mode_respected");
    expect(
      trace.planning?.structuredCheckFailures.find(
        (failure) => failure.checkId === "required_final_fields_present",
      )?.failureReason,
    ).toContain("framework_or_checklist");
  });

  it("does not infer a review judgment or framework from bare empty headings", () => {
    const trace = toEvalTrace(
      planningTrace({
        prompt: "Review my 60/40 portfolio.",
        taskFamily: "portfolio_review",
        commitmentMode: "decision",
        answerContractId: "portfolio_review",
        evidencePlanId: "placeholder_portfolio_review",
        finalText:
          "### The 60/40 Portfolio Faces A Challenging And Rewarding Year\n\n### Key Risks\n",
      }),
    );

    expect(failureIds(trace)).toContain("commitment_mode_respected");
    const requiredFieldsReason = trace.planning?.structuredCheckFailures.find(
      (failure) => failure.checkId === "required_final_fields_present",
    )?.failureReason;
    expect(requiredFieldsReason).toContain("clear_commitment");
    expect(requiredFieldsReason).toContain("framework_or_checklist");
  });

  it("keeps a single-asset decision without a concrete action failing clear commitment", () => {
    const trace = toEvalTrace(
      planningTrace({
        prompt: "What should I do with my AAPL position?",
        taskFamily: "single_asset_decision",
        commitmentMode: "decision",
        answerContractId: "single_asset_decision",
        evidencePlanId: "placeholder_single_asset_decision",
        finalText:
          "AAPL trades at a premium valuation with a solid balance sheet. The main downside is multiple " +
          "compression if growth slows, and the position size matters.",
      }),
    );

    expect(failureIds(trace)).toContain("commitment_mode_respected");
  });
});

describe("OpenCandle harness freshness metadata inference", () => {
  it("infers observed freshness from the as-of date in the observed options-strategy probe", () => {
    const trace = toEvalTrace(
      planningTrace({
        prompt:
          "I own 450 shares of AAPL and want downside protection through the next month. How many puts should I consider and what tradeoffs matter?",
        taskFamily: "options_strategy",
        commitmentMode: "decision",
        answerContractId: "options_strategy",
        evidencePlanId: "placeholder_options_strategy",
        structuredCheckIds: ["required_evidence_present", "freshness_disclosed"],
        finalText: observedOptionsStrategyAnswer,
      }),
    );

    expect(failureIds(trace)).not.toContain("freshness_disclosed");
    expect(failureIds(trace)).not.toContain("required_final_fields_present");
  });

  it("does not infer freshness from an expiry date alone", () => {
    const trace = toEvalTrace(
      planningTrace({
        prompt: "How many puts should I buy?",
        taskFamily: "options_strategy",
        commitmentMode: "decision",
        answerContractId: "options_strategy",
        evidencePlanId: "placeholder_options_strategy",
        finalText:
          "Consider 4 put contracts expiring on October 23, 2026. The 2026-10-23 expiration is about one month out. " +
          "The main risk is paying premium that decays.",
      }),
    );

    expect(failureIds(trace)).toContain("freshness_disclosed");
    expect(
      trace.planning?.structuredCheckFailures.find(
        (failure) => failure.checkId === "required_final_fields_present",
      )?.failureReason,
    ).toContain("freshness_disclosure");
  });

  it("does not infer freshness from a generic freshness word or an empty heading", () => {
    const trace = toEvalTrace(
      planningTrace({
        prompt: "How many puts should I buy?",
        taskFamily: "options_strategy",
        commitmentMode: "decision",
        answerContractId: "options_strategy",
        evidencePlanId: "placeholder_options_strategy",
        finalText:
          "### Freshness\n\nCheck the freshness of the quote data before execution, then consider 4 puts for downside protection.",
      }),
    );

    expect(failureIds(trace)).toContain("freshness_disclosed");
    expect(
      trace.planning?.structuredCheckFailures.find(
        (failure) => failure.checkId === "required_final_fields_present",
      )?.failureReason,
    ).toContain("freshness_disclosure");
  });

  it("does not infer freshness from a bare last trading day heading", () => {
    const trace = toEvalTrace(
      planningTrace({
        prompt: "How many puts should I buy?",
        taskFamily: "options_strategy",
        commitmentMode: "decision",
        answerContractId: "options_strategy",
        evidencePlanId: "placeholder_options_strategy",
        finalText:
          "### Last trading day\n\nPrices were reviewed, then consider 4 puts for downside protection.",
      }),
    );

    expect(failureIds(trace)).toContain("freshness_disclosed");
    expect(
      trace.planning?.structuredCheckFailures.find(
        (failure) => failure.checkId === "required_final_fields_present",
      )?.failureReason,
    ).toContain("freshness_disclosure");
  });

  it("infers freshness from explicit market closed wording", () => {
    const trace = toEvalTrace(
      planningTrace({
        prompt: "How many puts should I buy?",
        taskFamily: "options_strategy",
        commitmentMode: "decision",
        answerContractId: "options_strategy",
        evidencePlanId: "placeholder_options_strategy",
        finalText:
          "The market is closed, so the option quotes are from the prior session. Consider 4 puts for downside protection.",
      }),
    );

    expect(failureIds(trace)).not.toContain("freshness_disclosed");
  });

  it("infers freshness from last trading day wording", () => {
    const trace = toEvalTrace(
      planningTrace({
        prompt: "How many puts should I buy?",
        taskFamily: "options_strategy",
        commitmentMode: "decision",
        answerContractId: "options_strategy",
        evidencePlanId: "placeholder_options_strategy",
        finalText:
          "Prices reflect the last trading day (2026-09-23). Consider 4 puts for downside protection.",
      }),
    );

    expect(failureIds(trace)).not.toContain("freshness_disclosed");
  });
});
