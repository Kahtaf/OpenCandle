import type { EvidenceRecord } from "../runtime/evidence.js";
import type { PromptOutputValidation, PromptValidationContext } from "../runtime/prompt-step.js";

export interface PortfolioOutputConstraints {
  positionCount: number;
  maxSinglePositionPct: number;
}

interface AllocationRow {
  symbol: string;
  percent: number;
}

export function validatePortfolioOutput(
  rawText: string,
  constraints: PortfolioOutputConstraints,
): string[] {
  const rows = extractAllocationRows(rawText);
  const errors: string[] = [];

  if (rows.length !== constraints.positionCount) {
    errors.push(
      `allocation table has ${rows.length} positions; expected exactly ${constraints.positionCount}`,
    );
  }

  const compositeSymbols = rows.filter((row) => row.symbol.includes("/"));
  if (compositeSymbols.length > 0) {
    errors.push(
      `allocation rows must contain one holding each; composite symbols: ${compositeSymbols
        .map((row) => row.symbol)
        .join(", ")}`,
    );
  }

  const symbolCounts = new Map<string, number>();
  for (const row of rows) {
    const symbol = row.symbol.toUpperCase();
    symbolCounts.set(symbol, (symbolCounts.get(symbol) ?? 0) + 1);
  }
  const duplicateSymbols = [...symbolCounts]
    .filter(([, count]) => count > 1)
    .map(([symbol]) => symbol);
  if (duplicateSymbols.length > 0) {
    errors.push(`duplicate allocation symbols: ${duplicateSymbols.join(", ")}`);
  }

  const overCap = rows.filter((row) => row.percent > constraints.maxSinglePositionPct + 0.001);
  if (overCap.length > 0) {
    errors.push(
      `positions above the ${formatNumber(constraints.maxSinglePositionPct)}% cap: ${overCap
        .map((row) => `${row.symbol} ${formatNumber(row.percent)}%`)
        .join(", ")}`,
    );
  }

  const total = rows.reduce((sum, row) => sum + row.percent, 0);
  if (Math.abs(total - 100) > 0.05) {
    errors.push(`allocation percentages sum to ${formatNumber(total)}%; expected 100%`);
  }

  return errors;
}

export function buildPortfolioRepairPrompt(
  errors: string[],
  constraints: PortfolioOutputConstraints,
  assetScope: string,
): string {
  return `Your final portfolio table failed deterministic validation:
${errors.map((error) => `- ${error}`).join("\n")}

Revise the final portfolio draft now. Return a complete replacement allocation table with exactly ${constraints.positionCount} positions from the hard asset scope "${assetScope}", no position above ${formatNumber(constraints.maxSinglePositionPct)}%, and percentages that arithmetically sum to 100%. Recalculate dollar amounts and estimated shares from the corrected percentages. Do not claim validation passed until the displayed table satisfies every check. Do not make new tool calls.`;
}

export type PortfolioEvidenceStep = "fetch_candidates" | "risk_review";

export interface PortfolioEvidenceValidationOptions {
  step: PortfolioEvidenceStep;
  assetScope: string;
}

const PRICING_EVIDENCE_TOOLS = new Set([
  "get_stock_quote",
  "get_stock_history",
  "get_crypto_price",
  "get_crypto_history",
  "get_price_comparison",
]);

const STOCK_RISK_EVIDENCE_TOOLS = new Set(["analyze_risk", "analyze_correlation"]);
const CRYPTO_RISK_EVIDENCE_TOOLS = new Set([
  "analyze_risk",
  "analyze_correlation",
  "get_crypto_history",
]);

/**
 * Build an absent-evidence guard for one portfolio workflow step.
 *
 * The guard reads only the runtime's captured tool evidence — never the model's
 * prose — so a plausible draft written without completed tool calls cannot
 * advance. A failed guard consumes the coordinator's single repair budget with
 * a corrective tool-fetch prompt; if the retry still carries no usable
 * evidence the step fails and the run fails closed.
 */
