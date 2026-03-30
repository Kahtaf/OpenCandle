import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildMemoryContext } from "../../../src/memory/retrieval.js";
import { MemoryStorage } from "../../../src/memory/storage.js";
import { initDatabase } from "../../../src/memory/sqlite.js";
import type Database from "better-sqlite3";

describe("buildMemoryContext", () => {
  let db: Database.Database;
  let storage: MemoryStorage;

  beforeEach(() => {
    db = initDatabase(":memory:");
    storage = new MemoryStorage(db);
  });

  afterEach(() => {
    db.close();
  });

  it("returns empty string when no memory exists", () => {
    const context = buildMemoryContext(storage);
    expect(context).toBe("");
  });

  it("includes user preferences formatted as short lines", () => {
    storage.upsertPreference({
      namespace: "global",
      key: "risk_profile",
      valueJson: JSON.stringify("conservative"),
    });
    storage.upsertPreference({
      namespace: "global",
      key: "time_horizon",
      valueJson: JSON.stringify("1y_plus"),
    });

    const context = buildMemoryContext(storage);
    expect(context).toContain("risk_profile");
    expect(context).toContain("conservative");
    expect(context).toContain("time_horizon");
    expect(context).toContain("1y_plus");
  });

  it("respects 15-line cap for preferences", () => {
    // Insert 20 preferences
    for (let i = 0; i < 20; i++) {
      storage.upsertPreference({
        namespace: "global",
        key: `pref_${i}`,
        valueJson: JSON.stringify(`value_${i}`),
      });
    }

    const context = buildMemoryContext(storage);
    const prefSection = context.split("\n").filter((l) => l.startsWith("- "));
    expect(prefSection.length).toBeLessThanOrEqual(15);
  });

  it("includes recent workflow summary when present", () => {
    storage.insertWorkflowRun({
      sessionId: "pi-session-1",
      workflowType: "portfolio_builder",
      inputSlotsJson: JSON.stringify({ budget: 10000 }),
      resolvedSlotsJson: JSON.stringify({ budget: 10000, riskProfile: "balanced" }),
      defaultsUsedJson: JSON.stringify(["riskProfile"]),
      outputSummary: "4-position balanced portfolio draft",
    });

    const context = buildMemoryContext(storage);
    expect(context).toContain("portfolio_builder");
  });

  it("total context stays compact", () => {
    storage.upsertPreference({
      namespace: "global",
      key: "risk_profile",
      valueJson: JSON.stringify("conservative"),
    });
    storage.insertWorkflowRun({
      sessionId: "pi-session-1",
      workflowType: "portfolio_builder",
      inputSlotsJson: "{}",
      resolvedSlotsJson: "{}",
      defaultsUsedJson: "[]",
      outputSummary: "Draft portfolio",
    });

    const context = buildMemoryContext(storage);
    const lines = context.split("\n").filter((l) => l.trim());
    // Preferences (<=15) + workflow summary (<=12) + headers
    expect(lines.length).toBeLessThanOrEqual(35);
  });
});
