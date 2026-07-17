import { beforeEach, describe, expect, it, vi } from "vitest";
import { Cache } from "../../../src/infra/cache.js";
import { getFinancials } from "../../../src/providers/alpha-vantage.js";
import { getLseFinancials } from "../../../src/providers/lse.js";
import { ProviderCredentialError } from "../../../src/providers/provider-credential-error.js";
import { financialsTool } from "../../../src/tools/fundamentals/financials.js";
import type { FinancialStatement } from "../../../src/types/fundamentals.js";

const configMock = vi.hoisted(() => ({
  alphaVantageApiKey: "av-test-key" as string | undefined,
  lseApiKey: "lse-test-key" as string | undefined,
}));
const budgetMock = vi.hoisted(() => ({ overSoftThreshold: false }));

vi.mock("../../../src/config.js", () => ({
  getConfig: () => ({ ...configMock }),
}));
vi.mock("../../../src/infra/lse-byte-budget.js", () => ({
  isOverSoftThreshold: () => budgetMock.overSoftThreshold,
}));
vi.mock("../../../src/providers/alpha-vantage.js", () => ({
  getFinancials: vi.fn(),
}));
vi.mock("../../../src/providers/lse.js", () => ({
  getLseFinancials: vi.fn(),
}));

const statement: FinancialStatement = {
  fiscalDate: "2025-09-27",
  revenue: 416_161_000_000,
  grossProfit: 195_201_000_000,
  operatingIncome: 133_050_000_000,
  netIncome: 112_010_000_000,
  eps: 7.49,
  totalAssets: 359_241_000_000,
  totalLiabilities: 285_508_000_000,
  totalEquity: 73_733_000_000,
  operatingCashFlow: 111_482_000_000,
  freeCashFlow: 98_767_000_000,
  totalDebt: 112_377_000_000,
  cashAndEquivalents: 35_934_000_000,
  sharesOutstanding: 14_948_500_000,
};

