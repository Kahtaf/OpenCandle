import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../../src/system-prompt.js";

describe("system prompt — skipped-tag handling instruction", () => {
  it("includes explicit guidance for [OPENCANDLE_SKIPPED ...] tags", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("[OPENCANDLE_SKIPPED");
    expect(prompt).toContain("Data gaps");
  });

  it("tells the model to omit the remediation when silenced", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("(silenced)");
  });

  it("tells the model NOT to treat skipped results as errors", () => {
    const prompt = buildSystemPrompt();
    expect(prompt.toLowerCase()).toMatch(/do not.*apolog|do not.*treat it as an error/);
  });

  it("explains the [OPENCANDLE_CONNECTED ...] tag", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("[OPENCANDLE_CONNECTED");
    expect(prompt.toLowerCase()).toContain("re-run");
  });

  it("includes explicit guidance for [OPENCANDLE_SOFT_DEGRADED ...] tags", () => {
    // 11.x — soft-degraded tags should be handled the same way as skipped
    // tags (aggregated into a Data gaps section) so the final answer always
    // surfaces every provider fallback, not just hard-skip events.
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("[OPENCANDLE_SOFT_DEGRADED");
    // The instruction should cover soft-degraded tags alongside skipped tags
    // in the Data gaps aggregation rule.
    const lowered = prompt.toLowerCase();
    expect(lowered).toContain("soft_degraded");
    expect(lowered).toContain("data gaps");
  });

  it("appends memory context when provided", () => {
    const prompt = buildSystemPrompt("User likes value stocks");
    expect(prompt).toContain("User likes value stocks");
    expect(prompt).toContain("Persistent Memory Context");
  });
});

describe("system prompt — analyst stance", () => {
  it("does not contain refusal / fiduciary-advisor vocabulary", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).not.toMatch(/\bfinancial advice\b/i);
    expect(prompt).not.toMatch(/\bnot financial advice\b/i);
    expect(prompt).not.toMatch(/\bconsult (?:a )?qualified (?:financial )?advisor/i);
    expect(prompt).not.toMatch(/\bfinancial advisory agent\b/i);
  });

  it("frames OpenCandle as a research analyst that commits to specifics", () => {
    const prompt = buildSystemPrompt();
    expect(prompt.toLowerCase()).toContain("analyst");
    expect(prompt).toMatch(/entry|target|stop|allocation/i);
    expect(prompt).toMatch(/commit/i);
  });

  it("teaches the commit + reasoning + confidence + invalidation shape", () => {
    const prompt = buildSystemPrompt();
    const lower = prompt.toLowerCase();
    expect(lower).toContain("confidence");
    expect(lower).toContain("invalidation");
    expect(lower).toContain("reasoning");
  });

  it("forbids fiduciary framing and permits analyst framing", () => {
    const prompt = buildSystemPrompt();
    expect(prompt.toLowerCase()).toMatch(/our read|analyst view|the data suggests/);
    expect(prompt.toLowerCase()).toMatch(
      /fiduciary|tailored to your|personal (financial )?situation/,
    );
  });

  it("teaches adaptive explanation depth from conversational signals", () => {
    const prompt = buildSystemPrompt();
    expect(prompt.toLowerCase()).toMatch(/calibrate|adapt/);
    expect(prompt.toLowerCase()).toMatch(/vocabulary|prior turn|sophisticated|beginner/);
  });

  it("tells ticker sentiment answers to include price context", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("For ticker-specific sentiment prompts, call get_stock_quote");
    expect(prompt).toContain("whether sentiment diverges from price action");
  });

  it("guides stock screening separately from single-symbol quote tools", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("screen_stocks");
    expect(prompt).toContain("breadth");
    expect(prompt).toContain("single-security quote");
  });

  it("exempts conceptual education from committal response labels", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("For conceptual education questions");
    expect(prompt).toContain("teach the concept directly");
    expect(prompt).toContain("do not name tool functions");
    expect(prompt).toContain(
      "do not append analyst-view, confidence-band, or invalidation boilerplate",
    );
    expect(prompt).toContain("For valuation-metric education");
    expect(prompt).toContain('start with "Bottom line"');
    expect(prompt).toContain('heading exactly named "Practical workflow"');
    expect(prompt).toContain("numbered question-driven application steps");
    expect(prompt).toContain("cross-check table with why/when");
    expect(prompt).toContain("trailing, forward, normalized, or cyclically adjusted variants");
    expect(prompt).toContain("where the metric misleads");
    expect(prompt).toContain('heading exactly named "Quick checklist"');
    expect(prompt).toContain("Conceptual education prompts are not committal responses");
    expect(prompt).toContain('Do not append "Analyst View"');
    expect(prompt).toContain("explanation, definition, or learning framework");
  });

  it("requires freshness and fallback valuation lenses for current single-stock recommendations", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("For current single-stock recommendations");
    expect(prompt).toContain("state the quote or tool-output date");
    expect(prompt).toContain("market is closed");
    expect(prompt).toContain("last available quote");
    expect(prompt).toContain("If DCF or another valuation model is unavailable or not meaningful");
    expect(prompt).toContain("do not let that tool failure become the whole valuation view");
    expect(prompt).toContain("Do not make missing fundamentals the main thesis");
    expect(prompt).toContain("position sizing");
    expect(prompt).toContain("entry strategy");
    expect(prompt).toContain("relative multiples");
    expect(prompt).toContain("growth-adjusted multiples");
    expect(prompt).toContain("cash-flow quality");
  });
});
