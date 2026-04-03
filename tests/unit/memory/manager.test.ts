import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initDatabase } from "../../../src/memory/sqlite.js";
import { MemoryStorage } from "../../../src/memory/storage.js";
import { MemoryManager } from "../../../src/memory/manager.js";
import { isStale } from "../../../src/memory/types.js";
import type { MemoryEntry } from "../../../src/memory/types.js";
import type Database from "better-sqlite3";

describe("MemoryManager", () => {
  let db: Database.Database;
  let storage: MemoryStorage;
  let manager: MemoryManager;

  beforeEach(() => {
    db = initDatabase(":memory:");
    storage = new MemoryStorage(db);
    manager = new MemoryManager(storage);
  });

  afterEach(() => {
    db.close();
  });

  it("retrieves investor profile preferences for portfolio workflow", () => {
    storage.upsertPreference({
      key: "risk_profile",
      valueJson: JSON.stringify("aggressive"),
      source: "explicit",
    });
    storage.upsertPreference({
      key: "time_horizon",
      valueJson: JSON.stringify("5y_plus"),
      source: "explicit",
    });

    const entries = manager.retrieve("portfolio_builder");
    const keys = entries.map((e) => e.key);
    expect(keys).toContain("risk_profile");
    expect(keys).toContain("time_horizon");
  });

  it("suppresses overridden slot preferences", () => {
    storage.upsertPreference({
      key: "risk_profile",
      valueJson: JSON.stringify("conservative"),
      source: "explicit",
    });

    const entries = manager.retrieve("portfolio_builder", ["riskProfile"]);
    const keys = entries.map((e) => e.key);
    expect(keys).not.toContain("risk_profile");
  });

  it("excludes never-trust keys like stock prices", () => {
    storage.upsertPreference({
      key: "stock_price",
      valueJson: JSON.stringify(185.5),
      source: "inferred",
    });
    storage.upsertPreference({
      key: "risk_profile",
      valueJson: JSON.stringify("moderate"),
      source: "explicit",
    });

    const entries = manager.retrieve("portfolio_builder");
    const keys = entries.map((e) => e.key);
    expect(keys).not.toContain("stock_price");
    expect(keys).toContain("risk_profile");
  });

  it("includes workflow history for relevant workflows", () => {
    storage.insertWorkflowRun({
      sessionId: "s1",
      workflowType: "portfolio_builder",
      inputSlotsJson: "{}",
      resolvedSlotsJson: "{}",
      defaultsUsedJson: "[]",
      outputSummary: "Built 5-position portfolio",
    });

    const entries = manager.retrieve("portfolio_builder");
    const historyEntries = entries.filter((e) => e.category === "workflow_history");
    expect(historyEntries.length).toBeGreaterThan(0);
    expect(historyEntries[0].value).toContain("portfolio_builder");
  });

  it("limits workflow history per type", () => {
    for (let i = 0; i < 10; i++) {
      storage.insertWorkflowRun({
        sessionId: "s1",
        workflowType: "portfolio_builder",
        inputSlotsJson: "{}",
        resolvedSlotsJson: "{}",
        defaultsUsedJson: "[]",
        outputSummary: `Run ${i}`,
      });
    }

    const entries = manager.retrieve("portfolio_builder");
    const historyEntries = entries.filter((e) => e.category === "workflow_history");
    expect(historyEntries.length).toBeLessThanOrEqual(3);
  });

  it("builds compact context string", () => {
    storage.upsertPreference({
      key: "risk_profile",
      valueJson: JSON.stringify("balanced"),
      source: "explicit",
    });

    const context = manager.buildContext("portfolio_builder");
    expect(context).toContain("User Preferences:");
    expect(context).toContain("risk_profile: balanced");
  });

  it("returns empty string when no relevant memory", () => {
    const context = manager.buildContext("general_finance_qa");
    expect(context).toBe("");
  });

  it("entries include recordedAt for freshness", () => {
    storage.upsertPreference({
      key: "risk_profile",
      valueJson: JSON.stringify("moderate"),
      source: "explicit",
    });

    const entries = manager.retrieve("portfolio_builder");
    expect(entries[0].recordedAt).toBeTruthy();
    expect(entries[0].category).toBe("investor_profile");
  });
});

describe("isStale", () => {
  it("investor profile is not stale at 30 days", () => {
    const now = new Date("2026-04-02T00:00:00Z");
    const entry: MemoryEntry = {
      key: "risk_profile",
      value: "moderate",
      category: "investor_profile",
      recordedAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    };
    expect(isStale(entry, now)).toBe(false);
  });

  it("investor profile is stale at 91 days", () => {
    const now = new Date("2026-04-02T00:00:00Z");
    const entry: MemoryEntry = {
      key: "risk_profile",
      value: "moderate",
      category: "investor_profile",
      recordedAt: new Date(now.getTime() - 91 * 24 * 60 * 60 * 1000).toISOString(),
    };
    expect(isStale(entry, now)).toBe(true);
  });

  it("workflow history is stale at 8 days", () => {
    const now = new Date("2026-04-02T00:00:00Z");
    const entry: MemoryEntry = {
      key: "run_1",
      value: "portfolio_builder",
      category: "workflow_history",
      recordedAt: new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString(),
    };
    expect(isStale(entry, now)).toBe(true);
  });

  it("interaction feedback is not stale at 7 days", () => {
    const now = new Date("2026-04-02T00:00:00Z");
    const entry: MemoryEntry = {
      key: "correction",
      value: "use shorter output",
      category: "interaction_feedback",
      recordedAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    };
    expect(isStale(entry, now)).toBe(false);
  });
});
