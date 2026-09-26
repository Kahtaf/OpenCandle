import { describe, expect, it } from "vitest";
import type { EvidenceRecord, ToolEvidenceOutcome } from "../../../src/runtime/evidence.js";
import type { PromptValidationContext } from "../../../src/runtime/prompt-step.js";
import { createPortfolioEvidenceValidation } from "../../../src/workflows/portfolio-output-validation.js";

function toolEvidence(
  tool: string,
  outcome: ToolEvidenceOutcome,
  overrides: Partial<EvidenceRecord["value"]> = {},
): EvidenceRecord {
  return {
    label: `tool:${tool}`,
    value: {
      tool,
      args: "{}",
      outcome,
      resultDigest: { preview: "{}", totalLength: 2 },
      startedAt: "2026-09-25T00:00:00.000Z",
      completedAt: "2026-09-25T00:00:01.000Z",
      ...overrides,
    },
    provenance: { source: "computed", provider: tool, timestamp: "2026-09-25T00:00:01.000Z" },
  };
}

function context(
  currentEvidence: EvidenceRecord[],
  priorEvidence: EvidenceRecord[] = [],
): PromptValidationContext {
  return { stepType: "fetch_candidates", currentEvidence, priorEvidence };
}

describe("createPortfolioEvidenceValidation", () => {
  it("rejects fetch_candidates when no pricing tool evidence was captured", () => {
    const validation = createPortfolioEvidenceValidation({
      step: "fetch_candidates",
      assetScope: "diversified_etf_building_blocks",
    });

    const errors = validation.validate("| VOO | 18% | $474.96 |", context([]));

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/no usable market price evidence/i);
  });

  it("accepts fetch_candidates after a completed stock quote", () => {
    const validation = createPortfolioEvidenceValidation({
      step: "fetch_candidates",
      assetScope: "diversified_etf_building_blocks",
    });

    const errors = validation.validate(
      "| VOO | 18% | $474.96 |",
      context([toolEvidence("get_stock_quote", "ok")]),
    );

    expect(errors).toEqual([]);
  });

  it("does not treat errored or unavailable tool results as usable market evidence", () => {
    const validation = createPortfolioEvidenceValidation({
      step: "fetch_candidates",
      assetScope: "diversified_etf_building_blocks",
    });

    const errors = validation.validate(
      "| VOO | 18% | $474.96 |",
      context([
        toolEvidence("get_stock_quote", "error"),
        toolEvidence("get_stock_quote", "unavailable"),
      ]),
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/no usable market price evidence/i);
  });

  it("accepts pricing evidence carried over from a prior step", () => {
    const validation = createPortfolioEvidenceValidation({
      step: "fetch_candidates",
      assetScope: "stocks_only",
    });

    const errors = validation.validate(
      "| AAPL | 40% |",
      context([], [toolEvidence("get_stock_quote", "ok")]),
    );

    expect(errors).toEqual([]);
  });

  it("requires risk or correlation evidence before risk_review can advance", () => {
    const validation = createPortfolioEvidenceValidation({
      step: "risk_review",
      assetScope: "diversified_etf_building_blocks",
    });

    const errors = validation.validate(
      "Volatility is moderate; average correlation is 0.35.",
      context([toolEvidence("get_stock_quote", "ok")]),
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/no usable risk or correlation evidence/i);
  });

  it("accepts completed risk or correlation evidence for risk_review", () => {
    const validation = createPortfolioEvidenceValidation({
      step: "risk_review",
      assetScope: "diversified_etf_building_blocks",
    });

    expect(
      validation.validate("Risk reviewed.", context([toolEvidence("analyze_risk", "ok")])),
    ).toEqual([]);
    expect(
      validation.validate("Risk reviewed.", context([toolEvidence("analyze_correlation", "ok")])),
    ).toEqual([]);
  });

  it("accepts dated crypto history as risk evidence for crypto scopes without requiring correlation", () => {
    const validation = createPortfolioEvidenceValidation({
      step: "risk_review",
      assetScope: "stocks_and_crypto",
    });

    const errors = validation.validate(
      "Crypto drawdown reviewed from dated history.",
      context([toolEvidence("get_crypto_history", "ok")]),
    );

    expect(errors).toEqual([]);
  });

  it("does not let crypto history fetched in an earlier step satisfy risk_review for a mixed scope", () => {
    const validation = createPortfolioEvidenceValidation({
      step: "risk_review",
      assetScope: "stocks_and_crypto",
    });

    const errors = validation.validate(
      "Crypto drawdown reviewed.",
      context([toolEvidence("get_stock_quote", "ok")], [toolEvidence("get_crypto_history", "ok")]),
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/no usable risk or correlation evidence/i);
  });

  it("does not let risk evidence from an earlier step satisfy risk_review for an equity scope", () => {
    const validation = createPortfolioEvidenceValidation({
      step: "risk_review",
      assetScope: "stocks_only",
    });

    const errors = validation.validate(
      "Risk reviewed.",
      context([], [toolEvidence("analyze_risk", "ok"), toolEvidence("analyze_correlation", "ok")]),
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/no usable risk or correlation evidence/i);
  });

  it("accepts a crypto portfolio whose risk_review makes its own history call", () => {
    const validation = createPortfolioEvidenceValidation({
      step: "risk_review",
      assetScope: "crypto_only",
    });

    const errors = validation.validate(
      "Crypto drawdown reviewed.",
      context(
        [toolEvidence("get_crypto_history", "ok")],
        [toolEvidence("get_crypto_history", "ok")],
      ),
    );

    expect(errors).toEqual([]);
  });

  it("does not count crypto history as risk evidence for a stock-only scope", () => {
    const validation = createPortfolioEvidenceValidation({
      step: "risk_review",
      assetScope: "stocks_only",
    });

    const errors = validation.validate(
      "Risk reviewed.",
      context([toolEvidence("get_crypto_history", "ok")]),
    );

    expect(errors).toHaveLength(1);
  });

  it("fails closed when the validation context is missing", () => {
    const validation = createPortfolioEvidenceValidation({
      step: "fetch_candidates",
      assetScope: "stocks_only",
    });

    expect(validation.validate("| AAPL | 40% |")).toEqual([
      expect.stringMatching(/no usable market price evidence/i),
    ]);
  });

  it("does not let malformed evidence or an unrelated tool authorize advancement", () => {
    const validation = createPortfolioEvidenceValidation({
      step: "fetch_candidates",
      assetScope: "stocks_only",
    });

    const malformed: EvidenceRecord = {
      label: "tool:get_stock_quote",
      value: "not-an-object",
      provenance: { source: "computed" },
    };

    expect(validation.validate("draft", context([malformed]))).toHaveLength(1);
    expect(
      validation.validate("draft", context([toolEvidence("get_company_overview", "ok")])),
    ).toHaveLength(1);
  });

  it("builds a corrective tool-fetch repair prompt for a missing pricing evidence failure", () => {
    const validation = createPortfolioEvidenceValidation({
      step: "fetch_candidates",
      assetScope: "stocks_only",
    });

    const prompt = validation.repairPrompt(validation.validate("draft", context([])));

    expect(prompt).toContain("stocks_only");
    expect(prompt).toMatch(/call .*get_stock_quote/i);
    expect(prompt).toMatch(/do not (?:invent|fabricate)/i);
  });

  it("builds a corrective tool-fetch repair prompt for a missing risk evidence failure", () => {
    const validation = createPortfolioEvidenceValidation({
      step: "risk_review",
      assetScope: "stocks_and_crypto",
    });

    const prompt = validation.repairPrompt(validation.validate("draft", context([])));

    expect(prompt).toMatch(/analyze_risk/i);
    expect(prompt).toMatch(/get_crypto_history/i);
    expect(prompt).toMatch(/do not (?:invent|fabricate)/i);
  });
});
