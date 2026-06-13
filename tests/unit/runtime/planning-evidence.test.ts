import { describe, expect, it } from "vitest";
import { buildSkippedTag, buildSoftDegradedTag } from "../../../src/onboarding/tool-tags.js";
import {
  buildMarketStatusEvidence,
  buildPortfolioExposureMapEvidence,
  buildTickerDisambiguationEvidence,
  captureEvidenceFromToolCall,
  EVIDENCE_PLAN_REGISTRY,
  normalizeProviderGapFromToolText,
  providerResultToPlanningEvidence,
} from "../../../src/runtime/planning-evidence.js";

describe("planning evidence plans", () => {
  it("implements only market_status and ticker_disambiguation evidence plans", () => {
    expect(EVIDENCE_PLAN_REGISTRY.market_status.implemented).toBe(true);
    expect(EVIDENCE_PLAN_REGISTRY.ticker_disambiguation.implemented).toBe(true);
    expect(EVIDENCE_PLAN_REGISTRY.placeholder_asset_compare.implemented).toBe(false);
    expect(EVIDENCE_PLAN_REGISTRY.placeholder_asset_compare.capabilityGapIds).toContain(
      "etf_holdings_overlap",
    );
  });

  it("captures deterministic market status for today-style prompts during market hours", () => {
    const record = buildMarketStatusEvidence({
      text: "Why is AAPL moving today right now?",
      now: new Date("2026-05-22T14:00:00Z"),
      timezone: "America/New_York",
      traceId: "trace-1",
    });

    expect(record.evidenceType).toBe("market_status");
    expect(record.providerStatus).toBe("available");
    expect(record.rawTracePointer?.traceId).toBe("trace-1");
    expect(record.normalizedFacts.temporalReferences).toEqual(["today", "right_now"]);
    expect(record.normalizedFacts.localDate).toBe("2026-05-22");
    expect(record.normalizedFacts.marketStatus).toBe("open");
    expect(record.normalizedFacts.lastTradingDay).toBe("2026-05-22");
  });

  it("captures market-closed, weekend, holiday, and after-close caveats", () => {
    const weekend = buildMarketStatusEvidence({
      text: "Why did TSLA move today if the market is closed?",
      now: new Date("2026-05-24T16:00:00Z"),
      timezone: "America/New_York",
    });
    const holiday = buildMarketStatusEvidence({
      text: "What happened today on the holiday?",
      now: new Date("2026-05-25T16:00:00Z"),
      timezone: "America/New_York",
    });
    const afterClose = buildMarketStatusEvidence({
      text: "What happened after close this morning?",
      now: new Date("2026-05-22T21:30:00Z"),
      timezone: "America/New_York",
    });

    expect(weekend.normalizedFacts.marketStatus).toBe("closed_weekend");
    expect(weekend.normalizedFacts.lastTradingDay).toBe("2026-05-22");
    expect(holiday.normalizedFacts.marketStatus).toBe("closed_holiday");
    expect(holiday.normalizedFacts.holidayName).toBe("Memorial Day");
    expect(afterClose.normalizedFacts.marketStatus).toBe("after_close");
    expect(afterClose.normalizedFacts.temporalReferences).toEqual(["this_morning", "after_close"]);
  });

  it("uses market-status plus tool-result evidence for current-event explanations", () => {
    const plan = EVIDENCE_PLAN_REGISTRY.market_status;
    const quote = captureEvidenceFromToolCall(
      {
        name: "get_stock_quote",
        args: { symbol: "BA" },
        result: { symbol: "BA", price: 180 },
        isError: false,
      },
      {
        traceId: "trace-current-event",
        toolCallIndex: 0,
      },
    );
    const news = captureEvidenceFromToolCall(
      {
        name: "search_web",
        args: { query: "Boeing stock catalyst today", category: "news" },
        result: { results: [{ title: "Boeing headline" }] },
        isError: false,
      },
      {
        traceId: "trace-current-event",
        toolCallIndex: 1,
      },
    );

    expect(plan.taskFamilies).toContain("current_event_explanation");
    expect(plan.requiredEvidence).toEqual(["market_status"]);
    expect(plan.optionalEvidence).toContain("tool_result");
    expect(plan.capabilityGapIds).toContain("market_calendar");
    expect(quote.evidenceType).toBe("tool_result");
    expect(news.evidenceType).toBe("tool_result");
    expect(quote.rawTracePointer).toEqual(
      expect.objectContaining({
        traceId: "trace-current-event",
        toolName: "get_stock_quote",
        toolCallIndex: 0,
      }),
    );
    expect(news.rawTracePointer).toEqual(
      expect.objectContaining({
        traceId: "trace-current-event",
        toolName: "search_web",
        toolCallIndex: 1,
      }),
    );
  });

  it("builds the selected ticker-disambiguation slice without invoking unrelated plans", () => {
    const record = buildTickerDisambiguationEvidence({
      text: "What's the current ticker for Facebook?",
      symbols: ["META"],
      traceId: "trace-2",
    });

    expect(record.evidenceType).toBe("ticker_disambiguation");
    expect(record.normalizedFacts.selectedMigrationSlice).toBe("ticker_disambiguation");
    expect(record.normalizedFacts.requestedSymbols).toEqual(["META"]);
    expect(record.gaps).toContainEqual(
      expect.objectContaining({
        capabilityGapId: "earnings_event_risk",
      }),
    );
  });

  it("builds deterministic portfolio exposure-map evidence from user-stated allocations", () => {
    const record = buildPortfolioExposureMapEvidence({
      text: "I have 45% tech, 25% S&P 500 index, 20% bonds, and 10% cash. Should I rebalance?",
      traceId: "trace-portfolio",
    });

    expect(record.evidenceType).toBe("portfolio_exposure_map");
    expect(record.rawTracePointer).toEqual(
      expect.objectContaining({
        traceId: "trace-portfolio",
        toolName: "deterministic_portfolio_exposure_map",
      }),
    );
    expect(record.normalizedFacts.directSleeves).toEqual([
      { label: "tech", normalizedSleeve: "technology_sector", percent: 45 },
      { label: "S&P 500 index", normalizedSleeve: "broad_us_index", percent: 25 },
      { label: "bonds", normalizedSleeve: "bonds", percent: 20 },
      { label: "cash", normalizedSleeve: "cash", percent: 10 },
    ]);
    expect(record.normalizedFacts.directExposureTotalPercent).toBe(100);
    expect(record.normalizedFacts.broadIndexOverlapCaveat).toBe(true);
    expect(record.normalizedFacts.targetBandGuidanceNeeded).toBe(true);
    expect(record.gaps).toContainEqual(
      expect.objectContaining({
        capabilityGapId: "etf_holdings_overlap",
      }),
    );
    expect(record.caveats.join(" ")).toMatch(/exact ETF\/index holdings overlap/i);
  });
});