export function createPortfolioEvidenceValidation(
  options: PortfolioEvidenceValidationOptions,
): PromptOutputValidation {
  const requiredTools =
    options.step === "fetch_candidates"
      ? PRICING_EVIDENCE_TOOLS
      : riskEvidenceTools(options.assetScope);

  return {
    validate(_rawText: string, context?: PromptValidationContext): string[] {
      // Pricing gathered in any completed step still prices the candidates,
      // but risk_review must run its own risk tools: crypto history doubles as
      // pricing and risk evidence, so a fetch_candidates history call must not
      // let the risk step pass without any risk-review tool call.
      const evidence =
        options.step === "fetch_candidates"
          ? [...(context?.currentEvidence ?? []), ...(context?.priorEvidence ?? [])]
          : (context?.currentEvidence ?? []);
      if (hasUsableToolEvidence(evidence, requiredTools)) return [];
      return [
        options.step === "fetch_candidates"
          ? "fetch_candidates produced no usable market price evidence from completed tool calls"
          : "risk_review produced no usable risk or correlation evidence from completed tool calls",
      ];
    },
    repairPrompt(errors: string[]): string {
      return buildPortfolioEvidenceRepairPrompt(errors, options);
    },
  };
}

function riskEvidenceTools(assetScope: string): Set<string> {
  return assetScope.toLowerCase().includes("crypto")
    ? CRYPTO_RISK_EVIDENCE_TOOLS
    : STOCK_RISK_EVIDENCE_TOOLS;
}

function hasUsableToolEvidence(evidence: EvidenceRecord[], tools: Set<string>): boolean {
  for (const record of evidence) {
    const value = isPlainRecord(record.value) ? record.value : undefined;
    if (!value) continue;
    // Error and unavailable tool results carry no market evidence.
    if (value.outcome !== "ok") continue;
    const tool = value.tool;
    if (typeof tool === "string" && tools.has(tool)) return true;
  }
  return false;
}

function buildPortfolioEvidenceRepairPrompt(
  errors: string[],
  options: PortfolioEvidenceValidationOptions,
): string {
  const scope = `"${options.assetScope}"`;
  const lines = [
    "Your previous response was not backed by captured market evidence:",
    ...errors.map((error) => `- ${error}`),
    "",
  ];
  if (options.step === "fetch_candidates") {
    lines.push(
      `Call get_stock_quote for the stock or ETF candidates now (use get_crypto_price for cryptocurrency candidates), then return the complete revised candidate selection. Base every price only on a successful tool result; if a price is unavailable, say so. Do not invent or fabricate prices, and keep the hard asset scope ${scope}.`,
    );
  } else {
    lines.push(
      `Call analyze_risk for the portfolio positions and analyze_correlation across the eligible positions now (use get_crypto_history for cryptocurrency positions instead of stock-only risk tools), then return the complete revised risk review. Do not invent or fabricate volatility, drawdown, or correlation numbers, and keep the hard asset scope ${scope}.`,
    );
  }
  return lines.join("\n");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractAllocationRows(rawText: string): AllocationRow[] {
  const rows: AllocationRow[] = [];
  for (const line of rawText.split("\n")) {
    const cells = line
      .split("|")
      .map((cell) => cell.trim())
      .filter(Boolean);
    if (cells.length < 2) continue;
    const symbol = cleanSymbolCell(cells[0]);
    const percentMatch = cleanMarkdown(cells[1]).match(/^(\d{1,3}(?:\.\d+)?)\s*%$/);
    if (!symbol || !percentMatch) continue;
    rows.push({ symbol, percent: Number(percentMatch[1]) });
  }
  return rows;
}

function cleanSymbolCell(value: string): string | undefined {
  const cleaned = cleanMarkdown(value);
  if (/^(?:symbol|ticker|total)$/i.test(cleaned)) return undefined;
  if (!/^[A-Z][A-Z0-9.-]{0,9}(?:\s*\/\s*[A-Z][A-Z0-9.-]{0,9})?$/.test(cleaned)) {
    return undefined;
  }
  return cleaned;
}

function cleanMarkdown(value: string): string {
  return value.replace(/[*_`]/g, "").trim();
}

function formatNumber(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}
