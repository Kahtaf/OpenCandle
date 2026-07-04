import type { EvalTrace } from "../types.js";
import type {
  ProductDimensionResult,
  ProductEvalCase,
  ProductEvalCaseResult,
  ProductEvalDimension,
  ProductEvalDimensionBucket,
  ProductEvalReport,
  ProductEvalSummaryBucket,
  PromptFamily,
} from "./types.js";

const PASS_THRESHOLD = 0.8;

export function scoreProductEvalCase(
  evalCase: ProductEvalCase,
  trace: EvalTrace,
): ProductEvalCaseResult {
  const assertionDimensions = dimensionsFromAssertions(evalCase);
  const dimensions = [...assertionDimensions, ...evalCase.dimensions];
  const results = dimensions.map((dimension) => scoreDimension(dimension, trace, evalCase));
  const totalWeight = results.reduce((sum, result) => sum + result.weight, 0);
  const weightedScore =
    totalWeight > 0
      ? results.reduce((sum, result) => sum + result.score * result.weight, 0) / totalWeight
      : 1;
  const mandatoryFailure = results.some((result) => result.mandatory && !result.passed);

  return {
    id: evalCase.id,
    family: evalCase.family,
    prompt: evalCase.prompt,
    score: weightedScore,
    passed: weightedScore >= PASS_THRESHOLD && !mandatoryFailure,
    mandatoryFailure,
    dimensions: results,
    trace,
  };
}

export function summarizeProductEvalResults(
  results: ProductEvalCaseResult[],
): Omit<ProductEvalReport, "generatedAt" | "results"> {
  const aggregate = average(results.map((result) => result.score));
  const byFamily: Partial<Record<PromptFamily, ProductEvalSummaryBucket>> = {};
  const byDimension: Record<string, ProductEvalDimensionBucket> = {};

  for (const result of results) {
    const bucket = byFamily[result.family] ?? { caseCount: 0, aggregate: 0, passed: 0, failed: 0 };
    const familyScores = results
      .filter((candidate) => candidate.family === result.family)
      .map((candidate) => candidate.score);
    bucket.caseCount += 1;
    bucket.aggregate = average(familyScores);
    if (result.passed) bucket.passed += 1;
    else bucket.failed += 1;
    byFamily[result.family] = bucket;

    for (const dimension of result.dimensions) {
      const dimensionBucket = byDimension[dimension.id] ?? { passed: 0, failed: 0 };
      if (dimension.passed) dimensionBucket.passed += 1;
      else dimensionBucket.failed += 1;
      byDimension[dimension.id] = dimensionBucket;
    }
  }

  return {
    caseCount: results.length,
    aggregate,
    passed: results.filter((result) => result.passed).length,
    failed: results.filter((result) => !result.passed).length,
    byFamily,
    byDimension,
  };
}

export function buildProductEvalReport(results: ProductEvalCaseResult[]): ProductEvalReport {
  return {
    generatedAt: new Date().toISOString(),
    ...summarizeProductEvalResults(results),
    results,
  };
}

function dimensionsFromAssertions(evalCase: ProductEvalCase): ProductEvalDimension[] {
  const dimensions: ProductEvalDimension[] = [];
  const assertions = evalCase.assertions;
  if (!assertions) return dimensions;

  if (assertions.expectedWorkflow) {
    dimensions.push({
      id: "workflow_fit",
      description: `Routes to ${assertions.expectedWorkflow}.`,
      expectedWorkflow: assertions.expectedWorkflow,
      mandatory: true,
      weight: 1,
    });
  }

  if (assertions.requiredTools?.length || assertions.forbiddenTools?.length) {
    dimensions.push({
      id: "tool_selection",
      description: "Uses required tools and avoids forbidden tools.",
      requiredToolNames: assertions.requiredTools,
      forbiddenToolNames: assertions.forbiddenTools,
      mandatory: true,
      weight: 1,
    });
  }

  return dimensions;
}

