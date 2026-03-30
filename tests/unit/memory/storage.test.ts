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
      expect(JSON.parse(pref!.value_json as string)).toBe("balanced");
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
      expect(JSON.parse(pref!.value_json as string)).toBe("conservative");
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
      const runId = storage.insertWorkflowRun({
        sessionId: "pi-session-1",
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
      storage.insertWorkflowRun({
        sessionId: "pi-session-1",
        workflowType: "portfolio_builder",
        inputSlotsJson: "{}",
        resolvedSlotsJson: "{}",
        defaultsUsedJson: "[]",
      });
      storage.insertWorkflowRun({
        sessionId: "pi-session-1",
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
      const runId = storage.insertWorkflowRun({
        sessionId: "pi-session-1",
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
      const runId = storage.insertWorkflowRun({
        sessionId: "pi-session-1",
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
});
