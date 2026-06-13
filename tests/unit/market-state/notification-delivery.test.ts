import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deliverPendingNotifications } from "../../../src/market-state/notification-delivery.js";
import { MarketStateService } from "../../../src/market-state/service.js";
import { initDatabase } from "../../../src/memory/sqlite.js";

describe("notification delivery", () => {
  let db: Database.Database;
  let service: MarketStateService;

  beforeEach(() => {
    db = initDatabase(":memory:");
    service = new MarketStateService(db);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
  });

  it("posts pending notifications to a configured webhook and records delivery attempts", async () => {
    const notification = service.recordNotificationEvent({
      sourceType: "alert_event",
      severity: "warning",
      title: "AAPL alert triggered",
      body: "AAPL crossed 250.",
      createdAt: "2026-06-01T12:00:00.000Z",
    });
    const fetchImpl = vi.fn(async () => new Response("ok", { status: 200 }));

    const result = await deliverPendingNotifications(service, {
      webhookUrl: "https://example.test/opencandle",
      fetchImpl,
      now: "2026-06-01T12:01:00.000Z",
    });

    expect(result).toMatchObject({ attempted: 1, succeeded: 1, failed: 0 });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://example.test/opencandle",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: expect.stringContaining("AAPL alert triggered"),
      }),
    );
    expect(service.listNotificationDeliveryAttempts()).toEqual([
      expect.objectContaining({
        notificationEventId: notification.id,
        channel: "webhook",
        status: "success",
        attemptedAt: "2026-06-01T12:01:00.000Z",
        completedAt: "2026-06-01T12:01:00.000Z",
      }),
    ]);
    expect(service.getNotificationEvent(notification.id).status).toBe("unread");
  });

  it("does not create duplicate webhook attempts after a success", async () => {
    const notification = service.recordNotificationEvent({
      sourceType: "report_run",
      severity: "info",
      title: "Daily report generated",
      body: "Generated 3 quote rows.",
    });
    service.recordNotificationDeliveryAttempt({
      notificationEventId: notification.id,
      channel: "webhook",
      status: "success",
    });
    const fetchImpl = vi.fn(async () => new Response("ok", { status: 200 }));

    const result = await deliverPendingNotifications(service, {
      webhookUrl: "https://example.test/opencandle",
      fetchImpl,
    });

    expect(result).toMatchObject({ attempted: 0, succeeded: 0, failed: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(service.listNotificationDeliveryAttempts(notification.id)).toHaveLength(1);
  });

  it("records failed webhook attempts without changing notification state", async () => {
    const notification = service.recordNotificationEvent({
      sourceType: "alert_event",
      severity: "warning",
      title: "AAPL alert triggered",
      body: "AAPL crossed 250.",
    });
    const fetchImpl = vi.fn(async () => new Response("bad gateway", { status: 502 }));

    const result = await deliverPendingNotifications(service, {
      webhookUrl: "https://example.test/opencandle",
      fetchImpl,
      now: "2026-06-01T12:01:00.000Z",
    });

    expect(result).toMatchObject({ attempted: 1, succeeded: 0, failed: 1 });
    expect(service.listNotificationDeliveryAttempts()).toEqual([
      expect.objectContaining({
        notificationEventId: notification.id,
        channel: "webhook",
        status: "failed",
        error: "HTTP 502",
      }),
    ]);
    expect(service.getNotificationEvent(notification.id).status).toBe("unread");
  });

  it("rejects non-http webhook URLs before fetching", async () => {
    const notification = service.recordNotificationEvent({
      sourceType: "alert_event",
      severity: "warning",
      title: "AAPL alert triggered",
      body: "AAPL crossed 250.",
    });
    const fetchImpl = vi.fn(async () => new Response("ok", { status: 200 }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await deliverPendingNotifications(service, {
      webhookUrl: "ftp://example.com/hook",
      fetchImpl,
    });

    expect(result).toMatchObject({ attempted: 1, succeeded: 0, failed: 1 });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(service.listNotificationDeliveryAttempts(notification.id)).toEqual([
      expect.objectContaining({
        notificationEventId: notification.id,
        channel: "webhook",
        status: "failed",
        error: "Rejected notification webhook URL host: example.com",
      }),
    ]);
    expect(warn).toHaveBeenCalledWith("Rejected notification webhook URL host: example.com");
  });

  it("rejects link-local metadata webhook URLs before fetching", async () => {
    const notification = service.recordNotificationEvent({
      sourceType: "alert_event",
      severity: "warning",
      title: "AAPL alert triggered",
      body: "AAPL crossed 250.",
    });
    const fetchImpl = vi.fn(async () => new Response("ok", { status: 200 }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await deliverPendingNotifications(service, {
      webhookUrl: "http://169.254.169.254/hook",
      fetchImpl,
    });

    expect(result).toMatchObject({ attempted: 1, succeeded: 0, failed: 1 });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(service.listNotificationDeliveryAttempts(notification.id)).toEqual([
      expect.objectContaining({
        notificationEventId: notification.id,
        channel: "webhook",
        status: "failed",
        error: "Rejected notification webhook URL host: 169.254.169.254",
      }),
    ]);
    expect(warn).toHaveBeenCalledWith("Rejected notification webhook URL host: 169.254.169.254");
  });

  it("records rejected webhook URL failures with bounded retry rotation", async () => {
    const notifications = [];
    for (let index = 0; index < 6; index++) {
      notifications.push(
        service.recordNotificationEvent({
          sourceType: "alert_event",
          severity: "warning",
          title: `Alert ${index + 1}`,
          body: "A price alert triggered.",
          createdAt: `2026-06-01T12:0${index}:00.000Z`,
        }),
      );
    }
    const fetchImpl = vi.fn(async () => new Response("ok", { status: 200 }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const first = await deliverPendingNotifications(service, {
      webhookUrl: "ftp://example.com/hook",
      fetchImpl,
      now: "2026-06-01T12:10:00.000Z",
      maxAttempts: 3,
    });
    const second = await deliverPendingNotifications(service, {
      webhookUrl: "ftp://example.com/hook",
      fetchImpl,
      now: "2026-06-01T12:11:00.000Z",
      maxAttempts: 3,
    });

    expect(first).toMatchObject({ attempted: 3, succeeded: 0, failed: 3 });
    expect(second).toMatchObject({ attempted: 3, succeeded: 0, failed: 3 });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith("Rejected notification webhook URL host: example.com");
    const attemptsByNotification = notifications.map(
      (notification) => service.listNotificationDeliveryAttempts(notification.id).length,
    );
    expect(attemptsByNotification).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it("allows localhost webhook receivers", async () => {
    service.recordNotificationEvent({
      sourceType: "alert_event",
      severity: "warning",
      title: "AAPL alert triggered",
      body: "AAPL crossed 250.",
    });
    const fetchImpl = vi.fn(async () => new Response("ok", { status: 200 }));

    const result = await deliverPendingNotifications(service, {
      webhookUrl: "http://127.0.0.1:9999/hook",
      fetchImpl,
    });

    expect(result).toMatchObject({ attempted: 1, succeeded: 1, failed: 0 });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:9999/hook",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("times out hanging webhook deliveries and records a failed attempt", async () => {
    const notification = service.recordNotificationEvent({
      sourceType: "alert_event",
      severity: "warning",
      title: "AAPL alert triggered",
      body: "AAPL crossed 250.",
    });
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );

    const result = await deliverPendingNotifications(service, {
      webhookUrl: "https://example.test/opencandle",
      fetchImpl,
      now: "2026-06-01T12:01:00.000Z",
      timeoutMs: 1,
    });

    expect(result).toMatchObject({ attempted: 1, succeeded: 0, failed: 1 });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://example.test/opencandle",
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
    expect(service.listNotificationDeliveryAttempts()).toEqual([
      expect.objectContaining({
        notificationEventId: notification.id,
        channel: "webhook",
        status: "failed",
        error: "Webhook delivery timed out after 1ms",
      }),
    ]);
    expect(service.getNotificationEvent(notification.id).status).toBe("unread");
  });

  it("bounds webhook delivery attempts per pass so backlog cannot monopolize the runner", async () => {
    for (let index = 0; index < 6; index++) {
      service.recordNotificationEvent({
        sourceType: "alert_event",
        severity: "warning",
        title: `Alert ${index + 1}`,
        body: "A price alert triggered.",
      });
    }
    const fetchImpl = vi.fn(async () => new Response("bad gateway", { status: 502 }));

    const result = await deliverPendingNotifications(service, {
      webhookUrl: "https://example.test/opencandle",
      fetchImpl,
      now: "2026-06-01T12:01:00.000Z",
    });

    expect(result).toMatchObject({ attempted: 5, succeeded: 0, failed: 5 });
    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(service.listNotificationDeliveryAttempts()).toHaveLength(5);
  });

  it("rotates webhook retries by oldest pending attempt instead of starving older notifications", async () => {
    const notifications = [];
    for (let index = 0; index < 6; index++) {
      notifications.push(
        service.recordNotificationEvent({
          sourceType: "alert_event",
          severity: "warning",
          title: `Alert ${index + 1}`,
          body: "A price alert triggered.",
          createdAt: `2026-06-01T12:0${index}:00.000Z`,
        }),
      );
    }
    for (const notification of notifications.slice(1)) {
      service.recordNotificationDeliveryAttempt({
        notificationEventId: notification.id,
        channel: "webhook",
        status: "failed",
        attemptedAt: "2026-06-01T12:10:00.000Z",
        completedAt: "2026-06-01T12:10:00.000Z",
        error: "HTTP 502",
      });
    }
    const fetchImpl = vi.fn(async () => new Response("bad gateway", { status: 502 }));

    await deliverPendingNotifications(service, {
      webhookUrl: "https://example.test/opencandle",
      fetchImpl,
      now: "2026-06-01T12:11:00.000Z",
    });

    const attemptsByNotification = new Map(
      notifications.map((notification) => [
        notification.id,
        service.listNotificationDeliveryAttempts(notification.id).length,
      ]),
    );
    expect(attemptsByNotification.get(notifications[0].id)).toBe(1);
    expect([...attemptsByNotification.values()].filter((count) => count === 2)).toHaveLength(4);
    expect([...attemptsByNotification.values()].filter((count) => count === 1)).toHaveLength(2);
  });
});
