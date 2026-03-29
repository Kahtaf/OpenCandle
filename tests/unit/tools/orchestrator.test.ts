import { describe, it, expect, vi } from "vitest";
import { isAnalysisRequest, runComprehensiveAnalysis } from "../../../src/analysts/orchestrator.js";

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

  it("does not match random text", () => {
    expect(isAnalysisRequest("what is the price of AAPL").match).toBe(false);
    expect(isAnalysisRequest("hello world").match).toBe(false);
    expect(isAnalysisRequest("").match).toBe(false);
  });
});

describe("runComprehensiveAnalysis", () => {
  function runAndCapture(symbol: string) {
    const followUpCalls: any[] = [];
    const mockAgent = {
      followUp: vi.fn((msg: any) => followUpCalls.push(msg)),
    };
    runComprehensiveAnalysis(mockAgent as any, symbol);
    const texts = followUpCalls.map((c: any) => c.content[0].text);
    return { mockAgent, followUpCalls, texts };
  }

  it("queues 7 follow-up messages (5 analysts + synthesis + validation)", () => {
    const { mockAgent } = runAndCapture("AAPL");
    expect(mockAgent.followUp).toHaveBeenCalledTimes(7);
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

  it("has synthesis prompt that references vote tallying", () => {
    const { texts } = runAndCapture("AAPL");
    const synthesis = texts[5];
    expect(synthesis).toContain("[Synthesis]");
    expect(synthesis.toLowerCase()).toMatch(/tally|vote|signal/);
  });

  it("ends with a validation check as the final follow-up", () => {
    const { texts } = runAndCapture("AAPL");
    const validation = texts[6];
    expect(validation).toContain("[Validation");
    expect(validation.toLowerCase()).toMatch(/verify|check|validated/);
  });
});