function scoreDimension(
  dimension: ProductEvalDimension,
  trace: EvalTrace,
  evalCase: ProductEvalCase,
): ProductDimensionResult {
  const text = getVisibleText(trace);
  const issues: string[] = [];

  if (dimension.expectedWorkflow && trace.classification.workflow !== dimension.expectedWorkflow) {
    issues.push(
      `expected workflow ${dimension.expectedWorkflow}, got ${trace.classification.workflow}`,
    );
  }

  for (const toolName of dimension.requiredToolNames ?? []) {
    if (!trace.toolCalls.some((call) => call.name === toolName)) {
      issues.push(`missing tool ${toolName}`);
    }
  }

  for (const toolName of dimension.forbiddenToolNames ?? []) {
    if (trace.toolCalls.some((call) => call.name === toolName)) {
      issues.push(`forbidden tool ${toolName}`);
    }
  }

  if (
    dimension.expectedAskUserCount !== undefined &&
    trace.askUserTranscript.length !== dimension.expectedAskUserCount
  ) {
    issues.push(
      `expected exactly ${dimension.expectedAskUserCount} ask_user calls, got ${trace.askUserTranscript.length}`,
    );
  }

  for (const pattern of dimension.askUserQuestionPatterns ?? []) {
    if (!trace.askUserTranscript.some((interaction) => pattern.test(interaction.question))) {
      issues.push(`missing ask_user question pattern ${pattern}`);
    }
  }

  const resolvedSymbols = traceResolvedSymbols(trace);
  for (const symbol of dimension.requiredResolvedSymbols ?? []) {
    if (!resolvedSymbols.has(symbol.toUpperCase())) {
      issues.push(`missing resolved symbol ${symbol}`);
    }
  }

  for (const symbol of dimension.forbiddenResolvedSymbols ?? []) {
    if (resolvedSymbols.has(symbol.toUpperCase())) {
      issues.push(`forbidden resolved symbol ${symbol}`);
    }
  }

  for (const pattern of dimension.requiredPatterns ?? []) {
    if (!pattern.test(text) && !passesFamilyAwareDimension(dimension.id, evalCase, trace, text)) {
      issues.push(`missing pattern ${pattern}`);
    }
  }

  for (const pattern of dimension.forbiddenPatterns ?? []) {
    if (pattern.test(text)) {
      issues.push(`forbidden pattern ${pattern}`);
    }
  }

  return {
    id: dimension.id,
    description: dimension.description,
    passed: issues.length === 0,
    score: issues.length === 0 ? 1 : 0,
    weight: dimension.weight ?? 1,
    mandatory: dimension.mandatory ?? false,
    message: issues.length > 0 ? issues.join("; ") : "passed",
  };
}

function passesFamilyAwareDimension(
  dimensionId: string,
  evalCase: ProductEvalCase,
  trace: EvalTrace,
  text: string,
): boolean {
  if (dimensionId === "direct_answer" && evalCase.family === "portfolio") {
    return (
      trace.classification.workflow === "portfolio_builder" &&
      /\|\s*symbol\s*\|/i.test(text) &&
      /\|\s*[^|\n]+\s*\|\s*\d+(?:\.\d+)?\s*%\s*\|\s*\$\s?\d/i.test(text)
    );
  }
  if (dimensionId === "horizon_fit" && evalCase.family === "portfolio") {
    return (
      /why this fits the horizon|time horizon|horizon/i.test(text) &&
      /\b(?:asset class|fixed income|equity|stability|growth|downside|drawdown|inflation|shorter timeframes?)\b/i.test(
        text,
      )
    );
  }
  if (dimensionId === "horizon_fit" && evalCase.family === "options") {
    return /\b(?:\d+\s*DTE|\d+\s*days?[\s),-]+to\s+(?:expiry|expiration)|expir(?:y|ation).{0,40}\d+\s*days?|25\s*[-–]\s*45\s*days?|roughly\s+one\s+month)\b/i.test(
      text,
    );
  }
  if (dimensionId === "risk_framing" && evalCase.family === "sentiment") {
    return (
      /\b(?:missing sources?|source coverage|no sources returned|unavailable)\b/i.test(text) &&
      /\b(?:confidence|downgrade|limited|comprehensive|reliable)\b/i.test(text)
    );
  }
  return false;
}

function getVisibleText(trace: EvalTrace): string {
  const customText = trace.customEntries
    ?.map((entry) => {
      const data = entry.data;
      if (isRecord(data) && typeof data.text === "string") return data.text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
  return customText ? `${trace.text}\n${customText}` : trace.text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function traceResolvedSymbols(trace: EvalTrace): Set<string> {
  const symbols = new Set<string>();
  for (const symbol of trace.classification.entities.symbols ?? []) {
    symbols.add(symbol.toUpperCase());
  }
  for (const call of trace.toolCalls) {
    collectSymbols(call.args, symbols);
  }
  return symbols;
}

function collectSymbols(value: unknown, symbols: Set<string>): void {
  if (typeof value === "string") {
    if (/^[A-Z][A-Z0-9.-]{0,9}$/.test(value)) symbols.add(value.toUpperCase());
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectSymbols(item, symbols);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, item] of Object.entries(value)) {
    if (/symbol/i.test(key)) collectSymbols(item, symbols);
  }
}

function average(values: number[]): number {
  if (values.length === 0) return 1;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
