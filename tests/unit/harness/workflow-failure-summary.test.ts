import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import type { CustomEntryTrace } from "../../harness/types.js";
import {
  MAX_WORKFLOW_FAILURE_ERROR_CHARS,
  MAX_WORKFLOW_FAILURE_ERRORS_PER_ATTEMPT,
  MAX_WORKFLOW_FAILURE_EVENTS,
  readWorkflowFailureEvents,
  summarizeWorkflowFailure,
} from "../../harness/workflow-failure-summary.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop() as string, { recursive: true, force: true });
});

function entry(customType: string, data: unknown): CustomEntryTrace {
  return { customType, timestamp: "2026-09-25T00:00:00.000Z", data };
}

/** Session entries for a workflow whose step fails validation, repairs once, and fails again. */
function failedTwiceEntries(errors: string[] = ["no usable market price evidence"]) {
  return [
    entry("opencandle-workflow", { workflow: "portfolio_builder" }),
    entry("opencandle-workflow-event", {
      eventType: "output_validation_failed",
      stepType: "fetch_candidates",
      errors,
    }),
    entry("opencandle-workflow-event", {
      eventType: "output_validation_failed",
      stepType: "fetch_candidates",
      errors,
      repairAttempted: true,
    }),
    entry("opencandle-workflow-complete", { workflow: "portfolio_builder", status: "failed" }),
  ];
}

describe("summarizeWorkflowFailure", () => {
  it("records each validation attempt, its errors, the repair, and the terminal status", () => {
    const summary = summarizeWorkflowFailure({
      customEntries: failedTwiceEntries(),
      eventLog: [
        {
          runId: "run-1",
          stepIndex: 0,
          eventType: "step_failed",
          payloadJson: JSON.stringify({
            stepType: "fetch_candidates",
            error: "workflow_output_validation_failed: no usable market price evidence",
          }),
        },
      ],
    });

    expect(summary).toEqual({
      workflow: "portfolio_builder",
      terminalStatus: "failed",
      validationAttempts: [
        {
          step: "fetch_candidates",
          attempt: 1,
          repairAttempted: false,
          errors: ["no usable market price evidence"],
        },
        {
          step: "fetch_candidates",
          attempt: 2,
          repairAttempted: true,
          errors: ["no usable market price evidence"],
        },
      ],
      eventLogFailures: [
        {
          eventType: "step_failed",
          stepIndex: 0,
          step: "fetch_candidates",
          error: "workflow_output_validation_failed: no usable market price evidence",
        },
      ],
      truncated: false,
    });
  });

  it("keeps the terminal interruption reason", () => {
    const summary = summarizeWorkflowFailure({
      customEntries: [
        entry("opencandle-workflow", { workflow: "compare_assets" }),
        entry("opencandle-workflow-complete", {
          workflow: "compare_assets",
          status: "failed",
          reason: "session_shutdown",
        }),
      ],
    });
    expect(summary?.workflow).toBe("compare_assets");
    expect(summary?.terminalReason).toBe("session_shutdown");
    expect(summary?.validationAttempts).toEqual([]);
  });

  it("returns undefined for a completed workflow, even one that repaired a validation failure", () => {
    expect(summarizeWorkflowFailure({ customEntries: [] })).toBeUndefined();
    expect(
      summarizeWorkflowFailure({
        customEntries: [
          entry("opencandle-workflow", { workflow: "portfolio_builder" }),
          entry("opencandle-workflow-event", {
            eventType: "output_validation_failed",
            stepType: "fetch_candidates",
            errors: ["first draft missing evidence"],
          }),
          entry("opencandle-workflow-event", {
            eventType: "output_validation_passed",
            stepType: "fetch_candidates",
            repairAttempted: true,
          }),
          entry("opencandle-workflow-complete", {
            workflow: "portfolio_builder",
            status: "completed",
          }),
        ],
        eventLog: [{ runId: "r", stepIndex: 0, eventType: "step_completed", payloadJson: null }],
      }),
    ).toBeUndefined();
  });

  it("bounds attempts, errors per attempt, error length, and event-log rows", () => {
    const hugeErrors = Array.from({ length: 50 }, (_, index) => `${index}:${"x".repeat(5_000)}`);
    const customEntries: CustomEntryTrace[] = [
      entry("opencandle-workflow", { workflow: "portfolio_builder" }),
    ];
    for (let index = 0; index < 40; index += 1) {
      customEntries.push(
        entry("opencandle-workflow-event", {
          eventType: "output_validation_failed",
          stepType: `step_${index}`,
          errors: hugeErrors,
        }),
      );
    }
    customEntries.push(entry("opencandle-workflow-complete", { status: "failed" }));
    const eventLog = Array.from({ length: 40 }, (_, index) => ({
      runId: "run",
      stepIndex: index,
      eventType: "step_failed",
      payloadJson: JSON.stringify({ stepType: "s", error: "e".repeat(5_000) }),
    }));

    const summary = summarizeWorkflowFailure({ customEntries, eventLog });

    expect(summary?.truncated).toBe(true);
    expect(summary?.validationAttempts.length).toBe(MAX_WORKFLOW_FAILURE_EVENTS);
    expect(summary?.eventLogFailures.length).toBe(MAX_WORKFLOW_FAILURE_EVENTS);
    for (const attempt of summary?.validationAttempts ?? []) {
      expect(attempt.errors.length).toBe(MAX_WORKFLOW_FAILURE_ERRORS_PER_ATTEMPT);
      for (const error of attempt.errors) {
        expect(error.length).toBeLessThanOrEqual(MAX_WORKFLOW_FAILURE_ERROR_CHARS);
      }
    }
    for (const failure of summary?.eventLogFailures ?? []) {
      expect(failure.error?.length ?? 0).toBeLessThanOrEqual(MAX_WORKFLOW_FAILURE_ERROR_CHARS);
    }
    expect(JSON.stringify(summary).length).toBeLessThan(40_000);
  });

  it("redacts credentials in validation errors and event-log messages", () => {
    const credential = "sk-live-9f8e7d6c5b4a";
    const summary = summarizeWorkflowFailure({
      customEntries: failedTwiceEntries([
        `provider said api_key=${credential}`,
        `We have detected your API key as ${credential}.`,
      ]),
      eventLog: [
        {
          runId: "run",
          stepIndex: 0,
          eventType: "step_failed",
          payloadJson: JSON.stringify({ stepType: "s", error: `access_token=${credential}` }),
        },
      ],
    });
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain(credential);
    expect(serialized).toContain("[redacted]");
  });
});

