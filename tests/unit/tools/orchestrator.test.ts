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
  it("queues 6 follow-up messages (5 analysts + synthesis)", () => {
    const followUpCalls: any[] = [];
    const mockAgent = {
      followUp: vi.fn((msg: any) => followUpCalls.push(msg)),
    };

    runComprehensiveAnalysis(mockAgent as any, "AAPL");
    expect(mockAgent.followUp).toHaveBeenCalledTimes(6);

    // Verify each analyst role is represented
    const texts = followUpCalls.map((c: any) => c.content[0].text);
    expect(texts[0]).toContain("[Fundamental Analyst]");
    expect(texts[1]).toContain("[Technical Analyst]");
    expect(texts[2]).toContain("[Options Analyst]");
    expect(texts[3]).toContain("[Sentiment Analyst]");
    expect(texts[4]).toContain("[Risk Manager]");
    expect(texts[5]).toContain("[Synthesis]");

    // Verify symbol is included
    for (const text of texts) {
      expect(text).toContain("AAPL");
    }
  });
});
