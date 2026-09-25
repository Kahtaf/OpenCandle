import { mkdtempSync, rmSync } from "node:fs";
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

  it("cannot borrow a previous prompt's terminal outcome", () => {
    const incomplete = trace("stop");
    delete incomplete.terminalOutcome;
    expect(() => assertSessionCompleted(incomplete)).toThrow("missing_terminal_outcome");
  });
});
