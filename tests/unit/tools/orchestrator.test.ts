import { describe, it, expect, vi } from "vitest";
import {
  isAnalysisRequest,
  normalizeSymbol,
  runComprehensiveAnalysis,
  buildBullPrompt,
  buildBearPrompt,
  buildRebuttalPrompt,
  buildSynthesisPrompt,
  buildComprehensiveAnalysisDefinition,
} from "../../../src/analysts/orchestrator.js";

describe("isAnalysisRequest", () => {
  it("matches 'analyze AAPL'", () => {
    const result = isAnalysisRequest("analyze AAPL");
    expect(result.match).toBe(true);
    expect(result.symbol).toBe("AAPL");
  });

  it("matches 'analyze $TSLA'", () => {
    const result = isAnalysisRequest("analyze $TSLA");
    expect(result.match).toBe(true);
    expect(result.symbol).toBe("TSLA");
  });

  it("matches 'full analysis of MSFT'", () => {
    const result = isAnalysisRequest("full analysis of MSFT");
    expect(result.match).toBe(true);
    expect(result.symbol).toBe("MSFT");
  });

  it("matches 'deep dive on NVDA'", () => {
    const result = isAnalysisRequest("deep dive on NVDA");
    expect(result.match).toBe(true);
    expect(result.symbol).toBe("NVDA");
  });

  it("is case insensitive", () => {
    const result = isAnalysisRequest("ANALYZE aapl");
    expect(result.match).toBe(true);
    expect(result.symbol).toBe("AAPL");
  });

  it("matches class-share symbols like BRK.B", () => {
    const result = isAnalysisRequest("analyze BRK.B");
    expect(result.match).toBe(true);
    expect(result.symbol).toBe("BRK.B");
  });

  it("does not match random text", () => {
    expect(isAnalysisRequest("what is the price of AAPL").match).toBe(false);
    expect(isAnalysisRequest("hello world").match).toBe(false);
    expect(isAnalysisRequest("").match).toBe(false);
  });
});

describe("normalizeSymbol", () => {
  it("accepts plain tickers", () => {
    expect(normalizeSymbol("aapl")).toBe("AAPL");
  });

  it("accepts class-share tickers with dots and slashes", () => {
    expect(normalizeSymbol("brk.b")).toBe("BRK.B");
    expect(normalizeSymbol("rds/a")).toBe("RDS/A");
  });

  it("rejects invalid symbols", () => {
    expect(normalizeSymbol("hello world")).toBeUndefined();
    expect(normalizeSymbol("TOO-LONG")).toBeUndefined();
  });
});

describe("runComprehensiveAnalysis", () => {
  function runAndCapture(symbol: string) {
    const followUpCalls: string[] = [];
    const enqueueFollowUp = vi.fn((prompt: string) => followUpCalls.push(prompt));
    runComprehensiveAnalysis(enqueueFollowUp, symbol);
    return { enqueueFollowUp, texts: followUpCalls };
  }

  it("queues 10 follow-up messages (5 analysts + 3 debate + synthesis + validation)", () => {
    const { enqueueFollowUp } = runAndCapture("AAPL");
    expect(enqueueFollowUp).toHaveBeenCalledTimes(10);
  });

  it("uses named investment persona labels", () => {
    const { texts } = runAndCapture("AAPL");
    expect(texts[0]).toContain("[Valuation Analyst]");
    expect(texts[1]).toContain("[Momentum Analyst]");
    expect(texts[2]).toContain("[Options Analyst]");
    expect(texts[3]).toContain("[Contrarian Analyst]");
    expect(texts[4]).toContain("[Risk Manager]");
  });

  it("includes symbol in every analyst prompt", () => {
    const { texts } = runAndCapture("TSLA");
    for (const text of texts) {
      expect(text).toContain("TSLA");
    }
  });

  it("requires structured SIGNAL/CONVICTION/THESIS from each analyst", () => {
    const { texts } = runAndCapture("AAPL");
    // Each of the 5 analyst prompts (indices 0-4) should require the voting format
    for (let i = 0; i < 5; i++) {
      expect(texts[i]).toContain("SIGNAL:");
      expect(texts[i]).toContain("CONVICTION:");
      expect(texts[i]).toContain("THESIS:");
    }
  });

  it("includes debate prompts (bull, bear, rebuttal) after analysts", () => {
    const { texts } = runAndCapture("AAPL");
    expect(texts[5]).toContain("[Bull Researcher]");
    expect(texts[6]).toContain("[Bear Researcher]");
    expect(texts[7]).toContain("[Bull Rebuttal]");
  });

  it("has synthesis prompt that resolves the debate", () => {
    const { texts } = runAndCapture("AAPL");
    const synthesis = texts[8];
    expect(synthesis).toContain("[Synthesis]");
    expect(synthesis).toContain("RESOLVE THE DEBATE");
    expect(synthesis).toContain("DEBATE WINNER");
    expect(synthesis).toContain("REVERSAL CONDITION");
  });

  it("ends with a validation check as the final follow-up", () => {
    const { texts } = runAndCapture("AAPL");
    const validation = texts[9];
    expect(validation).toContain("[Validation");
    expect(validation.toLowerCase()).toMatch(/verify|check|validated/);
  });
});

