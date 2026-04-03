import type { EvalTrace, LayerDetail } from "../types.js";

interface WorkflowExpectation {
  /** Tool names that must appear in order (subset matching). */
  expectedSequence?: string[];
  /** Minimum number of distinct tools called. */
  minToolCount?: number;
  /** Expected number of ask_user interactions. */
  expectedAskUserCount?: number;
}

/**
 * Score trajectory matching: did the agent follow the expected workflow steps?
 */
export function scoreTrajectory(
  trace: EvalTrace,
  expectations: WorkflowExpectation,
): LayerDetail {
  const issues: string[] = [];
  let checks = 0;
  let passed = 0;

  // Sequence check: expected tools appear in order (not necessarily contiguous)
  if (expectations.expectedSequence) {
    checks++;
    const actualNames = trace.toolCalls.map((tc) => tc.name);
    let seqIdx = 0;
    for (const name of actualNames) {
      if (seqIdx < expectations.expectedSequence.length && name === expectations.expectedSequence[seqIdx]) {
        seqIdx++;
      }
    }
    if (seqIdx === expectations.expectedSequence.length) {
      passed++;
    } else {
      issues.push(
        `Expected sequence ${expectations.expectedSequence.join(" → ")}, reached step ${seqIdx}/${expectations.expectedSequence.length}`,
      );
    }
  }

  // Min tool count
  if (expectations.minToolCount !== undefined) {
    checks++;
    const distinctTools = new Set(trace.toolCalls.map((tc) => tc.name)).size;
    if (distinctTools >= expectations.minToolCount) {
      passed++;
    } else {
      issues.push(`Expected ≥${expectations.minToolCount} distinct tools, got ${distinctTools}`);
    }
  }

  // Ask-user count
  if (expectations.expectedAskUserCount !== undefined) {
    checks++;
    if (trace.askUserTranscript.length >= expectations.expectedAskUserCount) {
      passed++;
    } else {
      issues.push(
        `Expected ≥${expectations.expectedAskUserCount} ask_user calls, got ${trace.askUserTranscript.length}`,
      );
    }
  }

  const score = checks > 0 ? passed / checks : 1.0;
  return {
    passed: issues.length === 0,
    score,
    message: issues.length > 0 ? issues.join("; ") : "Trajectory checks passed",
  };
}

/**
 * Combined E2E workflow scorer: trajectory + optional LLM quality assessment.
 */
export async function scoreE2EWorkflow(
  trace: EvalTrace,
  expectations: WorkflowExpectation,
  judgeFn?: (prompt: string) => Promise<string>,
): Promise<LayerDetail> {
  const trajectory = scoreTrajectory(trace, expectations);

  if (!judgeFn) {
    return trajectory;
  }

  // LLM quality assessment of the final output
  const qualityPrompt = `You are evaluating the quality of a financial agent's complete workflow output.

## Agent Output

${trace.text}

## Evaluation Criteria

1. Is the output comprehensive (covers multiple dimensions of analysis)?
2. Is the output well-structured and easy to follow?
3. Does the output provide actionable insights?

Score: Answer with exactly one word: PASS or FAIL.`;

  let qualityScore = 0;
  const runs = 3;
  for (let i = 0; i < runs; i++) {
    const response = await judgeFn(qualityPrompt);
    if (response.trim().toUpperCase().startsWith("PASS")) {
      qualityScore++;
    }
  }
  const qualityPassed = qualityScore > runs / 2;

  // Combine: 60% trajectory, 40% quality
  const combined = trajectory.score * 0.6 + (qualityPassed ? 1 : 0) * 0.4;

  return {
    passed: trajectory.passed && qualityPassed,
    score: combined,
    message: `Trajectory: ${trajectory.message} | Quality: ${qualityPassed ? "PASS" : "FAIL"}`,
  };
}
