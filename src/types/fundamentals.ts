export interface CompanyOverview {
  symbol: string;
  name: string;
  description: string;
  exchange: string;
  sector: string;
  industry: string;
  marketCap: number;
  pe: number | null;
  forwardPe: number | null;
  eps: number | null;
  dividendYield: number | null;
  beta: number | null;
  week52High: number;
  week52Low: number;
  avgVolume: number;
  profitMargin: number | null;
  revenueGrowth: number | null;
}

export interface EarningsData {
  symbol: string;
  quarterly: Array<{
    date: string;
    reportedEPS: number;
    estimatedEPS: number;
    surprise: number;
    surprisePercent: number;
  }>;
}

export interface FinancialStatement {
  fiscalDate: string;
  revenue: number;
  grossProfit: number;
  operatingIncome: number;
  netIncome: number;
  eps: number;
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  operatingCashFlow: number;
  freeCashFlow: number;
}
