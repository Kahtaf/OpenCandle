import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initDatabase } from "../../../src/memory/sqlite.js";
import { WorkflowEventLogger } from "../../../src/runtime/workflow-events.js";
import type Database from "better-sqlite3";

describe("WorkflowEventLogger", () => {
  let db: Database.Database;
  let logger: WorkflowEventLogger;

  beforeEach(() => {
    db = initDatabase(":memory:");
    logger = new WorkflowEventLogger(db);
  });

  afterEach(() => {
    db.close();
  });

  it("logs and retrieves events by run ID", () => {
    logger.log("run-1", 0, "workflow_started", { workflowType: "portfolio_builder" });
    logger.log("run-1", 0, "step_started", { stepType: "fetch_data" });
    logger.log("run-1", 0, "step_completed", { stepType: "fetch_data" });

    const events = logger.getEventsByRunId("run-1");
    expect(events).toHaveLength(3);
    expect(events[0].eventType).toBe("workflow_started");
    expect(events[1].eventType).toBe("step_started");
    expect(events[2].eventType).toBe("step_completed");
  });

  it("isolates events by run ID", () => {
    logger.log("run-1", 0, "workflow_started");
    logger.log("run-2", 0, "workflow_started");

    expect(logger.getEventsByRunId("run-1")).toHaveLength(1);
    expect(logger.getEventsByRunId("run-2")).toHaveLength(1);
  });

  it("returns events in insertion order", () => {
    logger.log("run-1", 0, "workflow_started");
    logger.log("run-1", 1, "step_started");
    logger.log("run-1", 1, "tool_called", { tool: "get_stock_quote" });
    logger.log("run-1", 1, "step_completed");
    logger.log("run-1", 2, "step_started");

    const events = logger.getEventsByRunId("run-1");
    expect(events.map((e) => e.eventType)).toEqual([
      "workflow_started",
      "step_started",
      "tool_called",
      "step_completed",
      "step_started",
    ]);
    expect(events.map((e) => e.stepIndex)).toEqual([0, 1, 1, 1, 2]);
  });

  it("stores and retrieves payload JSON", () => {
    logger.log("run-1", 0, "tool_called", {
      tool: "get_stock_quote",
      args: { symbol: "AAPL" },
      status: "ok",
    });

    const events = logger.getEventsByRunId("run-1");
    expect(events[0].payloadJson).not.toBeNull();
    const payload = JSON.parse(events[0].payloadJson!);
    expect(payload.tool).toBe("get_stock_quote");
    expect(payload.args.symbol).toBe("AAPL");
  });

  it("handles events with no payload", () => {
    logger.log("run-1", 0, "workflow_started");

    const events = logger.getEventsByRunId("run-1");
    expect(events[0].payloadJson).toBeNull();
  });

  it("returns empty array for unknown run ID", () => {
    const events = logger.getEventsByRunId("nonexistent");
    expect(events).toEqual([]);
  });

  it("events are append-only — ids always increase", () => {
    logger.log("run-1", 0, "workflow_started");
    logger.log("run-1", 1, "step_started");

    const events = logger.getEventsByRunId("run-1");
    expect(events[1].id).toBeGreaterThan(events[0].id);
  });
});
