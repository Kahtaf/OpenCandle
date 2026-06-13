import { runOpenCandleSession } from "../harness/opencandle-runner.js";
import type { EvalCase, EvalTrace } from "./types.js";

/**
 * Runs an eval case through the OpenCandle harness and returns the trace.
 */
export async function runEvalCase(evalCase: EvalCase): Promise<EvalTrace> {
  const result = await runOpenCandleSession({
    prompt: evalCase.prompt,
    scriptedAnswers: evalCase.answers,
    timeoutMs: 600_000,
  });
  return result.evalTrace;
}
