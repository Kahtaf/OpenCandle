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
import type { EvalTrace } from "../types.js";

const PASS_THRESHOLD = 0.8;

export function scoreProductEvalCase(
  evalCase: ProductEvalCase,
  trace: EvalTrace,
): ProductEvalCaseResult {
  const assertionDimensions = dimensionsFromAssertions(evalCase);
  const dimensions = [...assertionDimensions, ...evalCase.dimensions];
  const results = dimensions.map((dimension) => scoreDimension(dimension, trace));
  const totalWeight = results.reduce((sum, result) => sum + result.weight, 0);
  const weightedScore = totalWeight > 0
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

function scoreDimension(dimension: ProductEvalDimension, trace: EvalTrace): ProductDimensionResult {
  const text = getVisibleText(trace);
  const issues: string[] = [];

  if (dimension.expectedWorkflow && trace.classification.workflow !== dimension.expectedWorkflow) {
    issues.push(`expected workflow ${dimension.expectedWorkflow}, got ${trace.classification.workflow}`);
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

  for (const pattern of dimension.requiredPatterns ?? []) {
    if (!pattern.test(text)) {
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

function average(values: number[]): number {
  if (values.length === 0) return 1;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
