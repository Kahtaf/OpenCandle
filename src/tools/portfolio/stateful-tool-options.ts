import {
  type MutationInstrumentResolution,
  resolveInstrumentForMutation,
} from "../../market-state/resolve-for-mutation.js";
import type { StateDatabase } from "../../runtime/state-database.js";
import type { PortfolioPriceResolver } from "./portfolio-view.js";

export interface StatefulToolOptions {
  stateDatabaseFactory: () => StateDatabase;
  closeDatabaseAfterExecute?: boolean;
  resolveInstrument?: (
    symbol: string,
    input?: StatefulInstrumentInput,
  ) => Promise<MutationInstrumentResolution>;
  getCurrentPrice?: PortfolioPriceResolver;
  allowUnverifiedExactSymbols?: boolean;
}

export interface StatefulInstrumentInput {
  currency?: string;
  unverifiedExactSymbol?: boolean;
}

export async function resolveStatefulInstrument(
  options: StatefulToolOptions,
  symbol: string,
  input: StatefulInstrumentInput = {},
): Promise<MutationInstrumentResolution> {
  if (options.allowUnverifiedExactSymbols === true && input.unverifiedExactSymbol === true) {
    const normalized = symbol.trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9.^=_/-]{0,31}$/.test(normalized)) {
      throw new Error("Enter a valid ticker symbol.");
    }
    return {
      status: "resolved",
      instrument: {
        symbol: normalized,
        assetType: normalized.endsWith("-USD") ? "crypto" : "equity",
        name: normalized,
        currency: input.currency?.trim().toUpperCase() || null,
        provider: "hosted-user",
        providerMetadata: { verified: false, source: "user-input" },
      },
    };
  }
  return (options.resolveInstrument ?? resolveInstrumentForMutation)(symbol, input);
}
