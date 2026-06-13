import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MarketStateService } from "../../../src/market-state/service.js";
import { initDefaultDatabase } from "../../../src/memory/sqlite.js";
import { notificationsTool } from "../../../src/tools/portfolio/notifications.js";

describe("notificationsTool", () => {
  const originalEnv = process.env.OPENCANDLE_HOME;
  let openCandleHome: string;

  beforeEach(() => {
    openCandleHome = mkdtempSync(join(tmpdir(), "opencandle-notifications-test-"));
    process.env.OPENCANDLE_HOME = openCandleHome;
  });

  afterEach(() => {
    if (originalEnv == null) {
      delete process.env.OPENCANDLE_HOME;
    } else {
      process.env.OPENCANDLE_HOME = originalEnv;
    }
    rmSync(openCandleHome, { recursive: true, force: true });
  });

  it("lists and acknowledges durable notification events", async () => {
    const db = initDefaultDatabase();
    const service = new MarketStateService(db);
    const notification = service.recordNotificationEvent({
      sourceType: "alert_event",
      severity: "warning",
      title: "AAPL alert triggered",
      body: "AAPL crossed 250.",
      createdAt: "2026-06-01T12:00:00.000Z",
    });
    db.close();

    const listed = await notificationsTool.execute("test", { action: "list" });
    expect(listed.content[0].text).toContain("AAPL alert triggered");
    expect(listed.details).toEqual([
      expect.objectContaining({ id: notification.id, status: "unread" }),
    ]);

    const acknowledged = await notificationsTool.execute("test", {
      action: "acknowledge",
      id: notification.id,
    });

    expect(acknowledged.content[0].text).toContain(`Acknowledged notification #${notification.id}`);
    expect(acknowledged.details).toMatchObject({
      id: notification.id,
      status: "acknowledged",
      acknowledgedAt: expect.any(String),
    });
  });
});
