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
  const failedDimensions = results.filter((result) => !result.passed);
  const mandatoryFailure = failedDimensions.some((result) => result.mandatory);

  return {
    id: evalCase.id,
    family: evalCase.family,
    prompt: evalCase.prompt,
    score: weightedScore,
    // Every emitted dimension must pass: a non-mandatory dimension (for
    // example evidence_use or missing_data_honesty) can fail while the weighted
    // score still clears the threshold, and that partial failure must block.
    // `mandatoryFailure` is retained as the diagnostic subtype.
    passed: weightedScore >= PASS_THRESHOLD && failedDimensions.length === 0,
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

  for (const check of dimension.requiredTextChecks ?? []) {
    if (!check.test(text) && !passesFamilyAwareDimension(dimension.id, evalCase, trace, text)) {
      issues.push(`missing ${check.name}`);
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
  if (dimensionId === "missing_data_honesty") {
    return !trace.toolCalls.some(toolCallIsUnavailable);
  }
  if (dimensionId === "direct_answer" && evalCase.family === "compare_assets") {
    return /\b(?:preferred|more suitable|less suitable|more attractive|less attractive|more resilient|less resilient|better hedge|stronger choice|weaker choice|positioned as|favou?rs?|outperforms?|better suited)\b/i.test(
      text,
    );
  }
  if (dimensionId === "direct_answer" && evalCase.family === "macro") {
    return /\b(?:most significant|primary risks?|positive impact|negative impact|benefits?|hurts?|pressures?|supports?|tailwind|headwind)\b/i.test(
      text,
    );
  }
  if (dimensionId === "direct_answer" && evalCase.family === "sentiment") {
    return /\b(?:bullish|bearish|neutral|mixed|positive|negative)\b/i.test(text);
  }
  if (
    dimensionId === "direct_answer" &&
    evalCase.family === "single_asset" &&
    /bull and bear case|bull[- ]bear/i.test(evalCase.prompt)
  ) {
    return (
      /\bbull case\b/i.test(text) &&
      /\bbear case\b/i.test(text) &&
      /\b(?:change(?:s|d)? (?:my|the) (?:mind|thesis)|what would change|invalidation|thesis changes?)\b/i.test(
        text,
      )
    );
  }
  if (dimensionId === "direct_answer" && evalCase.family === "portfolio") {
    return (
      trace.classification.workflow === "portfolio_builder" &&
      /\|\s*(?:symbol|ticker|holding|fund|etf)\s*\|/i.test(text) &&
      /\|\s*[^|\n]+\s*\|\s*\d+(?:\.\d+)?\s*%\s*\|(?:\s*\$\s?[\d,]+\s*\|)?/i.test(text)
    );
  }
  if (dimensionId === "horizon_fit" && evalCase.family === "portfolio") {
    return (
      /why this fits the horizon|time horizon|horizon|\b\d+[- ]years?\b|\b(?:three|five|ten)[- ]years?\b/i.test(
        text,
      ) &&
      /\b(?:asset class|fixed income|equity|stability|growth|income|yield|capital preservation|duration|downside|drawdown|inflation|shorter timeframes?)\b/i.test(
        text,
      )
    );
  }
  if (dimensionId === "horizon_fit" && evalCase.family === "options") {
    return /\b(?:\d+\s*DTE|DTE\s*:?[\s|]*\d+|DTE\s+window\s*:\s*25\s+(?:to|[-–])\s+45\s+days?|\d+\s*days?[\s),-]+to\s+(?:expiry|expiration)|expir(?:y|ation).{0,40}\d+\s*days?|(?:2[5-9]|3\d|4[0-5])[- ]day|25\s*(?:to|[-–])\s*45\s*days?|roughly\s+one\s+month)\b/i.test(
      text,
    );
  }
  if (
    dimensionId === "horizon_fit" &&
    evalCase.family === "compare_assets" &&
    trace.classification.entities.compareMetrics?.includes("macro_hedge")
  ) {
    return /\b(?:macro hedge|inflation|real yields?|usd|dollar|liquidity|risk[- ]?off|debasement|geopolitical|stagflation)\b/i.test(
      text,
    );
  }
  if (dimensionId === "risk_framing" && evalCase.family === "sentiment") {
    return (
      (/\b(?:missing sources?|source coverage|no sources returned|unavailable)\b/i.test(text) &&
        /\b(?:confidence|downgrade|limited|comprehensive|reliable)\b/i.test(text)) ||
      (/\b(?:missing sources?|unavailable)\b/i.test(text) &&
        /\b(?:gap|impact)\b.{0,80}\b(?:picture|signal|insights?)\b/i.test(text)) ||
      missingSourceDivergence(text) ||
      sentimentDataQualityRisk(text)
    );
  }
  if (dimensionId === "risk_framing" && evalCase.family === "macro") {
    return (
      /\bcommon traps?\b/i.test(text) ||
      /\b(?:recession|downturn|stubborn inflation)\b.{0,120}\b(?:offset|hurt|underperform|muted|declin)/i.test(
        text,
      )
    );
  }
  return false;
}

// A concrete data-quality limitation is itself sentiment risk: an unreliable
// read still needs to be owned when every source returned. Canonical concepts
// are noisy sentiment/data/signal, sparse coverage or sample, low sample count,
// insufficient data, and a sample/evidence set that is not representative. Each
// limitation is bound to a sentiment context and rejected when it sits under a
// clause-local negation ("the signal is not particularly noisy", "no insufficient
// data or sparse coverage"). "not representative" is itself the risk statement,
// so it is deliberately kept outside the negation filter. Missing-source impact
// is handled separately by missingSourceDivergence.
function sentimentDataQualityRisk(text: string): boolean {
  if (
    /\b(?:sample|evidence|data|sources?|read|signal|sentiment)\b[^.;!?\n]{0,80}?\b(?:not|isn't|aren't)\s+(?:be\s+)?(?:fully\s+)?representative\b/i.test(
      text,
    )
  ) {
    return true;
  }
  return (
    hasNoisySentimentRisk(text) ||
    hasUnnegatedMatch(text, /\b(?:sparse|thin|limited)\s+(?:coverage|sample|data|sources?)\b/gi) ||
    hasUnnegatedMatch(text, /\b(?:low|small|limited)\s+sample\s+(?:count|size)\b/gi) ||
    hasUnnegatedMatch(text, /\binsufficient\s+(?:data|sample|coverage|evidence)\b/gi)
  );
}

function hasNoisySentimentRisk(text: string): boolean {
  for (const match of text.matchAll(/\b(?:noisy|noise)\b/gi)) {
    const index = match.index;
    if (index === undefined || limitationNegated(text, index)) continue;
    const { start, end } = clauseBounds(text, index);
    if (/\b(?:sentiment|signal|sample|sources?|data|read)\b/i.test(text.slice(start, end))) {
      return true;
    }
  }
  return false;
}

function hasUnnegatedMatch(text: string, pattern: RegExp): boolean {
  for (const match of text.matchAll(pattern)) {
    if (match.index !== undefined && !limitationNegated(text, match.index)) return true;
  }
  return false;
}

const DATA_QUALITY_MODIFIERS =
  "(?:(?:particularly|especially|really|very|entirely|fully|completely|necessarily|actually)\\s+)*";
const DATA_QUALITY_LIMITATION =
  "(?:noisy|noise|sparse\\s+(?:coverage|sample|data|sources?)|thin\\s+(?:coverage|sample|data|sources?)|limited\\s+(?:coverage|sample|data|sources?)|(?:low|small)\\s+sample\\s+(?:count|size)|insufficient\\s+(?:data|sample|coverage|evidence))";

// Negation is limitation-local: only a negation directly attached to the
// limitation (optionally through a bounded be/have auxiliary and a small
// modifier set) counts, plus a bounded coordinated denial such as "no
// insufficient data or sparse coverage". An unrelated clause negation
// ("not reliable because of sparse coverage", "do not trust the noisy signal")
// is not suppression.
function limitationNegated(text: string, anchorIndex: number): boolean {
  const { start } = clauseBounds(text, anchorIndex);
  const before = text.slice(start, anchorIndex);
  const negation =
    "(?:\\b(?:no|not|never|without|nor|neither|cannot)\\b|\\b(?:isn't|aren't|wasn't|weren't|doesn't|don't|didn't|can't|won't|wouldn't|shouldn't|couldn't|mustn't|hasn't|haven't)\\b)";
  const auxiliary = "(?:(?:be|have)\\s+)?";
  const directlyAttached = new RegExp(
    `^.*${negation}\\s+${auxiliary}${DATA_QUALITY_MODIFIERS}(?:the\\s+)?$`,
    "i",
  ).test(before);
  if (directlyAttached) return true;
  return new RegExp(
    `${negation}\\s+${auxiliary}${DATA_QUALITY_MODIFIERS}${DATA_QUALITY_LIMITATION}(?:\\s+(?:or|nor|and)\\s+${DATA_QUALITY_LIMITATION})*\\s+(?:or|nor|and)\\s+$`,
    "i",
  ).test(before);
}

function clauseBounds(text: string, index: number): { start: number; end: number } {
  let start = 0;
  for (let i = index - 1; i >= 0; i -= 1) {
    if (".;!?,\n".includes(text[i])) {
      start = i + 1;
      break;
    }
  }
  let end = text.length;
  for (let i = index; i < text.length; i += 1) {
    if (".;!?,\n".includes(text[i])) {
      end = i;
      break;
    }
  }
  return { start, end };
}

// A missing source is risk framing only when the answer also explains the gap's
// effect: the sentiment/signal/sample/data/source read can differ from the other
// sources that did return. The divergence must name a sentiment subject and a
// real "other/available/remaining sources" comparison, so an unrelated
// difference clause plus a bare "source unavailable" note does not qualify.
function missingSourceDivergence(text: string): boolean {
  if (!/\b(?:missing sources?|unavailable|no sources returned)\b/i.test(text)) return false;
  return /\b(?:sentiment|signal|sample|data|sources?)\b[^.!?]{0,80}\b(?:may|might|could|can|would)\s+(?:differ|diverge|vary)\s+from\b[^.!?]{0,30}\b(?:other|available|remaining)\s+sources?\b/i.test(
    text,
  );
}

function toolCallIsUnavailable(call: EvalTrace["toolCalls"][number]): boolean {
  if (call.isError === true) return true;
  if (!isRecord(call.result)) return false;
  const status = typeof call.result.status === "string" ? call.result.status.toLowerCase() : "";
  return ["error", "failed", "unavailable", "rate_limited", "timed_out"].includes(status);
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
