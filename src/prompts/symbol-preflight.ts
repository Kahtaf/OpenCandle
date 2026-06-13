import { type InstrumentCandidate, searchYahooInstruments } from "../market-state/resolve.js";

export interface SymbolValidation {
  valid: boolean;
  reason?: string;
  checkedAt: number;
}

export type SymbolValidationCache = Map<string, SymbolValidation>;

export interface SymbolPreflightDrop {
  symbol: string;
  reason: string;
}

export interface SymbolPreflightResult {
  valid: string[];
  dropped: SymbolPreflightDrop[];
}

export async function preflightSymbols(
  symbols: string[],
  options: {
    cache?: SymbolValidationCache;
    search?: (query: string) => Promise<InstrumentCandidate[]>;
  } = {},
): Promise<SymbolPreflightResult> {
  const cache = options.cache;
  const search = options.search ?? searchYahooInstruments;
  const valid: string[] = [];
  const dropped: SymbolPreflightDrop[] = [];

  for (const rawSymbol of symbols) {
    const symbol = rawSymbol.trim().toUpperCase();
    if (!symbol) continue;

    const cached = cache?.get(symbol);
    const validation = cached ?? (await validateSymbol(symbol, search));
    if (!cached) cache?.set(symbol, validation);

    if (validation.valid) {
      valid.push(symbol);
    } else {
      dropped.push({
        symbol,
        reason: validation.reason ?? "no matching ticker found via resolver search",
      });
    }
  }

  return { valid, dropped };
}

export function formatPreflightDropAnnotation(dropped: SymbolPreflightDrop[]): string {
  const count = dropped.length;
  const symbols = dropped.map((drop) => `${drop.symbol} (${drop.reason})`).join(", ");
  return `[Pre-flight: dropped ${count} unknown symbol${count === 1 ? "" : "s"} - ${symbols}]`;
}

function validateSymbol(
  symbol: string,
  search: (query: string) => Promise<InstrumentCandidate[]>,
): Promise<SymbolValidation> {
  return search(symbol)
    .then((candidates) => ({
      valid: candidates.some((candidate) => candidate.symbol.toUpperCase() === symbol),
      reason: candidates.some((candidate) => candidate.symbol.toUpperCase() === symbol)
        ? undefined
        : "no matching ticker found via resolver search",
      checkedAt: Date.now(),
    }))
    .catch((error) => ({
      valid: true,
      reason:
        error instanceof Error
          ? `resolver search unavailable: ${error.message}`
          : "resolver search unavailable",
      checkedAt: Date.now(),
    }));
}
