import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryStorage } from "../../../src/memory/storage.js";
import { initDatabase } from "../../../src/memory/sqlite.js";
import type Database from "better-sqlite3";

describe("MemoryStorage", () => {
  let db: Database.Database;
  let storage: MemoryStorage;

  beforeEach(() => {
    db = initDatabase(":memory:");
    storage = new MemoryStorage(db);
  });

  afterEach(() => {
    db.close();
  });

  describe("sessions", () => {
    it("inserts and retrieves a session", () => {
      storage.insertSession({ id: "s1", startedAt: "2026-03-29T10:00:00Z", cwd: "/test" });
      const session = storage.getSession("s1");
      expect(session).toBeTruthy();
      expect(session!.id).toBe("s1");
      expect(session!.cwd).toBe("/test");
    });

    it("updates session end time", () => {
      storage.insertSession({ id: "s1", startedAt: "2026-03-29T10:00:00Z", cwd: "/test" });
      storage.endSession("s1", "2026-03-29T11:00:00Z");
      const session = storage.getSession("s1");
      expect(session!.ended_at).toBe("2026-03-29T11:00:00Z");
    });
  });

  describe("messages", () => {
    it("inserts a user message", () => {
      storage.insertSession({ id: "s1", startedAt: "2026-03-29T10:00:00Z", cwd: "/test" });
      const messageId = storage.insertMessage({
        sessionId: "s1",
        role: "user",
        contentText: "Build me a portfolio",
        workflowType: "portfolio_builder",
        messageIndex: 0,
      });

      const row = db.prepare("SELECT * FROM messages WHERE id = ?").get(messageId) as Record<string, unknown>;
      expect(row.role).toBe("user");
      expect(row.workflow_type).toBe("portfolio_builder");
      expect(row.content_text).toBe("Build me a portfolio");
    });
  });

  describe("user_preferences", () => {
    it("inserts and retrieves a preference", () => {
      storage.upsertPreference({
        namespace: "global",
        key: "risk_profile",
        valueJson: JSON.stringify("balanced"),
        confidence: "high",
        source: "explicit",
      });
      const pref = storage.getPreference("global", "risk_profile");
      expect(pref).toBeTruthy();
      expect(JSON.parse(pref!.value_json)).toBe("balanced");
    });

    it("upserts existing preference", () => {
      storage.upsertPreference({
        namespace: "global",
        key: "risk_profile",
        valueJson: JSON.stringify("balanced"),
        confidence: "medium",
        source: "explicit",
      });
      storage.upsertPreference({
        namespace: "global",
        key: "risk_profile",
        valueJson: JSON.stringify("conservative"),
        confidence: "high",
        source: "explicit",
      });
      const pref = storage.getPreference("global", "risk_profile");
      expect(JSON.parse(pref!.value_json)).toBe("conservative");
    });

    it("queries all preferences by namespace", () => {
      storage.upsertPreference({
        namespace: "global",
        key: "risk_profile",
        valueJson: JSON.stringify("balanced"),
      });
      storage.upsertPreference({
        namespace: "global",
        key: "time_horizon",
        valueJson: JSON.stringify("1y_plus"),
      });
      storage.upsertPreference({
        namespace: "workspace",
        key: "risk_profile",
        valueJson: JSON.stringify("aggressive"),
      });

      const global = storage.getPreferencesByNamespace("global");
      expect(global).toHaveLength(2);

      const workspace = storage.getPreferencesByNamespace("workspace");
      expect(workspace).toHaveLength(1);
    });

    it("returns null for missing preference", () => {
      const pref = storage.getPreference("global", "nonexistent");
      expect(pref).toBeNull();
    });

    it("maps persisted preferences into workflow preference shape", () => {
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
      storage.upsertPreference({
        namespace: "global",
        key: "options_liquidity",
        valueJson: JSON.stringify("high"),
      });

      const prefs = storage.getWorkflowPreferences();
      expect(prefs.riskProfile).toBe("conservative");
      expect(prefs.timeHorizon).toBe("1y_plus");
      expect(prefs.liquidityMinimum).toBe("high_open_interest_and_tight_spread");
    });
  });

  describe("workflow_runs", () => {
    it("inserts and retrieves a workflow run", () => {
      storage.insertSession({ id: "s1", startedAt: "2026-03-29T10:00:00Z", cwd: "/test" });
      const runId = storage.insertWorkflowRun({
        sessionId: "s1",
        workflowType: "portfolio_builder",
        inputSlotsJson: JSON.stringify({ budget: 10000 }),
        resolvedSlotsJson: JSON.stringify({ budget: 10000, riskProfile: "balanced" }),
        defaultsUsedJson: JSON.stringify(["riskProfile", "timeHorizon"]),
      });

      expect(runId).toBeGreaterThan(0);

      const runs = storage.getRecentWorkflowRuns(5);
      expect(runs).toHaveLength(1);
      expect(runs[0].workflow_type).toBe("portfolio_builder");
    });

    it("retrieves recent runs in reverse chronological order", () => {
      storage.insertSession({ id: "s1", startedAt: "2026-03-29T10:00:00Z", cwd: "/test" });
      storage.insertWorkflowRun({
        sessionId: "s1",
        workflowType: "portfolio_builder",
        inputSlotsJson: "{}",
        resolvedSlotsJson: "{}",
        defaultsUsedJson: "[]",
      });
      storage.insertWorkflowRun({
        sessionId: "s1",
        workflowType: "options_screener",
        inputSlotsJson: "{}",
        resolvedSlotsJson: "{}",
        defaultsUsedJson: "[]",
      });

      const runs = storage.getRecentWorkflowRuns(5);
      expect(runs).toHaveLength(2);
      expect(runs[0].workflow_type).toBe("options_screener");
    });

    it("updates workflow output summary after the run completes", () => {
      storage.insertSession({ id: "s1", startedAt: "2026-03-29T10:00:00Z", cwd: "/test" });
      const runId = storage.insertWorkflowRun({
        sessionId: "s1",
        workflowType: "portfolio_builder",
        inputSlotsJson: "{}",
        resolvedSlotsJson: "{}",
        defaultsUsedJson: "[]",
      });

      storage.updateWorkflowRunOutputSummary(runId, "Balanced 4-position portfolio centered on VOO and MSFT.");

      const row = db.prepare("SELECT output_summary FROM workflow_runs WHERE id = ?").get(runId) as {
        output_summary: string;
      };
      expect(row.output_summary).toBe("Balanced 4-position portfolio centered on VOO and MSFT.");
    });
  });

  describe("recommendations", () => {
    it("inserts and retrieves recommendations for a workflow run", () => {
      storage.insertSession({ id: "s1", startedAt: "2026-03-29T10:00:00Z", cwd: "/test" });
      const runId = storage.insertWorkflowRun({
        sessionId: "s1",
        workflowType: "portfolio_builder",
        inputSlotsJson: "{}",
        resolvedSlotsJson: "{}",
        defaultsUsedJson: "[]",
      });

      storage.insertRecommendation({
        workflowRunId: runId,
        recommendationType: "portfolio_pick",
        symbol: "AAPL",
        payloadJson: JSON.stringify({ allocation: 0.25, amount: 2500 }),
      });
      storage.insertRecommendation({
        workflowRunId: runId,
        recommendationType: "portfolio_pick",
        symbol: "VOO",
        payloadJson: JSON.stringify({ allocation: 0.35, amount: 3500 }),
      });

      const recs = storage.getRecommendationsByRun(runId);
      expect(recs).toHaveLength(2);
      expect(recs[0].symbol).toBe("AAPL");
      expect(recs[1].symbol).toBe("VOO");
    });
  });

  describe("tool_calls", () => {
    it("stores tool start and completion in the same row", () => {
      storage.insertSession({ id: "s1", startedAt: "2026-03-29T10:00:00Z", cwd: "/test" });
      storage.insertToolCallStart({
        sessionId: "s1",
        toolCallId: "tc-1",
        toolName: "get_stock_quote",
        argsJson: JSON.stringify({ symbol: "AAPL" }),
      });
      storage.completeToolCall({
        toolCallId: "tc-1",
        resultSummary: "{\"price\":180}",
        success: true,
      });

      const row = db.prepare("SELECT * FROM tool_calls WHERE tool_call_id = ?").get("tc-1") as Record<string, unknown>;
      expect(row.tool_name).toBe("get_stock_quote");
      expect(row.args_json).toBe(JSON.stringify({ symbol: "AAPL" }));
      expect(row.result_summary).toBe("{\"price\":180}");
      expect(row.success).toBe(1);
    });
  });
});
