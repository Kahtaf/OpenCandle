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
      {
        ...trace(
          "ZZZZ resolves to a mutual fund, not an operating company, so the premise that it reports earnings tonight is invalid.",
        ),
        prompt:
          "I hold 300 shares of ZZZZ and earnings are tonight. Should I trim, hedge, or hold through it?",
      },
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

  describe("educational section shape", () => {
    const assertion = "uses bottom line, practical workflow, and quick checklist sections";

    it("accepts a hyphenated bold bottom-line section", () => {
      const result = evaluateFinalAnswerAssertion(
        assertion,
        trace(
          "**Bottom-line:** P/E is a starting point.\n\n### Practical workflow\nSteps.\n\n### Quick checklist\n- Item",
        ),
      );

      expect(result.passed).toBe(true);
    });

    it("still requires every educational section", () => {
      const result = evaluateFinalAnswerAssertion(
        assertion,
        trace("**Bottom-line:** P/E is a starting point.\n\n### Practical workflow\nSteps."),
      );

      expect(result.passed).toBe(false);
    });
  });

  describe("bottom-line structural portfolio read contract", () => {
    const assertion = "starts with a bottom-line structural portfolio read";

    // Faithful excerpt of the 478d3515 canonical-run answer (frozen-portfolio-review-not-builder)
    // that the keyword checker failed because it only matched the unhyphenated "bottom line".
    const hyphenatedHeadingOpening =
      "Here is our critical evaluation of a 60/40 portfolio for the next year.\n\n**Bottom-Line Structural Read**\n\nA 60/40 portfolio, comprised of 60% equities and 40% fixed income, offers a historically balanced approach designed for growth with a moderating influence from bonds. For the next year, its performance will hinge on the interplay between inflation, interest rate policy, and corporate earnings growth.\n\n**Sleeve-by-Sleeve Implications (Next 12 Months)**\n\n* Equity sleeve risks: valuations remain sensitive to rates.";

    it.each([
      [
        "a lead-in sentence followed by a hyphenated bold bottom-line heading",
        hyphenatedHeadingOpening,
      ],
      [
        "a markdown BLUF heading",
        "## BLUF\nThe 60/40 portfolio carries more duration and equity-valuation risk than its label implies.\n\n## Sleeves\nDetail.",
      ],
      [
        "an inline verdict on the allocation",
        "Verdict: this allocation is reasonably diversified but concentrated in US large-cap equity risk.\n\nDetails follow.",
      ],
      [
        "an opening structural read with no explicit marker",
        "The 60/40 portfolio is structurally exposed to a joint stock-bond drawdown if inflation re-accelerates.\n\n### Sleeves\nDetail.",
      ],
      [
        "a read that explicitly declines to build a new portfolio",
        "Rather than building a new portfolio, the bottom line on this 60/40 allocation is that its bond sleeve now pulls its weight.\n\nDetail.",
      ],
    ])("passes %s", (_label, text) => {
      expect(evaluateFinalAnswerAssertion(assertion, trace(text)).passed).toBe(true);
    });

    it.each([
      [
        "an opening builder allocation",
        "Here is a portfolio you could build: allocate 40% to a total US stock fund, 20% to international stocks, and 40% to bonds.\n\n**Bottom line**: this portfolio balances risk and reward.",
      ],
      [
        "an opening budget question",
        "How much do you plan to invest in this portfolio?\n\n**Bottom line**: the portfolio risk depends on your budget.",
      ],
      [
        "a bottom line that only appears at the end",
        "Markets have been through a volatile stretch as central banks wrestled with inflation and growth slowed across several regions.\n\n### Equities\nEarnings held up better than expected.\n\n### Bonds\nYields rose sharply.\n\n**Bottom line**: the 60/40 portfolio faces elevated risk next year.",
      ],
      [
        "a negated bottom line",
        "There is no bottom line here without more data.\n\nThe 60/40 portfolio details follow later.",
      ],
      ["an empty answer", ""],
    ])("fails %s", (_label, text) => {
      expect(evaluateFinalAnswerAssertion(assertion, trace(text)).passed).toBe(false);
    });

    it("applies the same contract to the macro risk/reward variant", () => {
      expect(
        evaluateFinalAnswerAssertion(
          "starts with a bottom-line portfolio risk/reward read",
          trace(hyphenatedHeadingOpening),
        ).passed,
      ).toBe(true);
    });
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

  // Faithful excerpt of the 2026-09-25T00:39 live frozen answer
  // (tests/evals/runs/2026-09-25T00-39-03-515Z_competitive-finance.json results[4]).
  // The floor checker keys on its protective-put wording: "The strike price is
  // the level at which you can sell your shares if the price drops." That is a
  // strike-level sell right, not a generic sell level, and is accepted without
  // a benchmark-specific literal.
  const liveFrozenHedgeAnswer = [
    "To provide downside protection for your 450 shares of AAPL through October 30, 2026, you should consider purchasing **4 or 5 put option contracts** with an expiration of **2026-10-30**.",
    "",
    "2. **Protection Level (Strike Price):** The strike price is the level at which you can sell your shares if the price drops.",
    "* Choosing a higher strike price (closer to the current stock price, e.g., $335) provides more protection as your maximum loss is capped closer to the current price. However, it also costs more.",
    "* Choosing a lower strike price (further out of the money, e.g., $325 or $330) provides less protection (you'd incur a larger loss before the put kicks in) but is cheaper.",
    "",
    "1. **Cost (Premium):** This is the price you pay for the protection.",
    "3. **Time Decay (Theta):** Options lose value as they approach expiration.",
    "* **Liquidity (Volume & Open Interest):** Higher volume and open interest generally indicate more liquid options, so be mindful of slippage and risk.",
  ].join("\n");

  it("accepts the live frozen hedge answer's strike-level sell right without the literal word floor", () => {
    const result = evaluateFinalAnswerAssertion(
      "frames hedge floor, premium, Greeks, liquidity, and protective-put risks",
      trace(liveFrozenHedgeAnswer),
    );

    expect(result.passed).toBe(true);
  });

  it("accepts a covered-share put sell right on an unrelated symbol and quantity", () => {
    const result = evaluateFinalAnswerAssertion(
      "frames hedge floor, premium, Greeks, liquidity, and protective-put risks",
      trace(
        "For the covered 300 MSFT shares, the put gives the right to sell at the strike when the underlying falls below it; the premium reduces net proceeds, theta decays the protection, liquidity affects execution, and the residual shares remain exposed to downside risk.",
      ),
    );

    expect(result.passed).toBe(true);
  });

  it("rejects a stop-loss level that is not a protective-put strike right", () => {
    const result = evaluateFinalAnswerAssertion(
      "frames hedge floor, premium, Greeks, liquidity, and protective-put risks",
      trace(
        "Set a stop-loss at the level at which you sell your shares; the premium, theta, liquidity, and risk matter.",
      ),
    );

    expect(result.passed).toBe(false);
  });

  it("rejects a capped-loss claim with no put strike or protection mechanism", () => {
    const result = evaluateFinalAnswerAssertion(
      "frames hedge floor, premium, Greeks, liquidity, and protective-put risks",
      trace(
        "Your maximum loss is capped closer to the current price; premium, theta, liquidity, and risk matter.",
      ),
    );

    expect(result.passed).toBe(false);
  });

  it("rejects put-premium-only wording that never ties the floor to the strike", () => {
    const result = evaluateFinalAnswerAssertion(
      "frames hedge floor, premium, Greeks, liquidity, and protective-put risks",
      trace(
        "The put costs a premium; theta and liquidity matter, and the loss is limited to the premium paid, so risk is contained.",
      ),
    );

    expect(result.passed).toBe(false);
  });

  it("rejects a protection claim with no strike trigger", () => {
    const result = evaluateFinalAnswerAssertion(
      "frames hedge floor, premium, Greeks, liquidity, and protective-put risks",
      trace(
        "The puts protect your position from losses; premium, theta, liquidity, and risk matter.",
      ),
    );

    expect(result.passed).toBe(false);
  });

  it("rejects an unsupported blanket all-shares protection claim", () => {
    const result = evaluateFinalAnswerAssertion(
      "frames hedge floor, premium, Greeks, liquidity, and protective-put risks",
      trace(
        "These puts protect all 450 shares from any loss; premium, theta, liquidity, and risk matter.",
      ),
    );

    expect(result.passed).toBe(false);
  });

  it("rejects a hedge answer that names a floor level but omits the premium cost", () => {
    const result = evaluateFinalAnswerAssertion(
      "frames hedge floor, premium, Greeks, liquidity, and protective-put risks",
      trace("The strike is the level at which you can sell; theta and liquidity matter."),
    );

    expect(result.passed).toBe(false);
    expect(result.reason).toContain("premium");
  });

  // Faithful excerpt of the preserved 2026-09-25T03-58-04-569Z competitive-finance
  // trace (results[0].openCandleTrace.text). It explains the put premium as the
  // maximum loss, the 50 unprotected shares, potential downside, time decay, and
  // liquidity slippage without ever using the word "risk".
  const preservedLiveHedgeAnswer = [
    "To protect your 450 shares of AAPL for the next month, you should consider buying **5 put option contracts** with the **2026-10-30 expiration**.",
    "",
    "**4 Contracts:** Would cover 400 shares, leaving 50 shares (approximately 11% of your holdings) unprotected. This would result in a lower premium cost.",
    "",
    "**Higher Strike:** They provide immediate protection closer to the current market price, limiting your potential downside from the current level.",
    "",
    "Per-share hedge floor for covered shares: $335 (strike) - $9.75 (premium per share) = $325.25.",
    "Max loss for the *put leg itself*: $4,875 (the premium paid).",
    "",
    "**Premium Cost:** The price you pay for the put option is the maximum you can lose on the option contract if AAPL's price does not fall below your chosen strike by expiration.",
    "",
    "**Time Decay (Theta):** Options lose value as they approach expiration; the $335 strike put has a Theta of -0.123.",
    "",
    "**Liquidity:** The bid/ask spreads can be wide, making it more challenging to enter or exit positions at favorable prices.",
  ].join("\n");

  it("accepts the preserved live hedge answer that explains loss, downside, and decay without the word risk", () => {
    const result = evaluateFinalAnswerAssertion(
      "frames hedge floor, premium, Greeks, liquidity, and protective-put risks",
      trace(preservedLiveHedgeAnswer),
    );

    expect(result.passed).toBe(true);
  });

  it("accepts a hazard explanation on an independent ticker and quantity without the word risk", () => {
    const result = evaluateFinalAnswerAssertion(
      "frames hedge floor, premium, Greeks, liquidity, and protective-put risks",
      trace(
        "For the covered 300 MSFT shares, the put gives the right to sell at the $250 strike; the maximum loss on the put is the premium paid, the 100 remaining shares stay unprotected, theta erodes the option's time value as expiry nears, and the wide bid-ask spread adds liquidity slippage.",
      ),
    );

    expect(result.passed).toBe(true);
  });

  it("rejects floor mechanics with 'fall season' but no actual put hazard", () => {
    const result = evaluateFinalAnswerAssertion(
      "frames hedge floor, premium, Greeks, liquidity, and protective-put risks",
      trace(
        "The downside protection begins at the $350 strike; the premium, delta, and theta are quoted; liquidity is fine; fall season can affect trading volume.",
      ),
    );

    expect(result.passed).toBe(false);
    expect(result.reason).toContain("hazard");
  });

  it("rejects a protection-only sentence where the put caps losses at the strike", () => {
    const result = evaluateFinalAnswerAssertion(
      "frames hedge floor, premium, Greeks, liquidity, and protective-put risks",
      trace("The put caps your losses at the strike; premium, delta, and liquidity are quoted."),
    );

    expect(result.passed).toBe(false);
    expect(result.reason).toContain("hazard");
  });

  it("rejects a protection-only maximum-loss sentence that names no put hazard", () => {
    const result = evaluateFinalAnswerAssertion(
      "frames hedge floor, premium, Greeks, liquidity, and protective-put risks",
      trace(
        "The put's downside protection begins at the $350 strike and limits your maximum loss at the strike; premium, delta, and liquidity are quoted.",
      ),
    );

    expect(result.passed).toBe(false);
    expect(result.reason).toContain("hazard");
  });
});

