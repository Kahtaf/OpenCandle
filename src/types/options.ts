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
  fetchedAt: string;
}
