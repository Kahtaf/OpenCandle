import type Database from "better-sqlite3";

interface PreferenceInput {
  namespace?: string;
  key: string;
  valueJson: string;
  confidence?: string;
  source?: string;
}

export interface WorkflowPreferences {
  riskProfile?: string;
  timeHorizon?: string;
  assetScope?: string;
  positionCount?: number;
  maxSinglePositionPct?: number;
  dteTarget?: string;
  objective?: string;
  moneynessPreference?: string;
  liquidityMinimum?: string;
}

interface WorkflowRunInput {
  sessionId: string;
  workflowType: string;
  inputSlotsJson: string;
  resolvedSlotsJson: string;
  defaultsUsedJson: string;
  outputSummary?: string;
}

interface RecommendationInput {
  workflowRunId: number;
  recommendationType: string;
  symbol?: string;
  payloadJson?: string;
}

export class MemoryStorage {
  constructor(private readonly db: Database.Database) {}

  // --- Preferences ---

  upsertPreference(input: PreferenceInput): void {
    const now = new Date().toISOString();
    const ns = input.namespace ?? "global";
    const confidence = input.confidence ?? "medium";
    const source = input.source ?? "explicit";

    this.db
      .prepare(
        `INSERT INTO user_preferences (namespace, key, value_json, confidence, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(namespace, key) DO UPDATE SET
           value_json = excluded.value_json,
           confidence = excluded.confidence,
           source = excluded.source,
           updated_at = excluded.updated_at`,
      )
      .run(ns, input.key, input.valueJson, confidence, source, now, now);
  }

  getPreference(
    namespace: string,
    key: string,
  ): Record<string, string | number | null> | null {
    return (
      (this.db
        .prepare("SELECT * FROM user_preferences WHERE namespace = ? AND key = ?")
        .get(namespace, key) as Record<string, string | number | null>) ?? null
    );
  }

  getPreferencesByNamespace(
    namespace: string,
  ): Array<Record<string, string | number | null>> {
    return this.db
      .prepare("SELECT * FROM user_preferences WHERE namespace = ?")
      .all(namespace) as Array<Record<string, string | number | null>>;
  }

  getWorkflowPreferences(namespace: string = "global"): WorkflowPreferences {
    const prefs = this.getPreferencesByNamespace(namespace);
    const out: WorkflowPreferences = {};

    for (const pref of prefs) {
      const key = String(pref.key);
      const raw = pref.value_json == null ? undefined : safeParseJson(String(pref.value_json));

      switch (key) {
        case "risk_profile":
          if (typeof raw === "string") out.riskProfile = raw;
          break;
        case "time_horizon":
          if (typeof raw === "string") out.timeHorizon = raw;
          break;
        case "asset_scope":
          if (typeof raw === "string") out.assetScope = raw;
          break;
        case "position_count":
          if (typeof raw === "number") out.positionCount = raw;
          break;
        case "max_single_position_pct":
          if (typeof raw === "number") out.maxSinglePositionPct = raw;
          break;
        case "dte_target":
          if (typeof raw === "string") out.dteTarget = raw;
          break;
        case "objective":
          if (typeof raw === "string") out.objective = raw;
          break;
        case "moneyness_preference":
          if (typeof raw === "string") out.moneynessPreference = raw;
          break;
        case "options_liquidity":
        case "liquidity_minimum":
          if (typeof raw === "string") {
            out.liquidityMinimum =
              raw === "high" ? "high_open_interest_and_tight_spread" : raw;
          }
          break;
      }
    }

    return out;
  }

  // --- Workflow Runs ---

  insertWorkflowRun(input: WorkflowRunInput): number {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `INSERT INTO workflow_runs (session_id, workflow_type, input_slots_json, resolved_slots_json, defaults_used_json, output_summary, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.sessionId,
        input.workflowType,
        input.inputSlotsJson,
        input.resolvedSlotsJson,
        input.defaultsUsedJson,
        input.outputSummary ?? null,
        now,
      );
    return Number(result.lastInsertRowid);
  }

  getRecentWorkflowRuns(
    limit: number,
  ): Array<Record<string, string | number | null>> {
    return this.db
      .prepare("SELECT * FROM workflow_runs ORDER BY id DESC LIMIT ?")
      .all(limit) as Array<Record<string, string | number | null>>;
  }

  updateWorkflowRunOutputSummary(workflowRunId: number, outputSummary: string): void {
    this.db
      .prepare("UPDATE workflow_runs SET output_summary = ? WHERE id = ?")
      .run(outputSummary, workflowRunId);
  }

  // --- Recommendations ---

  insertRecommendation(input: RecommendationInput): number {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `INSERT INTO recommendations (workflow_run_id, recommendation_type, symbol, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        input.workflowRunId,
        input.recommendationType,
        input.symbol ?? null,
        input.payloadJson ?? null,
        now,
      );
    return Number(result.lastInsertRowid);
  }

  getRecommendationsByRun(
    workflowRunId: number,
  ): Array<Record<string, string | number | null>> {
    return this.db
      .prepare("SELECT * FROM recommendations WHERE workflow_run_id = ? ORDER BY id")
      .all(workflowRunId) as Array<Record<string, string | number | null>>;
  }
}

function safeParseJson(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return json;
  }
}