describe("planning evidence normalization", () => {
  it("preserves raw tool-call traces while adding evidence records", () => {
    const rawCall = {
      name: "get_stock_quote",
      args: { symbol: "AAPL" },
      result: { symbol: "AAPL", price: 190 },
      isError: false,
    };

    const record = captureEvidenceFromToolCall(rawCall, {
      traceId: "trace-3",
      turnIndex: 0,
      toolCallIndex: 2,
      toolCallId: "toolu_123",
    });

    expect(record.rawTracePointer).toEqual({
      traceId: "trace-3",
      turnIndex: 0,
      toolCallIndex: 2,
      toolCallId: "toolu_123",
      toolName: "get_stock_quote",
    });
    expect(rawCall.result).toEqual({ symbol: "AAPL", price: 190 });
    expect(record.normalizedFacts.args).toEqual({ symbol: "AAPL" });
  });

  it("normalizes soft-degraded and skipped tool tags without dropping /connect remediation", () => {
    const soft = normalizeProviderGapFromToolText(
      buildSoftDegradedTag({
        provider: "brave",
        fallback: "ddg",
        remediation: "run /connect search",
      }),
    );
    const skipped = normalizeProviderGapFromToolText(
      buildSkippedTag({
        provider: "fred",
        reason: "credential_not_provided",
        remediation: "run /connect economy",
        silenced: true,
      }),
    );

    expect(soft).toEqual(
      expect.objectContaining({
        providerStatus: "soft_degraded",
        provider: "brave",
        remediation: "run /connect search",
      }),
    );
    expect(skipped).toEqual(
      expect.objectContaining({
        providerStatus: "skipped",
        provider: "fred",
        remediation: "run /connect economy",
        silenced: true,
      }),
    );
  });

  it("converts unavailable provider results into structured evidence gaps", () => {
    const record = providerResultToPlanningEvidence("fred_series", {
      status: "unavailable",
      provider: "fred",
      reason: "missing API key",
    });

    expect(record.providerStatus).toBe("unavailable");
    expect(record.gaps).toContainEqual(
      expect.objectContaining({
        provider: "fred",
        reason: "missing API key",
      }),
    );
  });
});
