import { describe, expect, it } from "vitest";
import type { OptionsScreenerSlots, SlotResolution } from "../../../src/routing/types.js";
import { buildOptionsScreenerWorkflowDefinition } from "../../../src/workflows/options-screener.js";

function makeResolution(
  overrides: Partial<OptionsScreenerSlots> = {},
): SlotResolution<OptionsScreenerSlots> {
  const resolved: OptionsScreenerSlots = {
    symbol: "MSFT",
    direction: "bullish",
    dteTarget: "25_to_45_days",
    objective: "balanced_leverage_and_probability",
    moneynessPreference: "atm_to_slightly_otm",
    liquidityMinimum: "high_open_interest_and_tight_spread",
    ...overrides,
  };
  return {
    resolved,
    sources: {
      symbol: "user",
      direction: "user",
      dteTarget: "default",
      objective: "default",
      moneynessPreference: "default",
      liquidityMinimum: "default",
    },
    defaultsUsed: ["dteTarget", "objective", "moneynessPreference", "liquidityMinimum"],
    missingRequired: [],
  };
}

function initialPrompt(resolution = makeResolution()): string {
  return buildOptionsScreenerWorkflowDefinition(resolution).steps[0].prompt;
}

function followUpPrompt(resolution = makeResolution()): string {
  return buildOptionsScreenerWorkflowDefinition(resolution).steps[1].prompt;
}

