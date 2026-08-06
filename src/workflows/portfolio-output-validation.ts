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