// Frozen competitive panel mandatory assertions (#204 phase 1). Each touched
// assertion has a positive control, a negated or echoed negative control, and
// the exact false-pass/false-fail probe strings from the issue.
describe("frozen competitive panel assertions are negation and echo aware", () => {
  const ZZZZ_PROMPT =
    "I hold 300 shares of ZZZZ and earnings are tonight. Should I trim, hedge, or hold through it?";
  const AMD_PROMPT =
    "NVDA earnings are today. I own 200 shares of AMD. What protective put should I buy for the next month?";
  const DRAM_PROMPT =
    "I own 100 shares of DRAM at a $51 cost basis. NVDA earnings are today, but I want a covered call 1-2 weeks out. What strike and expiry should I look at?";
  const REVIEW_PROMPT =
    "Critically evaluate a 60/40 portfolio for the next year. Do not build a new portfolio; just review the existing allocation.";

  const check = (assertion: string, text: string, extra: Partial<EvalTrace> = {}) =>
    evaluateFinalAnswerAssertion(assertion, { ...trace(text), ...extra }).passed;

  describe("does not invent current earnings facts", () => {
    const assertion = "does not invent current earnings facts";

    it("fails the confirmed false pass: a disclosure word does not excuse fabricated figures", () => {
      expect(
        check(
          assertion,
          "ZZZZ could not be verified. Consensus EPS of 2.15 and revenue of 480 million are expected tonight.",
          { prompt: ZZZZ_PROMPT },
        ),
      ).toBe(false);
    });

    it("fails ungrounded reported earnings figures with no disclosure", () => {
      expect(
        check(assertion, "EPS came in at $1.05 versus consensus of $0.98.", {
          prompt: ZZZZ_PROMPT,
        }),
      ).toBe(false);
    });

    it("passes an unverified-ticker answer that states no earnings figures", () => {
      expect(
        check(
          assertion,
          "ZZZZ could not be verified, so I have no current EPS, revenue, or guidance figures for it.",
          { prompt: ZZZZ_PROMPT },
        ),
      ).toBe(true);
    });

    it("passes earnings figures grounded in tool output", () => {
      expect(
        check(assertion, "Consensus EPS of 2.15 and revenue of 480 million are expected tonight.", {
          prompt: ZZZZ_PROMPT,
          toolCalls: [
            {
              name: "get_earnings",
              args: { symbol: "ZZZZ" },
              result: { consensusEps: 2.15, revenueEstimate: "480 million" },
            },
          ],
        }),
      ).toBe(true);
    });

    it("fails a prompt number reused as an earnings figure with a different unit", () => {
      expect(check(assertion, "Consensus revenue is $300 million.", { prompt: ZZZZ_PROMPT })).toBe(
        false,
      );
    });

    it("scopes the hypothetical exemption to the hypothetical clause", () => {
      expect(
        check(assertion, "Consensus EPS is 2.15, but if guidance disappoints the stock may fall.", {
          prompt: ZZZZ_PROMPT,
        }),
      ).toBe(false);
    });

    it("does not ground a figure on date components in tool output", () => {
      expect(
        check(assertion, "Revenue grew 26% last quarter.", {
          prompt: ZZZZ_PROMPT,
          toolCalls: [
            {
              name: "get_stock_quote",
              args: { symbol: "ZZZZ" },
              result: { error: "Not Found", asOf: "2026-09-26T02:07:45Z" },
            },
          ],
        }),
      ).toBe(false);
    });

    it("fails an ungrounded earnings-per-share figure stated as earnings", () => {
      expect(
        check(assertion, "ZZZZ earnings came in at $1.20 a share last quarter.", {
          prompt: ZZZZ_PROMPT,
        }),
      ).toBe(false);
    });

    it.each([
      "If EPS comes in at 2.15, the stock could rise.",
      "Suppose guidance is cut, revenue of 480 million would still cover the dividend.",
    ])("passes a hypothetical whose cue governs the figure: %s", (text) => {
      expect(check(assertion, text, { prompt: ZZZZ_PROMPT })).toBe(true);
    });

    const quote = (result: Record<string, unknown>) => ({
      name: "get_stock_quote",
      args: { symbol: "ZZZZ" },
      result,
    });
    const earnings = (result: Record<string, unknown>) => ({
      name: "get_earnings",
      args: { symbol: "ZZZZ" },
      result,
    });

    it("fails a labeled figure whose value appears only under an unrelated tool field", () => {
      expect(
        check(assertion, "Consensus revenue is $300 million.", {
          prompt: ZZZZ_PROMPT,
          toolCalls: [quote({ details: { symbol: "ZZZZ", price: 300 } })],
        }),
      ).toBe(false);
      expect(
        check(assertion, "EPS was 480 last quarter.", {
          prompt: ZZZZ_PROMPT,
          toolCalls: [earnings({ details: { revenueEstimate: 480 } })],
        }),
      ).toBe(false);
    });

    it("grounds a labeled figure in a matching metric field, tolerating rounding and units", () => {
      expect(
        check(assertion, "EPS came in at $2.15 and revenue was $94.9 billion.", {
          prompt: ZZZZ_PROMPT,
          toolCalls: [
            earnings({
              details: { quarterly: [{ reportedEPS: 2.1534, estimatedEPS: 2.1 }] },
            }),
            {
              name: "get_financials",
              args: { symbol: "ZZZZ" },
              result: { details: { revenue: 94_930_000_000 } },
            },
          ],
        }),
      ).toBe(true);
      expect(
        check(assertion, "EPS is $6.08.", {
          prompt: ZZZZ_PROMPT,
          toolCalls: [
            {
              name: "get_company_overview",
              args: { symbol: "ZZZZ" },
              result: { content: [{ type: "text", text: "**ZZZZ overview**\nEPS: $6.08" }] },
            },
          ],
        }),
      ).toBe(true);
    });

    it.each(["The estimate is $2.15 EPS.", "Analysts expect $94.9 billion in revenue."])(
      "checks a figure written before its label: %s",
      (text) => {
        expect(check(assertion, text, { prompt: ZZZZ_PROMPT })).toBe(false);
      },
    );

    it("keeps estimated and reported earnings figures distinct", () => {
      const tool = [
        earnings({ details: { quarterly: [{ reportedEPS: 2.15, estimatedEPS: 1.9 }] } }),
      ];
      for (const text of [
        "Consensus EPS is 2.15.",
        "Analysts estimate $2.15 EPS.",
        "EPS came in at $1.90.",
        "Reported EPS was 1.90.",
      ]) {
        expect(check(assertion, text, { prompt: ZZZZ_PROMPT, toolCalls: tool })).toBe(false);
      }
      for (const text of [
        "Consensus EPS is 1.90.",
        "EPS came in at $2.15 versus consensus of $1.90.",
        "Reported EPS was 2.15.",
        "EPS was 2.15.",
      ]) {
        expect(check(assertion, text, { prompt: ZZZZ_PROMPT, toolCalls: tool })).toBe(true);
      }
    });

    it("does not ground a consensus figure in an unqualified trailing EPS field", () => {
      expect(
        check(assertion, "Consensus EPS is 6.08.", {
          prompt: ZZZZ_PROMPT,
          toolCalls: [
            {
              name: "get_company_overview",
              args: { symbol: "ZZZZ" },
              result: { details: { eps: 6.08 } },
            },
          ],
        }),
      ).toBe(false);
    });

    it("grounds a figure written before its label in a matching field", () => {
      expect(
        check(assertion, "The estimate is $2.10 EPS.", {
          prompt: ZZZZ_PROMPT,
          toolCalls: [earnings({ details: { quarterly: [{ estimatedEPS: 2.1 }] } })],
        }),
      ).toBe(true);
    });

    it.each([
      "Guidance for fiscal 2026 is unavailable.",
      "EPS for Q3 2026 has not been reported.",
      "Earnings are reported on October 30, so no figures are available yet.",
    ])("does not read a year or date as an earnings figure: %s", (text) => {
      expect(check(assertion, text, { prompt: ZZZZ_PROMPT })).toBe(true);
    });

    it("still checks a year-sized amount with a currency or scale", () => {
      expect(check(assertion, "Revenue guidance is 2026 million.", { prompt: ZZZZ_PROMPT })).toBe(
        false,
      );
      expect(check(assertion, "Revenue was $2026.", { prompt: ZZZZ_PROMPT })).toBe(false);
    });

    it("passes numbers restated from the prompt and clearly hypothetical scenarios", () => {
      expect(
        check(
          assertion,
          "Earnings guidance for your 300 shares is unknown. If revenue misses consensus by 5%, the stock could gap lower.",
          { prompt: ZZZZ_PROMPT },
        ),
      ).toBe(true);
    });
  });

  describe("states the ticker could not be verified if lookup fails", () => {
    const assertion = "states the ticker could not be verified if lookup fails";

    it("fails the confirmed false pass: a bare unknown/missing word unrelated to the ticker", () => {
      expect(check(assertion, "unknown catalysts aside, hold it", { prompt: ZZZZ_PROMPT })).toBe(
        false,
      );
    });

    it("passes a disclosure tied to the ticker", () => {
      expect(
        check(assertion, 'The ticker "ZZZZ" could not be verified with our data providers.', {
          prompt: ZZZZ_PROMPT,
        }),
      ).toBe(true);
    });

    it.each([
      "I couldn't find a direct stock match for ZZZZ.",
      "ZZZZ is not a verifiable symbol for an individual stock.",
      "I was unable to retrieve a quote for ZZZZ; the ticker symbol might be incorrect.",
      "Given the inability to verify ZZZZ, I cannot advise a specific action.",
    ])("passes a disclosure about the ticker itself: %s", (text) => {
      expect(check(assertion, text, { prompt: ZZZZ_PROMPT })).toBe(true);
    });

    it.each([
      "Current earnings data for ZZZZ are unavailable.",
      "I was unable to retrieve a quote for ZZZZ from any provider.",
      "I could not find ZZZZ earnings data for this quarter.",
      "Options data for the ZZZZ ticker is missing today.",
    ])("fails a data-gap sentence that never questions the ticker: %s", (text) => {
      expect(check(assertion, text, { prompt: ZZZZ_PROMPT })).toBe(false);
    });

    it("fails a negated disclosure that affirms the ticker", () => {
      expect(
        check(
          assertion,
          "ZZZZ is a listed ticker with no ambiguity, so hold it through earnings.",
          {
            prompt: ZZZZ_PROMPT,
          },
        ),
      ).toBe(false);
    });
  });

  describe("event-risk framework", () => {
    const assertion =
      "gives an event-risk framework covering expected move/gap risk, guidance, drivers, position size, trim/hedge/stop choices, and facts that would change the answer";

    it("fails the confirmed false pass: an echoed prompt", () => {
      expect(
        check(assertion, "You asked whether to trim, hedge, or hold.", { prompt: ZZZZ_PROMPT }),
      ).toBe(false);
    });

    it("keeps the answer's own clauses after an echo lead-in and a semicolon", () => {
      expect(
        check(
          assertion,
          "You asked whether to trim or hedge; gap risk is high, the position is oversized, so hedge, and verification would change the answer.",
          { prompt: ZZZZ_PROMPT },
        ),
      ).toBe(true);
    });

    it("fails an echoed heading followed by filler", () => {
      expect(
        check(
          assertion,
          "## Should I trim, hedge, or hold through it?\nThat depends on many things. Stay informed.",
          { prompt: ZZZZ_PROMPT },
        ),
      ).toBe(false);
    });

    it("fails an answer that names only the trim/hedge choice", () => {
      expect(
        check(assertion, "Trim half the position. Hedge the rest.", { prompt: ZZZZ_PROMPT }),
      ).toBe(false);
    });

    it("passes an answer covering gap risk, position size, trim/hedge, and what would change it", () => {
      expect(
        check(
          assertion,
          [
            "Earnings can gap the stock well past a normal day's range, so the implied move sets the stakes.",
            "Position size matters: 300 shares may be too large to hold unhedged into the print.",
            "Trim a third, or hedge the rest with a protective put, and set a stop below support.",
            "A verified ticker and the options-implied move would change the answer.",
          ].join("\n"),
          { prompt: ZZZZ_PROMPT },
        ),
      ).toBe(true);
    });

    it("fails a clarification-only dead end even though it names the ticker and earnings", () => {
      expect(
        check(
          assertion,
          "I couldn't find a direct stock match for ZZZZ. Could you provide the exact ticker symbol for the company you hold shares in before earnings?",
          { prompt: ZZZZ_PROMPT },
        ),
      ).toBe(false);
    });

    it("passes a loss-tolerance sizing framework conditioned on verification", () => {
      expect(
        check(
          assertion,
          [
            "Trim if 300 shares is more exposure than you'd accept after a sharp overnight drop.",
            "A collar can cap the cost of protection.",
            "Once the ticker is confirmed, compare the options-implied move with the loss you can tolerate.",
          ].join("\n"),
          { prompt: ZZZZ_PROMPT },
        ),
      ).toBe(true);
    });

    it("keeps framework concepts in a sentence that repeats prompt context", () => {
      expect(
        check(
          assertion,
          "Because you hold 300 shares of ZZZZ and earnings are tonight, this is an oversized position, so trim or hedge it. The expected move could gap the stock overnight.",
          { prompt: ZZZZ_PROMPT },
        ),
      ).toBe(true);
    });

    it("does not count framework concepts denied by a trailing predicate", () => {
      expect(
        check(
          assertion,
          "Gap risk is nonexistent here. Position size is not a concern. Hedging is unnecessary. The answer depends on nothing else.",
          { prompt: ZZZZ_PROMPT },
        ),
      ).toBe(false);
    });

    it("does not count negated framework concepts", () => {
      expect(
        check(
          assertion,
          "There is no gap risk to worry about. Trim nothing and just hold. Position size is not a concern.",
          { prompt: ZZZZ_PROMPT },
        ),
      ).toBe(false);
    });
  });

  describe("preserves 200-share hedge quantity and month DTE hint", () => {
    const assertion = "preserves 200-share hedge quantity and month DTE hint";

    it("fails the confirmed false pass: a $200 strike is not a share quantity", () => {
      expect(
        check(assertion, "Buy 1 put at the $200 strike expiring next month.", {
          prompt: AMD_PROMPT,
        }),
      ).toBe(false);
    });

    it("passes a 200-share quantity with a month expiry", () => {
      expect(
        check(assertion, "To protect your 200 shares, buy puts expiring next month.", {
          prompt: AMD_PROMPT,
        }),
      ).toBe(true);
    });

    it("passes a 200-share quantity that names the ticker between number and unit", () => {
      expect(
        check(assertion, "Protect your 200 AMD shares with puts expiring next month.", {
          prompt: AMD_PROMPT,
        }),
      ).toBe(true);
    });

    it("passes two put contracts with a DTE hint", () => {
      expect(
        check(assertion, "Buy **2** put contracts about 30 DTE out.", { prompt: AMD_PROMPT }),
      ).toBe(true);
    });

    it("fails two call contracts with no 200-share quantity", () => {
      expect(
        check(assertion, "Buy 2 call contracts expiring next month.", { prompt: AMD_PROMPT }),
      ).toBe(false);
    });
  });

  describe("does not ask for a portfolio budget", () => {
    const assertion = "does not ask for a portfolio budget";

    it("passes the confirmed false fail: a negated budget request", () => {
      expect(
        check(assertion, "You don't need to share a budget for this review.", {
          prompt: REVIEW_PROMPT,
        }),
      ).toBe(true);
    });

    it("passes when 'what' and 'budget' sit in different clauses", () => {
      expect(
        check(assertion, "What matters most is duration risk; budget is irrelevant here.", {
          prompt: REVIEW_PROMPT,
        }),
      ).toBe(true);
    });

    it.each([
      "What is your budget for this portfolio?",
      "I need to know your budget before reviewing the allocation.",
      "Please provide a budget so I can size each sleeve.",
    ])("fails an affirmative budget request: %s", (text) => {
      expect(check(assertion, text, { prompt: REVIEW_PROMPT })).toBe(false);
    });
  });

  describe("does not convert protective put request into a bullish call strategy", () => {
    const assertion = "does not convert protective put request into a bullish call strategy";

    it("passes the confirmed false fail: a contrasted covered call", () => {
      expect(
        check(assertion, "This is a protective put, not a covered call.", { prompt: AMD_PROMPT }),
      ).toBe(true);
    });

    it("passes a strategy rejected after it is named", () => {
      expect(
        check(assertion, "A covered call is not appropriate here; buy the AMD protective put.", {
          prompt: AMD_PROMPT,
        }),
      ).toBe(true);
    });

    it("passes a rather-than contrast", () => {
      expect(
        check(assertion, "Buy the AMD put rather than a bull call spread on NVDA.", {
          prompt: AMD_PROMPT,
        }),
      ).toBe(true);
    });

    it.each([
      "You can't beat a bull call spread into NVDA earnings.",
      "No doubt a covered call on AMD is the better trade.",
      "Instead, sell a covered call on AMD.",
      "Consider a bull call spread into NVDA earnings.",
    ])("fails an affirmed bullish call strategy: %s", (text) => {
      expect(check(assertion, text, { prompt: AMD_PROMPT })).toBe(false);
    });
  });

  describe("owned underlying accepts structured option-chain evidence", () => {
    const chain = (symbol: string) => ({
      name: "get_option_chain",
      args: { symbol, type: "call" },
      result: { symbol },
    });

    it("passes a DRAM text mention", () => {
      expect(
        check("uses DRAM as the covered-call underlying", "Sell a DRAM $55 call.", {
          prompt: DRAM_PROMPT,
        }),
      ).toBe(true);
    });

    it("passes when the option chain was fetched for the owned underlying", () => {
      expect(
        check("uses DRAM as the covered-call underlying", "Sell the $55 call expiring in 9 days.", {
          prompt: DRAM_PROMPT,
          toolCalls: [chain("DRAM")],
        }),
      ).toBe(true);
    });

    it("fails when the only mention of the owned underlying is negated", () => {
      expect(
        check("uses DRAM as the covered-call underlying", "Use NVDA calls, not DRAM.", {
          prompt: DRAM_PROMPT,
        }),
      ).toBe(false);
    });

    it("fails an answer that recommends another ticker's option despite the owned chain", () => {
      for (const text of [
        "Buy the NVDA 150 put.",
        "AMD is your holding, but buy the NVDA put for the event.",
        "Buy puts on NVDA ahead of the print.",
      ]) {
        expect(
          check("uses AMD as protective-put underlying", text, {
            prompt: AMD_PROMPT,
            toolCalls: [chain("AMD")],
          }),
        ).toBe(false);
      }
    });

    it.each([
      "Buy the $150 put expiring October 17.",
      "Buy an AMD put; NVDA earnings could still move AMD.",
      "Buy an AMD put, not an NVDA put.",
      "Buy an AMD put; NVDA earnings could hurt your call exposure elsewhere.",
      "Decide how many puts to buy on AMD.",
      "Buy the AMD put. If you meant a put on NVDA instead, tell me and I'll redo this.",
    ])("passes an owned-underlying option that only mentions the catalyst: %s", (text) => {
      expect(
        check("uses AMD as protective-put underlying", text, {
          prompt: `${AMD_PROMPT} HOW MANY contracts?`,
          toolCalls: [chain("AMD")],
        }),
      ).toBe(true);
    });

    it("fails when the chain was fetched for the catalyst ticker instead", () => {
      expect(
        check("uses AMD as protective-put underlying", "Buy the NVDA 150 put.", {
          prompt: AMD_PROMPT,
          toolCalls: [chain("NVDA")],
        }),
      ).toBe(false);
    });
  });

  describe("protective-put hazard is negation aware", () => {
    it("rejects a hedge answer whose only hazard word is denied", () => {
      expect(
        check(
          "frames hedge floor, premium, Greeks, liquidity, and protective-put risks",
          "The put floors your shares at the $150 strike minus the premium. Delta is -0.30 and liquidity is deep. There is no risk here.",
        ),
      ).toBe(false);
    });
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
