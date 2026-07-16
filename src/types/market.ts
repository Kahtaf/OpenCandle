export interface StockQuote {
  symbol: string;
  name?: string;
  price: number;
  change: number;
  changePercent: number;
  open: number;
  high: number;
  low: number;
  previousClose: number;
  volume: number;
  marketCap: number;
  pe: number | null;
  week52High: number;
  week52Low: number;
  timestamp: number;
  asOf?: string;
  currency?: string | null;
  marketState?: "PRE" | "REGULAR" | "POST" | "CLOSED";
  extendedPrice?: number;
  extendedChange?: number;
  extendedChangePercent?: number;
  extendedAsOf?: string;
}

export interface OHLCV {
  date: string;
  /** UTC epoch seconds; present when the provider supplies per-bar timestamps. */
  timestamp?: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CryptoPrice {
  id: string;
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  changePercent24h: number;
  marketCap: number;
  volume24h: number;
  high24h: number;
  low24h: number;
  ath: number;
  athDate: string;
  circulatingSupply: number;
  totalSupply: number | null;
  timestamp: number;
  asOf?: string;
}
