import type { Greeks } from "../../types/options.js";

interface GreeksInput {
  type: "call" | "put";
  spot: number;       // underlying price
  strike: number;     // strike price
  timeYears: number;  // time to expiration in years
  iv: number;         // implied volatility (e.g. 0.30 for 30%)
  riskFreeRate: number; // risk-free rate (e.g. 0.05 for 5%)
}

/**
 * Compute option Greeks using the Black-Scholes model.
 */
export function computeGreeks(input: GreeksInput): Greeks {
  const { type, spot, strike, timeYears, iv, riskFreeRate: r } = input;

  // At expiration: return intrinsic values
  if (timeYears <= 0) {
    const isCall = type === "call";
    const itm = isCall ? spot >= strike : spot <= strike;
    return {
      delta: itm ? (isCall ? 1 : -1) : 0,
      gamma: 0,
      theta: 0,
      vega: 0,
      rho: 0,
    };
  }

  const sqrtT = Math.sqrt(timeYears);
  const d1 = (Math.log(spot / strike) + (r + (iv * iv) / 2) * timeYears) / (iv * sqrtT);
  const d2 = d1 - iv * sqrtT;

  const nd1 = cdf(d1);
  const nd2 = cdf(d2);
  const npd1 = pdf(d1);

  const expRT = Math.exp(-r * timeYears);

  if (type === "call") {
    return {
      delta: nd1,
      gamma: npd1 / (spot * iv * sqrtT),
      theta: (-(spot * npd1 * iv) / (2 * sqrtT) - r * strike * expRT * nd2) / 365,
      vega: (spot * npd1 * sqrtT) / 100, // per 1% change in IV
      rho: (strike * timeYears * expRT * nd2) / 100, // per 1% change in rate
    };
  } else {
    const nMinusD1 = cdf(-d1);
    const nMinusD2 = cdf(-d2);
    return {
      delta: nd1 - 1,
      gamma: npd1 / (spot * iv * sqrtT),
      theta: (-(spot * npd1 * iv) / (2 * sqrtT) + r * strike * expRT * nMinusD2) / 365,
      vega: (spot * npd1 * sqrtT) / 100,
      rho: -(strike * timeYears * expRT * nMinusD2) / 100,
    };
  }
}

/** Standard normal cumulative distribution function */
function cdf(x: number): number {
  // Abramowitz and Stegun approximation 26.2.17
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1 / (1 + p * absX);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX / 2);
  return 0.5 * (1 + sign * y);
}

/** Standard normal probability density function */
function pdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}
