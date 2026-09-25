import type { PromptOutputValidation } from "../runtime/prompt-step.js";

const STANDARD_MULTIPLIER = 100;
const SIZING_HEADERS = ["put contracts", "covered shares", "uncovered shares", "excess shares"];
const COST_HEADERS = [
  "option",
  "put contracts",
  "premium per share",
  "total premium",
  "stock mark",
  "premium % of owned position",
];
const UNAVAILABLE = "Premium percentage unavailable:";

/** Conditional standard-contract arithmetic, never a claim about an adjusted option. */
export function protectivePutCoverage(ownedShares: number) {
  if (!Number.isFinite(ownedShares) || ownedShares <= 0)
    throw new Error("Owned shares must be positive and finite");
  return [
    ...new Set([
      Math.floor(ownedShares / STANDARD_MULTIPLIER),
      Math.ceil(ownedShares / STANDARD_MULTIPLIER),
    ]),
  ].map((contracts) => ({
    contracts,
    covered: contracts * STANDARD_MULTIPLIER,
    uncovered: Math.max(0, ownedShares - contracts * STANDARD_MULTIPLIER),
    excess: Math.max(0, contracts * STANDARD_MULTIPLIER - ownedShares),
  }));
}

export function buildProtectivePutSizingContract(ownedShares: number): string {
  const rows = protectivePutCoverage(ownedShares);
  return `Position sizing and cost contract:
Include this standard-contract illustration in the final answer. It is conditional, not proof of the selected option's actual multiplier; adjusted contracts can differ. Verify the actual multiplier with a broker before trading.
Standard-contract illustration: assuming 100 shares per put contract.
Owned position: ${ownedShares} shares.
| Put contracts | Covered shares | Uncovered shares | Excess shares |
| --- | --- | --- | --- |
${rows.map((row) => `| ${row.contracts} puts | ${row.covered} shares | ${row.uncovered} shares | ${row.excess} shares |`).join("\n")}
Explain that uncovered shares remain exposed and excess shares represent surplus long-put exposure, not additional stock owned. Do not claim a single numerical floor for the whole position when coverage differs; describe the strike sell right for covered shares and premium cost separately.
State total premium for the required number of contracts. Total premium = put contracts × 100 × premium per share. Premium as a percent of position value = total premium / (${ownedShares} owned shares × stock mark) × 100, never divided by rounded contract coverage.
If numerical premium percentages are shown, use this separate calculation table with one row for each quoted calculation, and retain these column names:
| Option | Put contracts | Premium per share | Total premium | Stock mark | Premium % of owned position |
| --- | --- | --- | --- | --- | --- |
Identify each option by strike and expiry or a matching row label from the ranked contracts. Display total premium and premium percentage to two decimal places.
Use only dated tool evidence for prices; the arithmetic check does not verify market authenticity. Identify indicative/historical prices as such, never executable quotes. Do not repeat numerical premium percentages in prose or other tables. Other metrics such as IV may still use percentages.
If reliable premium/stock-mark inputs are unavailable, omit the cost table and numerical premium percentages. Instead state "${UNAVAILABLE}" followed by the missing evidence; still provide sizing, qualitative cost tradeoffs and broker-verification conditions.`;
}

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim().replace(/\*\*|__/g, ""));
}
function number(cell: string | undefined): number {
  if (!cell) return NaN;
  const value = cell
    .replace(/^\$/, "")
    .replace(/\s*(?:puts?|shares?|%)$/i, "")
    .trim();
  return /^(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)(?:\.\d+)?$/.test(value)
    ? Number(value.replace(/,/g, ""))
    : NaN;
}
function same(actual: number, expected: number, tolerance = 0.000001): boolean {
  return Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
}

