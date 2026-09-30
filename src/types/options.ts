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
  /** ISO timestamp of the contract's most recent trade, when the provider reports one. */
  lastTradeDate?: string;
}

export type OptionsMarketSession = "pre_market" | "regular" | "after_hours" | "closed";

/**
 * - live_quotes: nonzero bid/ask during the regular options session.
 * - last_session_quotes: nonzero bid/ask outside the regular session; carried
 *   over from the last regular session and not executable now.
 * - closed_market_or_stale_quotes: all-zero bid/ask outside the regular session.
 * - live_zero_bid_ask: all-zero bid/ask during the regular session.
 */
export type OptionsBidAskState =
  | "live_quotes"
  | "last_session_quotes"
  | "closed_market_or_stale_quotes"
  | "live_zero_bid_ask"
  | "mixed_or_unknown";

/**
 * Where marketSession came from: the provider's reported market state, the
 * local holiday-aware ET market calendar when the provider did not report one,
 * or a calendar recheck of a cached chain whose regular session has since ended.
 */
export type OptionsMarketSessionSource =
  | "provider_market_state"
  | "local_calendar"
  | "local_calendar_recheck";

export interface OptionsQuoteStatus {
  marketSession: OptionsMarketSession;
  marketSessionSource: OptionsMarketSessionSource;
  /** Raw provider market state (for Yahoo: PRE, REGULAR, POST, CLOSED, ...). */
  providerMarketState?: string;
  bidAskState: OptionsBidAskState;
  zeroBidAskContracts: number;
  totalContracts: number;
  /** ISO timestamp of the most recent trade across all contracts in the chain. */
  latestContractTradeAt?: string;
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
