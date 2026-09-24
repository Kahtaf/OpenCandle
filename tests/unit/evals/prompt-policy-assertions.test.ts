import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluateFinalAnswerAssertion } from "../../evals/prompt-policy-assertions.js";
import type { EvalTrace } from "../../evals/types.js";

describe("prompt-policy final answer assertions", () => {
  it("fails unregistered hard assertions instead of treating them as passing evidence", () => {
    const result = evaluateFinalAnswerAssertion(
      "mentions net interest margin sensitivity",
      trace("Bottom line: rates matter."),
    );

    expect(result.passed).toBe(false);
    expect(result.reason).toContain("No deterministic checker registered");
  });

  it("registers deterministic checkers for every migration-manifest hard assertion", () => {
    const manifest = JSON.parse(
      readFileSync("docs/internal/prompt-to-policy-migration-manifest.json", "utf-8"),
    ) as {
      prompts: Array<{ expected: { finalAnswerHardAssertions?: string[] } }>;
    };
    const unregistered: string[] = [];
    const nonDeterministic: string[] = [];
    for (const prompt of manifest.prompts) {
      for (const assertion of prompt.expected.finalAnswerHardAssertions ?? []) {
        const result = evaluateFinalAnswerAssertion(assertion, trace(""));
        if (result.reason.startsWith("No deterministic checker")) unregistered.push(assertion);
        if (!result.deterministic) nonDeterministic.push(assertion);
      }
    }

    expect(unregistered).toEqual([]);
    expect(nonDeterministic).toEqual([]);
  });

  it("checks portfolio-construction routing without broad budget-text matching", () => {
    const result = evaluateFinalAnswerAssertion(
      "does not route as portfolio construction requiring a budget",
      trace(
        "Budget can be relevant after this comparison, but this is not a construction request.",
        "compare_assets",
      ),
    );

    expect(result.passed).toBe(true);
  });

  it("accepts ask_user ticker clarification for ambiguous ticker lookup assertions", () => {
    const result = evaluateFinalAnswerAssertion(
      "states the ticker could not be verified if lookup fails",
      {
        ...trace("Which company or ticker did you mean by ZZZZ?"),
        askUserTranscript: [
          { question: "Which company or ticker did you mean by ZZZZ?", answer: null },
        ],
      },
    );

    expect(result.passed).toBe(true);
  });

  it("does not treat unrelated ask_user prompts as ticker clarification", () => {
    const result = evaluateFinalAnswerAssertion(
      "states the ticker could not be verified if lookup fails",
      {
        ...trace("What is your portfolio budget?"),
        askUserTranscript: [{ question: "What is your portfolio budget?", answer: null }],
      },
    );

    expect(result.passed).toBe(false);
  });

  it("accepts explicit invalid-symbol disclosures that request the correct ticker", () => {
    const result = evaluateFinalAnswerAssertion(
      "states the ticker could not be verified if lookup fails",
      trace("ZZZZ appears to be an invalid symbol. Please provide the correct ticker."),
    );

    expect(result.passed).toBe(true);
  });

  it("accepts a verified non-company instrument that invalidates the earnings premise", () => {
    const result = evaluateFinalAnswerAssertion(
      "states the ticker could not be verified if lookup fails",
      trace(
        "ZZZZ resolves to a mutual fund, not an operating company, so the premise that it reports earnings tonight is invalid.",
      ),
    );

    expect(result.passed).toBe(true);
  });

  it("recognizes numeric DTE evidence inside the requested one-to-two-week window", () => {
    const result = evaluateFinalAnswerAssertion(
      "preserves requested 1-2 week DTE",
      trace("The available expirations are August 21 (8 DTE) and August 28 (15 DTE)."),
    );

    expect(result.passed).toBe(true);
  });

  it("recognizes a spelled-out seven-to-fourteen-day DTE window", () => {
    const result = evaluateFinalAnswerAssertion(
      "preserves requested 1-2 week DTE",
      trace("The DTE target is 7 to 14 days, and this expiry has 8 days to expiration."),
    );

    expect(result.passed).toBe(true);
  });

  it("recognizes a leading structural allocation read as a bottom-line portfolio read", () => {
    const result = evaluateFinalAnswerAssertion(
      "starts with a bottom-line structural portfolio read",
      trace(
        "Structural Allocation Read\nThe traditional 60/40 portfolio faces a challenging risk environment.",
      ),
    );

    expect(result.passed).toBe(true);
  });

  it("recognizes a leading portfolio outlook paragraph as the bottom-line read", () => {
    const result = evaluateFinalAnswerAssertion(
      "starts with a bottom-line structural portfolio read",
      trace(
        "The 60/40 portfolio faces a dynamic environment over the next year. Our read suggests moderate returns with higher volatility.",
      ),
    );

    expect(result.passed).toBe(true);
  });

  it("recognizes a brief evaluation lead-in followed by the structural portfolio read", () => {
    const result = evaluateFinalAnswerAssertion(
      "starts with a bottom-line structural portfolio read",
      trace(
        "Here is a critical evaluation of a 60/40 portfolio for the next year.\n\n### Structural Allocation Read\nThe allocation faces inflation and volatility risk.",
      ),
    );

    expect(result.passed).toBe(true);
  });

  it("recognizes an opening analyst commitment as a structural portfolio read", () => {
    const result = evaluateFinalAnswerAssertion(
      "starts with a bottom-line structural portfolio read",
      trace(
        "Analyst View: The 60/40 portfolio is likely to deliver modest returns with elevated volatility over the next year.\n\nCommitment: Keep the allocation, but expect a challenging risk environment.",
      ),
    );

    expect(result.passed).toBe(true);
  });

  const hedgeSizingAssertion =
    "sizes hedge from 450 shares into 4 puts plus residual 50 shares or explicitly explains rounding";

  // Faithful excerpt of the observed live answer that the pre-fix keyword checker passed.
  const observedLiveHedgeAnswer = [
    "To protect your 450 shares of AAPL for the next month, you should consider purchasing **5 put option contracts**. Each standard option contract covers 100 shares, so 5 contracts would provide protection for 500 shares, effectively covering your 450 shares.",
    "",
    "### Tradeoffs to Consider:",
    "",
    "1.  **Cost (Premium)**: Buying 5 contracts would cost **$5,000**.",
    "2.  **Strike Price Selection**: A $340 strike put is more expensive.",
    "3.  **Time Decay (Theta)**: The put loses value each day.",
    "4.  **Implied Volatility (IV)**: High IV makes options more expensive.",
    "5.  **Delta**: The put gains $0.427 per share for each $1 drop.",
    "6.  **Breakeven Point**: The effective floor is strike minus premium.",
    "",
    "### Commitment:",
    "An analyst would suggest buying **5 put option contracts with the 2026-10-30 expiration**.",
  ].join("\n");

  // Faithful excerpt of the focused live probe answer
  // (tests/evals/runs/2026-09-24T22-24-44-070Z_competitive-finance.json results[0]).
  // It states the floor mechanics semantically ("protected from falling below
  // the strike minus the premium") without using the literal word "floor".
  const liveProbeHedgeAnswer = [
    "To protect your 450 shares of AAPL against downside risk through the next month, you should consider purchasing **4 or 5 put options contracts** expiring on October 23, 2026. Each standard option contract controls 100 shares.",
    "",
    "*   **4 Contracts:** This would cover 400 of your 450 shares, leaving 50 shares (11%) exposed to downside risk below the chosen strike price.",
    "*   **5 Contracts:** This would cover all 450 of your shares, plus an additional 50 shares, increasing your total premium cost.",
    "",
    "**Key Tradeoffs:**",
    "1.  **Premium Cost (The Cost of Protection):** Puts closer to the current price cost more; the premium is a sunk cost.",
    "2.  **Protection Level:** A put with a strike of $335 means your shares are protected from falling below $335 (minus the premium paid) by the expiration date.",
    "3.  **Time Decay (Theta):** Options lose value as they get closer to expiration.",
    "4.  **Implied Volatility (Vega):** Higher implied volatility means higher option premiums.",
    "5.  **Liquidity:** A wide bid-ask spread or low open interest can make it harder to enter or exit at a fair price.",
    "",
    "**Analyst View:** For a balance of cost and protection, buying 4 contracts of the $330 strike puts would provide protection for 400 shares.",
    "**Commitment:** purchasing 4 to 5 put option contracts at a strike between $330 and $335 offers a reasonable balance of cost and protection for your 450 shares.",
    "**Confidence Band:** Moderate conviction. This is a standard protective put strategy.",
  ].join("\n");

  it("rejects the observed live 5-contract answer that never explains the 50-share excess", () => {
    const result = evaluateFinalAnswerAssertion(
      hedgeSizingAssertion,
      trace(observedLiveHedgeAnswer),
    );

    expect(result.passed).toBe(false);
    expect(result.deterministic).toBe(true);
  });

  it("rejects a 5-contract answer that only claims to cover 500 shares with no excess tradeoff", () => {
    const result = evaluateFinalAnswerAssertion(
      hedgeSizingAssertion,
      trace("Buy 5 put contracts. They cover 500 shares, which fully protects your 450 shares."),
    );

    expect(result.passed).toBe(false);
  });

  it("ignores a numbered-list 4 and 450/500 substrings when no put quantity is stated", () => {
    const result = evaluateFinalAnswerAssertion(
      hedgeSizingAssertion,
      trace("1. Cost\n2. Strike\n3. Theta\n4. Volatility\n450 shares trade near $500."),
    );

    expect(result.passed).toBe(false);
  });

  it("rejects unrelated strikes and premiums that merely contain the digits", () => {
    const result = evaluateFinalAnswerAssertion(
      hedgeSizingAssertion,
      trace("You own 450 shares. 4. Strike selection: the $450 strike costs about $50 in premium."),
    );

    expect(result.passed).toBe(false);
  });

  it("rejects contradictory 4-put residual and unexplained 5-contract recommendations", () => {
    const result = evaluateFinalAnswerAssertion(
      hedgeSizingAssertion,
      trace(
        "You own 450 shares. Buy 4 puts and leave the residual 50 shares unhedged. Commitment: buy 5 contracts.",
      ),
    );

    expect(result.passed).toBe(false);
  });

  it("rejects unit confusion where 50 refers to delta or premium rather than shares", () => {
    const result = evaluateFinalAnswerAssertion(
      hedgeSizingAssertion,
      trace(
        "You own 450 shares. Buy 4 puts. The position delta is 50 and the premium is $50 per contract.",
      ),
    );

    expect(result.passed).toBe(false);
  });

  it("rejects a call-contract quantity as a downside put hedge", () => {
    const result = evaluateFinalAnswerAssertion(
      hedgeSizingAssertion,
      trace("You own 450 shares; buy 4 call contracts and leave 50 shares unhedged."),
    );

    expect(result.passed).toBe(false);
  });

  it("rejects a generic options quantity as a downside put hedge", () => {
    const result = evaluateFinalAnswerAssertion(
      hedgeSizingAssertion,
      trace("You own 450 shares; buy 4 options, leaving 50 shares unhedged."),
    );

    expect(result.passed).toBe(false);
  });

  it("rejects bare rounding language as a substitute for a 50-share excess explanation", () => {
    const result = evaluateFinalAnswerAssertion(
      hedgeSizingAssertion,
      trace("You own 450 shares. Round to 5 contracts leaving 50 shares unhedged."),
    );

    expect(result.passed).toBe(false);
  });

  it("rejects a different share position that merely contains the digits", () => {
    const result = evaluateFinalAnswerAssertion(
      hedgeSizingAssertion,
      trace("You own 300 shares; buy 4 puts and leave 50 shares unhedged."),
    );

    expect(result.passed).toBe(false);
  });

  it("accepts four puts plus an explicit 50-share residual for the owned 450 shares (digits)", () => {
    const result = evaluateFinalAnswerAssertion(
      hedgeSizingAssertion,
      trace(
        "You own 450 shares. Buy 4 puts to cover 400 shares, leaving a residual 50 shares unhedged.",
      ),
    );

    expect(result.passed).toBe(true);
  });

  it("accepts four puts plus an explicit fifty-share residual (words)", () => {
    const result = evaluateFinalAnswerAssertion(
      hedgeSizingAssertion,
      trace("You own four hundred fifty shares; buy four puts; fifty shares remain unhedged."),
    );

    expect(result.passed).toBe(true);
  });

  it("accepts rounding up to five contracts with an explicit 50-share overhedge (digits)", () => {
    const result = evaluateFinalAnswerAssertion(
      hedgeSizingAssertion,
      trace(
        "450 shares / 100 = 4.5 contracts, so round up to 5 put contracts covering 500 shares: a 50-share excess over your position.",
      ),
    );

    expect(result.passed).toBe(true);
  });

  it("accepts rounding up to five contracts with an explicit fifty-share excess (words)", () => {
    const result = evaluateFinalAnswerAssertion(
      hedgeSizingAssertion,
      trace(
        "You own 450 shares. Half contracts are not available, so round up to five contracts, an extra fifty shares of protection.",
      ),
    );

    expect(result.passed).toBe(true);
  });

  it("accepts Markdown-bold put quantities with a 50-share residual (digits)", () => {
    const result = evaluateFinalAnswerAssertion(
      hedgeSizingAssertion,
      trace("450 shares: buy **4** put contracts; 50 shares remain unhedged."),
    );

    expect(result.passed).toBe(true);
  });

  it("accepts Markdown-bold put quantities with an explicit 50-share excess (digits)", () => {
    const result = evaluateFinalAnswerAssertion(
      hedgeSizingAssertion,
      trace("You own 450 shares. **5** puts with 50 excess shares."),
    );

    expect(result.passed).toBe(true);
  });

  it("does not treat a word starting with put as a put option unit", () => {
    const result = evaluateFinalAnswerAssertion(
      hedgeSizingAssertion,
      trace("You own 450 shares; 4 putative contracts leave 50 shares unhedged."),
    );

    expect(result.passed).toBe(false);
  });

  it("keeps the hedge-risk assertion failing when liquidity disclosure is missing", () => {
    const result = evaluateFinalAnswerAssertion(
      "frames hedge floor, premium, Greeks, liquidity, and protective-put risks",
      trace(observedLiveHedgeAnswer),
    );

    expect(result.passed).toBe(false);
    expect(result.reason).toContain("liquidity");
  });

  it("accepts the live probe answer's semantic downside-protection floor without the literal word floor", () => {
    const result = evaluateFinalAnswerAssertion(
      "frames hedge floor, premium, Greeks, liquidity, and protective-put risks",
      trace(liveProbeHedgeAnswer),
    );

    expect(result.passed).toBe(true);
  });

  it("rejects a hedge-risk answer that omits downside-protection floor mechanics", () => {
    const result = evaluateFinalAnswerAssertion(
      "frames hedge floor, premium, Greeks, liquidity, and protective-put risks",
      trace(
        "The premium is the cost of the puts, theta erodes them, liquidity and bid-ask spreads matter, and the main risk is capped upside.",
      ),
    );

    expect(result.passed).toBe(false);
  });

  it("passes the hedge-risk assertion only with explicit liquidity and protective-put risk", () => {
    const result = evaluateFinalAnswerAssertion(
      "frames hedge floor, premium, Greeks, liquidity, and protective-put risks",
      trace(
        "The hedge floor is strike minus premium; check theta and delta; liquidity and bid/ask spreads matter; protective-put risk includes paying premium for capped upside.",
      ),
    );

    expect(result.passed).toBe(true);
  });
});

function trace(text: string, workflow = "general_finance_qa"): EvalTrace {
  return {
    prompt: "test prompt",
    classification: {
      workflow,
      confidence: 0.9,
      tier: "llm",
      entities: { symbols: [] },
    },
    router: { workflow },
    toolCalls: [],
    askUserTranscript: [],
    text,
  };
}
