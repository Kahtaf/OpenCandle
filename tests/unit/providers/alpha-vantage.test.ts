import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getFinancials } from "../../../src/providers/alpha-vantage.js";
import { cache } from "../../../src/infra/cache.js";
import { rateLimiter } from "../../../src/infra/rate-limiter.js";
import incomeFixture from "../../fixtures/alphavantage/AAPL-income-statement.json";
import balanceFixture from "../../fixtures/alphavantage/AAPL-balance-sheet.json";
import cashFlowFixture from "../../fixtures/alphavantage/AAPL-cash-flow.json";

describe("alpha-vantage provider", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    cache.clear();
    // Reset rate limiter tokens so tests don't block each other
    rateLimiter.configure("alphavantage", 5, 0.083);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("getFinancials", () => {
    function mockThreeStatements() {
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("INCOME_STATEMENT")) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(incomeFixture) });
        }
        if (url.includes("BALANCE_SHEET")) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(balanceFixture) });
        }
        if (url.includes("CASH_FLOW")) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(cashFlowFixture) });
        }
        return Promise.reject(new Error(`Unexpected URL: ${url}`));
      });
    }

    it("fetches income statement, balance sheet, and cash flow", async () => {
      mockThreeStatements();
      const statements = await getFinancials("AAPL", "test-key");

      expect(globalThis.fetch).toHaveBeenCalledTimes(3);

      const urls = (globalThis.fetch as any).mock.calls.map((c: any) => c[0]);
      expect(urls.some((u: string) => u.includes("INCOME_STATEMENT"))).toBe(true);
      expect(urls.some((u: string) => u.includes("BALANCE_SHEET"))).toBe(true);
      expect(urls.some((u: string) => u.includes("CASH_FLOW"))).toBe(true);
    });

    it("merges balance sheet data into financial statements", async () => {
      mockThreeStatements();
      const statements = await getFinancials("AAPL", "test-key");

      expect(statements[0].totalAssets).toBe(364980000000);
      expect(statements[0].totalLiabilities).toBe(308030000000);
      expect(statements[0].totalEquity).toBe(56950000000);
    });

    it("merges cash flow data into financial statements", async () => {
      mockThreeStatements();
      const statements = await getFinancials("AAPL", "test-key");

      expect(statements[0].operatingCashFlow).toBe(118254000000);
      // freeCashFlow = operatingCashflow - capitalExpenditures
      expect(statements[0].freeCashFlow).toBe(118254000000 - 9959000000);
    });

    it("still includes income statement data", async () => {
      mockThreeStatements();
      const statements = await getFinancials("AAPL", "test-key");

      expect(statements[0].fiscalDate).toBe("2024-09-30");
      expect(statements[0].revenue).toBe(391035000000);
      expect(statements[0].netIncome).toBe(93736000000);
    });

    it("matches data across statements by fiscal date", async () => {
      mockThreeStatements();
      const statements = await getFinancials("AAPL", "test-key");

      // Second statement should have 2023 data
      expect(statements[1].fiscalDate).toBe("2023-09-30");
      expect(statements[1].totalAssets).toBe(352583000000);
      expect(statements[1].operatingCashFlow).toBe(110543000000);
    });

    it("uses cached result on second call", async () => {
      mockThreeStatements();
      await getFinancials("AAPL", "test-key");
      await getFinancials("AAPL", "test-key");

      // Should only fetch once (3 calls), second call uses cache
      expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    });
  });
});
