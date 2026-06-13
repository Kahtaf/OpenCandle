import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ALERT_CONDITION_VERSION,
  priceCrossesAbove,
  priceCrossesSma,
  rsiThreshold,
  volumeSpike,
} from "../../../src/market-state/alert-conditions.js";
import { MarketStateService } from "../../../src/market-state/service.js";
import { initDatabase } from "../../../src/memory/sqlite.js";

describe("market-state alerts and reports", () => {
  let db: Database.Database;
  let service: MarketStateService;

  beforeEach(() => {
    db = initDatabase(":memory:");
    service = new MarketStateService(db);
  });

  afterEach(() => {
    db.close();
  });

  it("stores versioned canonical alert condition JSON", () => {
    const item = service.addWatchlistItem({
      instrument: {
        symbol: "AAPL",
        assetType: "equity",
        name: "Apple Inc.",
        exchange: "NMS",
        currency: "USD",
        provider: "yahoo",
      },
    });

    const rule = service.createAlertRule({
      scopeType: "instrument",
      instrumentId: item.instrumentId,
      conditionType: "price_crosses_above",
      conditionVersion: ALERT_CONDITION_VERSION,
      condition: priceCrossesAbove(250),
      timeframe: "quote",
      cooldownSeconds: 3600,
    });

    expect(rule.conditionVersion).toBe(1);
    expect(rule.conditionJson).toEqual({ threshold: 250, field: "last_price" });
    expect(rule.timeframe).toBe("quote");
    expect(service.listAlertRules()).toHaveLength(1);
  });

  it("builds SMA RSI and volume condition shapes", () => {
    expect(priceCrossesSma(50, "above")).toEqual({
      period: 50,
      direction: "above",
      price_field: "close",
    });
    expect(rsiThreshold(14, 30, "below")).toEqual({
      period: 14,
      threshold: 30,
      direction: "below",
    });
    expect(volumeSpike(20, 2)).toEqual({
      lookback_period: 20,
      multiplier: 2,
    });
  });

  it("suppresses duplicate trigger events when the previous observation changed first", () => {
    const instrument = service.upsertInstrumentRecord({
      symbol: "AAPL",
      assetType: "equity",
      name: "Apple Inc.",
      exchange: "NMS",
      currency: "USD",
      provider: "yahoo",
    });
    const rule = service.createAlertRule({
      scopeType: "instrument",
      instrumentId: instrument.id,
      conditionType: "price_crosses_above",
      conditionVersion: ALERT_CONDITION_VERSION,
      condition: priceCrossesAbove(250),
      timeframe: "quote",
      cooldownSeconds: 3600,
    });
    service.updateAlertObservation({
      ruleId: rule.id,
      observed: { value: 240, field: "last_price", at: "2026-05-31T12:00:00.000Z" },
      checkedAt: "2026-05-31T12:00:00.000Z",
    });

    const first = service.recordAlertCheckResult({
      ruleId: rule.id,
      observed: { value: 260, field: "last_price", at: "2026-05-31T12:01:00.000Z" },
      checkedAt: "2026-05-31T12:01:00.000Z",
      trigger: {
        expectedPreviousValue: 240,
        expectedLastTriggeredAt: null,
        instrumentId: instrument.id,
        message: "AAPL price_crosses_above at $260.00",
        triggeredAt: "2026-05-31T12:01:00.000Z",
      },
    });
    const duplicate = service.recordAlertCheckResult({
      ruleId: rule.id,
      observed: { value: 260, field: "last_price", at: "2026-05-31T12:01:00.000Z" },
      checkedAt: "2026-05-31T12:01:00.000Z",
      trigger: {
        expectedPreviousValue: 240,
        expectedLastTriggeredAt: null,
        instrumentId: instrument.id,
        message: "AAPL price_crosses_above at $260.00",
        triggeredAt: "2026-05-31T12:01:00.000Z",
      },
    });

    expect(first.triggered).toBe(true);
    expect(duplicate.triggered).toBe(false);
    expect(service.listAlertEvents()).toHaveLength(1);
  });

  it("stores daily report template timezone and local time", () => {
    const template = service.createReportTemplate({
      name: "Morning watchlist",
      reportType: "watchlist_daily",
      cadence: "daily",
      timezone: "America/Toronto",
      localTime: "08:00",
      config: { targets: { default_watchlist: true } },
      enabled: true,
    });

    expect(template.timezone).toBe("America/Toronto");
    expect(template.localTime).toBe("08:00");
    expect(template.configJson).toEqual({ targets: { default_watchlist: true } });
  });

  it("claims runner ownership, records alert runs, notifications, and delivery attempts", () => {
    const firstLease = service.acquireAutomationRunnerLease({
      ownerId: "gui-1",
      ownerKind: "writer",
      now: "2026-06-01T12:00:00.000Z",
      ttlSeconds: 60,
    });
    const blockedLease = service.acquireAutomationRunnerLease({
      ownerId: "monitor-1",
      ownerKind: "monitor",
      now: "2026-06-01T12:00:30.000Z",
      ttlSeconds: 60,
    });
    const takeoverLease = service.acquireAutomationRunnerLease({
      ownerId: "monitor-1",
      ownerKind: "monitor",
      now: "2026-06-01T12:02:00.000Z",
      ttlSeconds: 60,
    });

    expect(firstLease.acquired).toBe(true);
    expect(blockedLease).toMatchObject({ acquired: false, ownerId: "gui-1" });
    expect(takeoverLease).toMatchObject({ acquired: true, ownerId: "monitor-1" });

    const run = service.startAlertCheckRun({
      ownerId: "monitor-1",
      startedAt: "2026-06-01T12:02:01.000Z",
      triggerType: "heartbeat",
    });
    const completed = service.completeAlertCheckRun(run.id, {
      completedAt: "2026-06-01T12:02:03.000Z",
      status: "completed",
      checkedCount: 2,
      triggeredCount: 1,
      unavailableCount: 1,
      providerStatus: {
        tradingview: { status: "ok", requests: 1 },
        yahoo: { status: "fallback", requests: 1 },
      },
    });

    expect(completed).toMatchObject({
      status: "completed",
      checkedCount: 2,
      triggeredCount: 1,
      unavailableCount: 1,
      ownerId: "monitor-1",
      triggerType: "heartbeat",
      providerStatusJson: {
        tradingview: { status: "ok", requests: 1 },
        yahoo: { status: "fallback", requests: 1 },
      },
    });

    const notification = service.recordNotificationEvent({
      sourceType: "alert_event",
      sourceId: 42,
      severity: "warning",
      title: "AAPL alert triggered",
      body: "AAPL crossed above $250.",
      payload: { symbol: "AAPL", price: 260 },
    });
    const attempt = service.recordNotificationDeliveryAttempt({
      notificationEventId: notification.id,
      channel: "webhook",
      status: "failed",
      attemptedAt: "2026-06-01T12:02:04.000Z",
      completedAt: "2026-06-01T12:02:05.000Z",
      error: "connection refused",
    });

    expect(service.listNotificationEvents()).toEqual([
      expect.objectContaining({
        id: notification.id,
        sourceType: "alert_event",
        sourceId: 42,
        acknowledgedAt: null,
        payloadJson: { symbol: "AAPL", price: 260 },
      }),
    ]);
    expect(service.listNotificationDeliveryAttempts(notification.id)).toEqual([
      expect.objectContaining({
        id: attempt.id,
        notificationEventId: notification.id,
        channel: "webhook",
        status: "failed",
        error: "connection refused",
      }),
    ]);
  });

  it("does not report an expired automation runner lease as active", () => {
    service.acquireAutomationRunnerLease({
      ownerId: "gui-1",
      ownerKind: "writer",
      now: "2026-06-01T12:00:00.000Z",
      ttlSeconds: 60,
    });

    expect(service.getAutomationRunnerLease("2026-06-01T12:00:30.000Z")).toMatchObject({
      ownerId: "gui-1",
    });
    expect(service.getAutomationRunnerLease("2026-06-01T12:01:01.000Z")).toBeNull();
  });

  it("marks stale running alert and report work as lost", () => {
    const run = service.startAlertCheckRun({
      ownerId: "monitor-1",
      startedAt: "2026-06-01T12:00:00.000Z",
      triggerType: "heartbeat",
    });
    const template = service.createReportTemplate({
      name: "Morning watchlist",
      reportType: "watchlist_daily",
      cadence: "daily",
      timezone: "America/Toronto",
      localTime: "08:00",
      config: { targets: { default_watchlist: true } },
    });
    const report = service.recordReportRun({
      templateId: template.id,
      startedAt: "2026-06-01T12:00:00.000Z",
      status: "running",
      triggerType: "scheduled",
      ownerId: "monitor-1",
    });

    const marked = service.markStaleAutomationRunsLost({
      now: "2026-06-01T12:10:00.000Z",
      graceSeconds: 300,
    });

    expect(marked).toEqual({ alertCheckRuns: 1, reportRuns: 1 });
    expect(service.getAlertCheckRun(run.id)).toMatchObject({ status: "lost" });
    expect(service.listReportRuns()).toEqual([
      expect.objectContaining({ id: report.id, status: "lost" }),
    ]);
  });
});
