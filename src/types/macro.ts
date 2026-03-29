export interface FredObservation {
  date: string;
  value: number;
}

export interface FredSeries {
  id: string;
  title: string;
  observations: FredObservation[];
  units: string;
  frequency: string;
  lastUpdated: string;
}

// Common FRED series IDs
export const FRED_SERIES = {
  FED_FUNDS: "FEDFUNDS",
  TREASURY_10Y: "DGS10",
  TREASURY_2Y: "DGS2",
  TREASURY_30Y: "DGS30",
  CPI: "CPIAUCSL",
  UNEMPLOYMENT: "UNRATE",
  GDP: "GDP",
  YIELD_SPREAD_10Y2Y: "T10Y2Y",
  INFLATION_EXPECTATION: "T5YIE",
  MORTGAGE_30Y: "MORTGAGE30US",
} as const;