describe("buildOptionsScreenerWorkflowDefinition", () => {
  it("returns initial prompt with symbol", () => {
    expect(initialPrompt()).toContain("MSFT");
  });

  it("initial prompt contains get_option_chain instruction", () => {
    expect(initialPrompt()).toContain("get_option_chain");
  });

  it("returns follow-up for ranking presentation", () => {
    const def = buildOptionsScreenerWorkflowDefinition(makeResolution());
    expect(def.steps.slice(1).length).toBeGreaterThanOrEqual(1);
    const rankFollowUp = def.steps
      .slice(1)
      .map((step) => step.prompt)
      .find((f) => f.toLowerCase().includes("rank") || f.toLowerCase().includes("top"));
    expect(rankFollowUp).toBeTruthy();
  });

  it("handles bearish direction", () => {
    expect(initialPrompt(makeResolution({ direction: "bearish" }))).toContain("bearish");
  });

  it("follow-up prompt includes delta floor", () => {
    const followUp = followUpPrompt();
    expect(followUp).toContain("0.20");
  });

  it("follow-up prompt preserves full Greeks in the final ranking table", () => {
    const followUp = followUpPrompt();
    expect(followUp).toContain("gamma");
    expect(followUp).toContain("theta");
    expect(followUp).toContain("vega");
    expect(followUp).toContain("rho");
  });

  it("follow-up prompt requires plain-language horizon context without a fixed answer phrase", () => {
    const followUp = followUpPrompt(makeResolution({ dteTarget: "25_to_45_days" }));

    expect(followUp).toContain("State the requested option horizon in plain language");
    expect(followUp).toContain("25-45 day target");
    expect(followUp).not.toContain("literal phrase");
  });

  it("follow-up prompt preserves max premium caps", () => {
    const followUp = followUpPrompt(makeResolution({ maxPremium: 500 }));
    expect(followUp).toContain("Do not rank contracts above the user's max premium of $500");
  });

  it("follow-up prompt includes length constraints", () => {
    const followUp = followUpPrompt();
    expect(followUp).toContain("30 lines");
  });

  // Regression test for a live-run failure where get_option_chain returned
  // "⚠ Options chain unavailable for SPY (fetch failed)" for some expirations
  // and the LLM ended the turn with empty text (no Assumptions block, no
  // narrative). The rank_and_present step now explicitly instructs the model
  // to always produce a text response and to degrade gracefully on partial
  // fetch failure — matching the "continue with remaining tools and label
  // unavailable metrics" rule in src/prompts/context-builder.ts SAFETY_RULES.
  it("follow-up prompt instructs graceful degradation on partial fetch failure", () => {
    const followUp = followUpPrompt();
    // Must explicitly forbid ending the turn with only tool calls.
    expect(followUp.toLowerCase()).toContain("never end this turn with only tool calls");
    // Must reference the unavailable sentinel shape so the LLM maps the
    // tool-result text to the degrade-gracefully branch.
    expect(followUp).toContain("Options chain unavailable");
    // Must tell the LLM to still produce a text response in the no-data case.
    expect(followUp.toLowerCase()).toContain("still produce a text response");
  });

  it("follow-up prompt requires actionable guidance when no chain data is usable", () => {
    const followUp = followUpPrompt(
      makeResolution({ symbol: "MSFT", dteTarget: "7_to_14_days", optionStrategy: "covered_call" }),
    );

    expect(followUp.toLowerCase()).toContain("do not promise to retry later");
    expect(followUp.toLowerCase()).toContain("how to evaluate covered calls");
    expect(followUp.toLowerCase()).toContain("return-if-assigned");
    expect(followUp).toContain("7_to_14_days");
  });

  it("follow-up prompt prevents long-option max-loss framing for covered calls", () => {
    const followUp = followUpPrompt(
      makeResolution({ optionStrategy: "covered_call", costBasis: 123.45 }),
    );

    expect(followUp.toLowerCase()).toContain("do not say max loss = premium");
    expect(followUp.toLowerCase()).toContain("covered call");
    expect(followUp.toLowerCase()).toContain("upside is capped");
    expect(followUp.toLowerCase()).toContain("premium received");
    expect(followUp.toLowerCase()).toContain("return-if-assigned");
  });

  it("follow-up prompt gives a covered-call fallback when quotes are unusable", () => {
    const followUp = followUpPrompt(
      makeResolution({
        symbol: "DRAM",
        costBasis: 51,
        catalystSymbols: ["NVDA"],
        dteTarget: "0_to_7_days",
      }),
    );

    expect(followUp).toContain("zero bid/ask");
    expect(followUp.toLowerCase()).toContain("covered-call fallback");
    expect(followUp).toContain("cost basis");
    expect(followUp).toContain("catalyst");
    expect(followUp).toContain("conditional limit");
    expect(followUp).toContain("Best action:");
    expect(followUp).toContain("Conditional candidate:");
    expect(followUp).toContain("Do NOT conclude");
    expect(followUp).toContain("overrides the normal ranking/table requirements");
    expect(followUp).toContain("premium: use live broker bid/ask");
    expect(followUp).toContain(
      "Treat this as selling covered calls against an existing DRAM share position",
    );
    expect(followUp).toContain("premium collected");
    expect(followUp).toContain("Do not describe max loss as the option premium paid");
    expect(followUp).toContain("Reproduce the exact Assumptions block");
    expect(followUp).toContain('do not shorten it to "Assumptions:"');
    expect(followUp).toContain("Risk section: max 3 bullets");
    expect(followUp).toContain("closed_market_or_stale_quotes");
    expect(followUp).toContain("recheck after regular options trading opens");
    expect(followUp).toContain("treating DRAM as the held ticker");
    expect(followUp).toContain("If they meant memory exposure or a different ticker");
    expect(followUp).toContain("Interpretation:");
    expect(followUp).toContain("If you meant DRAM as memory exposure or another ticker");
    expect(followUp).toContain("effective assignment sale price");
    expect(followUp).toContain("compare it with the $51 cost basis");
    expect(followUp).toContain("Verify bid/ask and open interest in the user's broker");
  });

  it("follow-up prompt ranks protective puts as hedges instead of calls", () => {
    const followUp = followUpPrompt(
      makeResolution({
        symbol: "NVDA",
        direction: "bearish",
        optionStrategy: "protective_put",
        shareQuantity: 200,
        dteTarget: "30_to_45_days",
      }),
    );

    expect(followUp).toContain("top puts for NVDA");
    expect(followUp).toContain("Protective-put requirements");
    expect(followUp).toContain("hedge floor");
    expect(followUp).toContain("premium as a percent of position value");
    expect(followUp).toContain("1 put contract per 100 shares");
    expect(followUp).toContain("total premium for the required number of contracts");
    expect(followUp).toContain("collars or put spreads");
    expect(followUp).toContain("Do not frame assignment risk like a short option sale");
  });

  it("follow-up prompt does not mix covered-call fallback into catalyst-driven protective puts", () => {
    const followUp = followUpPrompt(
      makeResolution({
        symbol: "AMD",
        direction: "bearish",
        optionStrategy: "protective_put",
        shareQuantity: 200,
        catalystSymbols: ["NVDA"],
        dteTarget: "25_to_45_days",
      }),
    );

    expect(followUp).toContain("top puts for AMD");
    expect(followUp).toContain("Protective-put requirements");
    expect(followUp).toContain("buying puts to hedge an existing long AMD share position");
    expect(followUp).not.toContain("Covered-call fallback");
    expect(followUp).not.toContain("premium collected");
    expect(followUp).not.toContain("return-if-assigned");
  });
});
