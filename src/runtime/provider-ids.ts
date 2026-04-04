/**
 * Canonical provider IDs. These match the keys used in
 * src/infra/rate-limiter.ts for providers that have rate limits.
 */
export const PROVIDER_ID = {
  YAHOO: "yahoo",
  ALPHA_VANTAGE: "alphavantage",
  COINGECKO: "coingecko",
  FRED: "fred",
  SEC_EDGAR: "sec-edgar",
  REDDIT: "reddit",
  FEAR_GREED: "feargreed",
} as const;

export type ProviderId = (typeof PROVIDER_ID)[keyof typeof PROVIDER_ID];