describe("debate prompt generation", () => {
  it("bull prompt contains required markers and guardrails", () => {
    const prompt = buildBullPrompt("AAPL");
    expect(prompt).toContain("[Bull Researcher]");
    expect(prompt).toContain("AAPL");
    expect(prompt).toContain("BULL THESIS:");
    expect(prompt).toContain("KEY RISK TO THIS THESIS:");
    expect(prompt).toContain("up to 2 tools");
    expect(prompt).toContain("Execution rules:");
  });

  it("bear prompt contains required markers and guardrails", () => {
    const prompt = buildBearPrompt("AAPL");
    expect(prompt).toContain("[Bear Researcher]");
    expect(prompt).toContain("AAPL");
    expect(prompt).toContain("BEAR THESIS:");
    expect(prompt).toContain("WHAT WOULD CHANGE MY MIND:");
    expect(prompt).toContain("up to 2 tools");
    expect(prompt).toContain("Execution rules:");
  });

  it("rebuttal prompt contains self-gating instructions and guardrails", () => {
    const prompt = buildRebuttalPrompt("AAPL");
    expect(prompt).toContain("[Bull Rebuttal]");
    expect(prompt).toContain("AAPL");
    expect(prompt).toContain("SIGNAL: BUY");
    expect(prompt).toContain("SIGNAL: SELL");
    expect(prompt).toContain("REBUTTAL SKIPPED");
    expect(prompt).toContain("CONCESSIONS:");
    expect(prompt).toContain("REMAINING CONVICTION:");
    expect(prompt).toContain("No tool calls");
    expect(prompt).toContain("Execution rules:");
  });
});

describe("buildSynthesisPrompt", () => {
  it("references debate and self-adapts to rebuttal presence", () => {
    const prompt = buildSynthesisPrompt("AAPL");
    expect(prompt).toContain("[Synthesis]");
    expect(prompt).toContain("AAPL");
    expect(prompt).toContain("RESOLVE THE DEBATE");
    expect(prompt).toContain("REBUTTAL SKIPPED");
    expect(prompt).toContain("concessions as validated risks");
  });

  it("requires debate-aware output markers", () => {
    const prompt = buildSynthesisPrompt("AAPL");
    expect(prompt).toContain("VERDICT:");
    expect(prompt).toContain("CONFIDENCE:");
    expect(prompt).toContain("DEBATE WINNER:");
    expect(prompt).toContain("REVERSAL CONDITION:");
  });
});

describe("validation prompt", () => {
  it("includes debate-specific checks", () => {
    const def = buildComprehensiveAnalysisDefinition("AAPL");
    const validationStep = def.steps.find((s) => s.stepType === "validation")!;
    expect(validationStep.prompt).toContain("bull");
    expect(validationStep.prompt).toContain("bear");
    expect(validationStep.prompt).toContain("concessions");
    expect(validationStep.prompt).toContain("reversal condition");
    expect(validationStep.prompt).toContain("REBUTTAL SKIPPED");
  });
});

describe("buildComprehensiveAnalysisDefinition", () => {
  it("returns exactly 11 steps in correct order", () => {
    const def = buildComprehensiveAnalysisDefinition("AAPL");
    expect(def.steps).toHaveLength(11);
    expect(def.steps.map((s) => s.stepType)).toEqual([
      "initial_fetch",
      "analyst_valuation",
      "analyst_momentum",
      "analyst_options",
      "analyst_contrarian",
      "analyst_risk",
      "debate_bull",
      "debate_bear",
      "debate_rebuttal",
      "synthesis",
      "validation",
    ]);
  });

  it("debate steps are not skippable", () => {
    const def = buildComprehensiveAnalysisDefinition("AAPL");
    const debateSteps = def.steps.filter((s) => s.stepType.startsWith("debate_"));
    expect(debateSteps).toHaveLength(3);
    for (const step of debateSteps) {
      expect(step.skippable).toBe(false);
    }
  });

  it("synthesis step is not skippable", () => {
    const def = buildComprehensiveAnalysisDefinition("AAPL");
    const synthesis = def.steps.find((s) => s.stepType === "synthesis")!;
    expect(synthesis.skippable).toBe(false);
  });
});