/** Validates the deliberately bounded displayed tables; it is not a prose financial parser. */
export function validateProtectivePutOutput(text: string, ownedShares: number): string[] {
  const expected = protectivePutCoverage(ownedShares);
  const errors: string[] = [];
  const lines = text.split("\n");
  let sizingTables = 0;
  let costTables = 0;
  const costLineIndexes = new Set<number>();

  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].includes("|")) continue;
    const headers = cells(lines[index]).map((value) => value.toLowerCase());
    const sizing = SIZING_HEADERS.every((header) => headers.includes(header));
    const cost = COST_HEADERS.every((header) => headers.includes(header));
    if (!sizing && !cost) {
      if (headers.some((header) => /premium.*(?:%|percent)|(?:%|percent).*premium/.test(header)))
        errors.push(
          "Numerical premium percentages must use the complete premium calculation table",
        );
      continue;
    }
    if (sizing) sizingTables += 1;
    if (cost) costTables += 1;
    const observedContracts: number[] = [];
    let rowCount = 0;
    for (
      let rowIndex = index + 1;
      rowIndex < lines.length && lines[rowIndex].includes("|");
      rowIndex += 1
    ) {
      const row = cells(lines[rowIndex]);
      if (row.every((value) => /^:?-+:?$/.test(value))) continue;
      rowCount += 1;
      if (cost) costLineIndexes.add(rowIndex);
      const value = (header: string) => number(row[headers.indexOf(header)]);
      const contracts = value("put contracts");
      const coverage = expected.find((choice) => choice.contracts === contracts);
      if (!Number.isInteger(contracts) || !coverage) {
        errors.push(
          "Put contracts must be one of the whole-contract coverage choices for the owned position",
        );
        continue;
      }
      observedContracts.push(contracts);
      if (
        sizing &&
        (!same(value("covered shares"), coverage.covered) ||
          !same(value("uncovered shares"), coverage.uncovered) ||
          !same(value("excess shares"), coverage.excess))
      )
        errors.push(
          "Covered, uncovered or excess shares do not reconcile with the actual owned quantity",
        );
      if (cost) {
        if (!row[headers.indexOf("option")]?.trim())
          errors.push("Identify the option for each premium calculation row");
        const premium = value("premium per share");
        const total = value("total premium");
        const mark = value("stock mark");
        const percent = value("premium % of owned position");
        if (
          !Number.isFinite(premium) ||
          premium < 0 ||
          !Number.isFinite(mark) ||
          mark <= 0 ||
          !same(total, contracts * STANDARD_MULTIPLIER * premium, 0.005001) ||
          !same(percent, (total / (ownedShares * mark)) * 100, 0.005001)
        )
          errors.push(
            "Premium arithmetic must use total contract cost divided by actual owned shares times the positive stock mark",
          );
      }
    }
    if (!rowCount) errors.push("A financial calculation table cannot be empty");
    if (
      sizing &&
      (observedContracts.length !== expected.length ||
        expected.some((choice) => !observedContracts.includes(choice.contracts)))
    )
      errors.push("Show each distinct whole-contract coverage choice exactly once");
  }
  if (sizingTables !== 1)
    errors.push(
      "Include one complete whole-contract sizing table with uncovered and excess shares",
    );
  if (!/\b(?:assuming|assumption)\b[^\n]{0,80}\b100\s+shares\b/i.test(text))
    errors.push(
      "Label the 100-share multiplier as a standard-contract assumption, not verified contract data",
    );
  if (!costTables && !text.includes(UNAVAILABLE))
    errors.push(
      "Provide the premium calculation table or explicitly state why premium percentage is unavailable",
    );
  for (const [index, line] of lines.entries()) {
    if (
      !costLineIndexes.has(index) &&
      /\bpremium(?:\s+(?:cost|paid|percentage))?\s*(?:is|:|=|represents|of|about|approximately)?\s*\d+(?:\.\d+)?\s*%/i.test(
        line,
      )
    )
      errors.push("Keep numerical premium percentages in the validated cost table");
  }
  return [...new Set(errors)];
}

export function createProtectivePutValidation(ownedShares: number): PromptOutputValidation {
  return {
    validate: (text) => validateProtectivePutOutput(text, ownedShares),
    repairPrompt: (errors) =>
      `The protective-put answer failed position-sizing or premium arithmetic validation:\n${errors.map((error) => `- ${error}`).join("\n")}\n\nReturn a complete corrected answer using the existing evidence. Preserve the original assumptions, requested horizon, option identities, data limitations, hedge mechanics and risk tradeoffs. Do not make new tool calls or invent missing prices.\n${buildProtectivePutSizingContract(ownedShares)}`,
  };
}
