export interface Greeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
}

export interface OptionContract {
  contractSymbol: string;
  type: "call" | "put";
  strike: number;
  expiration: string;
  bid: number;
  ask: number;
  lastPrice: number;
  volume: number;
  openInterest: number;
  impliedVolatility: number;
  inTheMoney: boolean;
  greeks: Greeks;
}

export type OptionsMarketSession = "pre_market" | "regular" | "after_hours" | "closed";

export type OptionsBidAskState =
  | "live_quotes"
  | "closed_market_or_stale_quotes"
  | "live_zero_bid_ask"
  | "mixed_or_unknown";

export interface OptionsQuoteStatus {
  marketSession: OptionsMarketSession;
  bidAskState: OptionsBidAskState;
  zeroBidAskContracts: number;
  totalContracts: number;
  warning?: string;
}

export interface OptionsChain {
  symbol: string;
  underlyingPrice: number;
  expirationDate: string;
  expirationDates: string[];
  calls: OptionContract[];
  puts: OptionContract[];
  totalCallVolume: number;
  totalPutVolume: number;
  putCallRatio: number;
  quoteStatus: OptionsQuoteStatus;
  fetchedAt: string;
  asOf?: string;
}
