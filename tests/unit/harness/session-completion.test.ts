import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertSessionCompleted } from "../../harness/session-completion.js";
import type { AgentTrace, TerminalStopReason } from "../../harness/types.js";

/** A good earlier answer or disclaimer must never mask an unfinished final turn. */
describe("shared live-eval completion boundary", () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "oc-completion-proof-"));
    vi.spyOn(process, "cwd").mockReturnValue(directory);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(directory, { recursive: true, force: true });
  });

  function trace(stopReason: TerminalStopReason): AgentTrace {
    return {
      prompt: "Explain uncertainty",
      turns: [],
      interactions: [],
      finalText: "A complete earlier answer. This is not financial advice.",
      toolSequence: [],
      durationMs: 1,
      terminalOutcome: { stopReason, errorPresent: stopReason === "aborted", textEmpty: false },
    };
  }

  it.each(["aborted", "length", "toolUse", "pending"] as const)(
    "blocks %s even when earlier visible text could satisfy an answer scorer",
    (reason) => {
      expect(() => assertSessionCompleted(trace(reason))).toThrow("did not complete");
    },
  );

  it("accepts a completed answer", () => {
    expect(() => assertSessionCompleted(trace("stop"))).not.toThrow();
  });

  it("blocks a failed workflow even when its final assistant message is complete", () => {
    const failed = trace("stop");
    failed.customEntries = [
      {
        customType: "opencandle-workflow-complete",
        timestamp: "2026-01-01",
        data: { status: "failed" },
      },
    ];
    expect(() => assertSessionCompleted(failed)).toThrow("workflow_failed");
  });

  function diagnosticFrom(error: unknown): Record<string, unknown> {
    const match = /Diagnostic: (.+)$/.exec(error instanceof Error ? error.message : "");
    expect(match).not.toBeNull();
    return JSON.parse(readFileSync(match?.[1] as string, "utf-8")) as Record<string, unknown>;
  }

  function thrownBy(fn: () => void): unknown {
    try {
      fn();
    } catch (error) {
      return error;
    }
    throw new Error("expected a session-completion failure");
  }

  it("records why a failed workflow failed: each validation attempt and its errors", () => {
    const failed = trace("stop");
    failed.customEntries = [
      {
        customType: "opencandle-workflow",
        timestamp: "2026-01-01",
        data: { workflow: "portfolio_builder" },
      },
      {
        customType: "opencandle-workflow-event",
        timestamp: "2026-01-01",
        data: {
          eventType: "output_validation_failed",
          stepType: "fetch_candidates",
          errors: ["no usable market price evidence"],
        },
      },
      {
        customType: "opencandle-workflow-event",
        timestamp: "2026-01-01",
        data: {
          eventType: "output_validation_failed",
          stepType: "fetch_candidates",
          errors: ["still no usable market price evidence"],
          repairAttempted: true,
        },
      },
      {
        customType: "opencandle-workflow-complete",
        timestamp: "2026-01-01",
        data: { workflow: "portfolio_builder", status: "failed" },
      },
    ];

    const diagnostic = diagnosticFrom(thrownBy(() => assertSessionCompleted(failed)));

    expect(diagnostic.reason).toBe("workflow_failed");
    expect(diagnostic.workflowFailure).toMatchObject({
      workflow: "portfolio_builder",
      terminalStatus: "failed",
      validationAttempts: [
        { step: "fetch_candidates", attempt: 1, repairAttempted: false },
        { step: "fetch_candidates", attempt: 2, repairAttempted: true },
      ],
    });
    expect(JSON.stringify(diagnostic)).toContain("still no usable market price evidence");
    // Raw session entries are never dumped into the diagnostic.
    expect(JSON.stringify(diagnostic)).not.toContain("opencandle-workflow-event");
  });

  it("prefers the runner's summary, which includes the durable event log", () => {
    const failed = trace("stop");
    failed.customEntries = [
      {
        customType: "opencandle-workflow-complete",
        timestamp: "2026-01-01",
        data: { status: "failed" },
      },
    ];
    failed.workflowFailure = {
      terminalStatus: "failed",
      validationAttempts: [],
      eventLogFailures: [{ eventType: "step_failed", stepIndex: 1, step: "x", error: "boom" }],
      truncated: false,
    };

    const diagnostic = diagnosticFrom(thrownBy(() => assertSessionCompleted(failed)));

    expect(diagnostic.workflowFailure).toEqual(failed.workflowFailure);
  });

  it("leaves non-workflow completion diagnostics unchanged", () => {
    const diagnostic = diagnosticFrom(thrownBy(() => assertSessionCompleted(trace("aborted"))));
    expect(Object.keys(diagnostic).sort()).toEqual(["reason", "retryEvents", "terminalOutcome"]);
  });

  it("cannot borrow a previous prompt's terminal outcome", () => {
    const incomplete = trace("stop");
    delete incomplete.terminalOutcome;
    expect(() => assertSessionCompleted(incomplete)).toThrow("missing_terminal_outcome");
  });
});
