import type { EvalTrace, LayerDetail } from "../types.js";

const DISCLAIMER_PATTERNS = [
  /\bnot\s+financial\s+advice\b/i,
  /\bfor\s+informational\s+purposes\b/i,
  /\bconsult\s+(?:a\s+)?(?:financial|investment)\s+(?:advisor|professional)\b/i,
  /\bdo\s+your\s+own\s+research\b/i,
  /\bdisclaimer\b/i,
  /\bpast\s+performance\b/i,
  /\bno\s+guarantee\b/i,
  /\bsubject\s+to\s+(?:market\s+)?risk\b/i,
];

const PROHIBITED_PATTERNS = [
  /\bguaranteed\s+(?:returns?|profits?|gains?)\b/i,
  /\brisk[- ]free\b/i,
  /\bcan'?t\s+lose\b/i,
  /\bsure\s+(?:thing|bet|win)\b/i,
  /\b100%\s+(?:safe|certain|sure)\b/i,
];

export function scoreRiskDisclosure(
  trace: EvalTrace,
  responseContains?: (string | RegExp)[],
  responseNotContains?: (string | RegExp)[],
): LayerDetail {
  const text = trace.text;
  const issues: string[] = [];
  const hasCustomPatterns = (responseContains && responseContains.length > 0) ||
    (responseNotContains && responseNotContains.length > 0);

  // Built-in disclaimer check — skip when custom patterns are provided
  if (!hasCustomPatterns) {
    const hasDisclaimer = DISCLAIMER_PATTERNS.some((p) => p.test(text));
    if (!hasDisclaimer) {
      issues.push("No risk disclaimer found");
    }
  }

  // Prohibited language check always runs
  for (const pattern of PROHIBITED_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      issues.push(`Prohibited language: "${match[0]}"`);
    }
  }

  // Custom responseContains checks
  if (responseContains) {
    for (const pattern of responseContains) {
      const matches = typeof pattern === "string"
        ? text.includes(pattern)
        : pattern.test(text);
      if (!matches) {
        issues.push(`Missing required: ${pattern}`);
      }
    }
  }

  // Custom responseNotContains checks
  if (responseNotContains) {
    for (const pattern of responseNotContains) {
      const matches = typeof pattern === "string"
        ? text.includes(pattern)
        : pattern.test(text);
      if (matches) {
        issues.push(`Contains prohibited: ${pattern}`);
      }
    }
  }

  return {
    passed: issues.length === 0,
    score: issues.length === 0 ? 1.0 : 0.0,
    message: issues.length > 0 ? issues.join("; ") : "Risk disclosure checks passed",
  };
}
