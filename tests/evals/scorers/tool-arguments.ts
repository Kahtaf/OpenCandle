import type { EvalTrace, LayerDetail } from "../types.js";

export function scoreToolArguments(
  trace: EvalTrace,
  requiredArgs: Record<string, Record<string, unknown>>,
): LayerDetail {
  const issues: string[] = [];
  let checks = 0;
  let passed = 0;

  for (const [toolName, expectedArgs] of Object.entries(requiredArgs)) {
    const calls = trace.toolCalls.filter((tc) => tc.name === toolName);
    if (calls.length === 0) {
      for (const key of Object.keys(expectedArgs)) {
        checks++;
        issues.push(`${toolName} not called, missing arg ${key}`);
      }
      continue;
    }

    for (const [key, expectedValue] of Object.entries(expectedArgs)) {
      checks++;
      const match = calls.some((call) => {
        const args = call.args as Record<string, unknown>;
        return JSON.stringify(args[key]) === JSON.stringify(expectedValue);
      });
      if (match) {
        passed++;
      } else {
        issues.push(`${toolName}.${key}: expected ${JSON.stringify(expectedValue)}`);
      }
    }
  }

  const score = checks > 0 ? passed / checks : 1.0;
  return {
    passed: issues.length === 0,
    score,
    message: issues.length > 0 ? issues.join("; ") : "All argument checks passed",
  };
}