describe("readWorkflowFailureEvents", () => {
  function makeDb(): string {
    const dir = mkdtempSync(join(tmpdir(), "oc-workflow-failure-db-"));
    tempDirs.push(dir);
    const path = join(dir, "state.db");
    const db = new Database(path);
    db.exec(
      `CREATE TABLE workflow_events (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL,
        step_index INTEGER NOT NULL, event_type TEXT NOT NULL, payload_json TEXT, timestamp TEXT NOT NULL)`,
    );
    const insert = db.prepare(
      "INSERT INTO workflow_events (run_id, step_index, event_type, payload_json, timestamp) VALUES (?, ?, ?, ?, ?)",
    );
    insert.run("run-1", 0, "step_started", '{"stepType":"fetch_candidates"}', "t1");
    insert.run("run-1", 0, "tool_called", '{"tool":"get_stock_quote"}', "t2");
    insert.run(
      "run-1",
      0,
      "step_failed",
      '{"stepType":"fetch_candidates","error":"workflow_output_validation_failed: missing"}',
      "t3",
    );
    db.close();
    return path;
  }

  it("reads only failure rows from the durable workflow event log", () => {
    expect(readWorkflowFailureEvents(makeDb())).toEqual([
      {
        runId: "run-1",
        stepIndex: 0,
        eventType: "step_failed",
        payloadJson:
          '{"stepType":"fetch_candidates","error":"workflow_output_validation_failed: missing"}',
      },
    ]);
  });

  it("returns no rows when the database or table is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "oc-workflow-failure-db-"));
    tempDirs.push(dir);
    expect(readWorkflowFailureEvents(join(dir, "absent.db"))).toEqual([]);
    const empty = join(dir, "empty.db");
    new Database(empty).close();
    expect(readWorkflowFailureEvents(empty)).toEqual([]);
  });
});