describe("get_financials tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configMock.alphaVantageApiKey = "av-test-key";
    configMock.lseApiKey = "lse-test-key";
    budgetMock.overSoftThreshold = false;
    vi.mocked(getLseFinancials).mockResolvedValue([statement]);
    vi.mocked(getFinancials).mockResolvedValue([statement]);
  });

  it("uses eligible LSE financials without calling Alpha Vantage", async () => {
    const result = await financialsTool.execute("call-1", { symbol: "aapl" });

    expect(result.details).toEqual([statement]);
    expect(getLseFinancials).toHaveBeenCalledWith("AAPL");
    expect(getFinancials).not.toHaveBeenCalled();
    expect(result.content[0]).toMatchObject({ type: "text" });
    if (result.content[0].type !== "text") throw new Error("expected text content");
    expect(result.content[0].text).toContain("Source: London Strategic Edge");
  });

  it("falls back to Alpha Vantage when LSE returns no statements", async () => {
    vi.mocked(getLseFinancials).mockResolvedValue([]);

    const result = await financialsTool.execute("call-empty", { symbol: "AAPL" });

    expect(result.details).toEqual([statement]);
    expect(getFinancials).toHaveBeenCalledWith("AAPL", "av-test-key");
    expect(textContent(result.content[0])).toContain("Source: Alpha Vantage");
  });

  it("prefers fresh Alpha Vantage financials over stale LSE statements", async () => {
    const staleCache = new Cache();
    staleCache.set("lse-financials", [statement], 60_000);
    const freshStatement = { ...statement, fiscalDate: "2026-09-26", revenue: 500_000_000_000 };
    vi.mocked(getLseFinancials).mockImplementation(
      async () => staleCache.getStale<FinancialStatement[]>("lse-financials", 86_400_000)!.value,
    );
    vi.mocked(getFinancials).mockResolvedValue([freshStatement]);

    const result = await financialsTool.execute("call-stale-lse", { symbol: "AAPL" });

    expect(result.details).toEqual([freshStatement]);
    expect(getFinancials).toHaveBeenCalledWith("AAPL", "av-test-key");
    expect(textContent(result.content[0])).toContain("Source: Alpha Vantage");
  });

  it("labels stale LSE financials when no fresh fallback is configured", async () => {
    configMock.alphaVantageApiKey = undefined;
    const staleCache = new Cache();
    staleCache.set("lse-financials", [statement], 60_000);
    vi.mocked(getLseFinancials).mockImplementation(
      async () => staleCache.getStale<FinancialStatement[]>("lse-financials", 86_400_000)!.value,
    );

    const result = await financialsTool.execute("call-stale-only", { symbol: "AAPL" });

    expect(result.details).toEqual([statement]);
    expect(textContent(result.content[0])).toContain("Source: London Strategic Edge");
    expect(textContent(result.content[0])).toMatch(/stale cache/i);
    expect(getFinancials).not.toHaveBeenCalled();
  });

  it("keeps usable stale LSE financials when Alpha Vantage rejects its credential", async () => {
    const staleCache = new Cache();
    staleCache.set("lse-financials", [statement], 60_000);
    vi.mocked(getLseFinancials).mockImplementation(
      async () => staleCache.getStale<FinancialStatement[]>("lse-financials", 86_400_000)!.value,
    );
    vi.mocked(getFinancials).mockRejectedValue(
      new ProviderCredentialError("alpha_vantage", "stale", 401),
    );

    const result = await financialsTool.execute("call-stale-auth-fallback", { symbol: "AAPL" });

    expect(result.details).toEqual([statement]);
    expect(textContent(result.content[0])).toContain("Source: London Strategic Edge");
    expect(textContent(result.content[0])).toMatch(/stale cache/i);
  });

  it.each([
    ["provider failure", "configured", false],
    ["missing key", "missing", false],
    ["byte budget threshold", "configured", true],
  ])("falls back to Alpha Vantage after LSE %s", async (_case, keyState, overBudget) => {
    configMock.lseApiKey = keyState === "configured" ? "lse-test-key" : undefined;
    budgetMock.overSoftThreshold = overBudget;
    if (keyState === "configured" && !overBudget) {
      vi.mocked(getLseFinancials).mockRejectedValue(new Error("LSE unavailable"));
    }

    const result = await financialsTool.execute("call-2", { symbol: "AAPL" });

    expect(result.details).toEqual([statement]);
    expect(getFinancials).toHaveBeenCalledWith("AAPL", "av-test-key");
    if (keyState === "missing" || overBudget) expect(getLseFinancials).not.toHaveBeenCalled();
    expect(result.content[0]).toMatchObject({ type: "text" });
    if (result.content[0].type !== "text") throw new Error("expected text content");
    if (keyState === "configured" && !overBudget) {
      expect(result.content[0].text).toContain("Source: Alpha Vantage");
    }
  });

  it("names both provider reasons when the full chain fails", async () => {
    vi.mocked(getLseFinancials).mockRejectedValue(new Error("LSE reports unavailable"));
    vi.mocked(getFinancials).mockRejectedValue(new Error("AV rate limited"));

    const result = await financialsTool.execute("call-3", { symbol: "AAPL" });

    expect(result.content[0]).toMatchObject({ type: "text" });
    if (result.content[0].type !== "text") throw new Error("expected text content");
    expect(result.content[0].text).toContain("lse: LSE reports unavailable");
    expect(result.content[0].text).toContain("alphavantage: AV rate limited");
    expect(result.details).toEqual([]);
  });

  it("preserves the Alpha Vantage credential-required flow when LSE is ineligible", async () => {
    configMock.lseApiKey = undefined;
    configMock.alphaVantageApiKey = undefined;

    const result = await financialsTool.execute("call-4", { symbol: "AAPL" });

    expect(result.details).toMatchObject({
      credentialRequired: { provider: "alpha_vantage", reason: "missing" },
    });
    expect(getLseFinancials).not.toHaveBeenCalled();
    expect(getFinancials).not.toHaveBeenCalled();
  });
});

function textContent(content: { type: string; text?: string }): string {
  if (content.type !== "text" || content.text === undefined) throw new Error("expected text");
  return content.text;
}
