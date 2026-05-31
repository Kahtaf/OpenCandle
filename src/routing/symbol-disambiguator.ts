export const FINANCE_ACRONYM_DICTIONARY = new Set([
  "IV",
  "HV",
  "ITM",
  "OTM",
  "ATM",
  "IPO",
  "SEC",
  "FED",
  "FOMC",
  "IRS",
  "ECB",
  "BOE",
  "BOJ",
  "GDP",
  "CPI",
  "PPI",
  "FX",
  "NDA",
]);

export interface DroppedSymbol {
  token: string;
  reason: string;
  signalsChecked: string[];
}

export interface SymbolDisambiguation {
  kept: string[];
  dropped: DroppedSymbol[];
}

export function disambiguateSymbols(candidates: string[], rawInput: string): SymbolDisambiguation {
  const kept: string[] = [];
  const dropped: DroppedSymbol[] = [];

  for (const candidate of candidates) {
    const token = candidate.toUpperCase();
    if (!FINANCE_ACRONYM_DICTIONARY.has(token) || hasPositiveTickerSignal(token, rawInput)) {
      if (!kept.includes(token)) kept.push(token);
      continue;
    }

    dropped.push({
      token,
      reason: "no positive ticker signal",
      signalsChecked: ["cashtag", "local ticker phrase"],
    });
  }

  return { kept, dropped };
}

function hasPositiveTickerSignal(token: string, rawInput: string): boolean {
  return hasCashtag(token, rawInput) || hasLocalTickerPhrase(token, rawInput);
}

function hasCashtag(token: string, rawInput: string): boolean {
  return new RegExp(`\\$${escapeRegExp(token)}\\b`, "i").test(rawInput);
}

function hasLocalTickerPhrase(token: string, rawInput: string): boolean {
  const escaped = escapeRegExp(token);
  return new RegExp(
    `\\b${escaped}\\s+(?:ticker|stock|symbol)\\b|\\b(?:ticker|stock|symbol)\\s+${escaped}\\b`,
    "i",
  ).test(rawInput);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
