import { afterEach, describe, expect, it } from "vitest";
import { MarketStateService } from "../../../src/market-state/service.js";
import { initDatabase } from "../../../src/memory/sqlite.js";
import { MemoryStorage } from "../../../src/memory/storage.js";
import { asStateDatabase, type StateDatabase } from "../../../src/runtime/state-database.js";
import { WorkflowEventLogger } from "../../../src/runtime/workflow-events.js";

describe("StateDatabase", () => {
  let database: StateDatabase | undefined;

  afterEach(() => {
    database?.close();
    database = undefined;
  });

  it("adapts native better-sqlite3 without exposing its concrete type", () => {
    database = asStateDatabase(initDatabase(":memory:"));

    const storage = new MemoryStorage(database);
    storage.upsertPreference({
      key: "risk_profile",
      valueJson: JSON.stringify("balanced"),
    });

    expect(storage.getWorkflowPreferences()).toEqual({
      riskProfile: "balanced",
    });
  });

  it("supports representative market-state and workflow-event operations", () => {
    database = asStateDatabase(initDatabase(":memory:"));

    const marketState = new MarketStateService(database);
    expect(marketState.getDefaultWatchlist()).toMatchObject({
      name: "Default",
      isDefault: true,
    });

    const events = new WorkflowEventLogger(database);
    events.log("run-browser", 0, "workflow_started", { surface: "hosted_web" });

    expect(events.getEventsByRunId("run-browser")).toMatchObject([
      {
        runId: "run-browser",
        stepIndex: 0,
        eventType: "workflow_started",
      },
    ]);
  });
});
