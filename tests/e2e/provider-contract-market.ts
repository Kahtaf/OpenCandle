import assert from "node:assert/strict";
import { loadConfig } from "../../src/config.js";
import { cache } from "../../src/infra/cache.js";
import * as av from "../../src/providers/alpha-vantage.js";
import { finnhubDateRange, getCompanyNews } from "../../src/providers/finnhub.js";
import * as tv from "../../src/providers/tradingview.js";
import * as yahoo from "../../src/providers/yahoo-finance.js";
import { createFxResolver } from "../../src/providers/yahoo-fx.js";
import {
  type CanaryCase,
  skip,
  verifyHistoryPayload,
  verifyQuotePayload,
} from "./live-canary-results.js";

function positive(value: number) {
  assert(Number.isFinite(value) && value > 0, "expected positive finite source value");
}
function dated(value: string | undefined) {
  assert(value && Number.isFinite(Date.parse(value)), "missing source observation date");
  assert(Date.parse(value) <= Date.now() + 60_000, "future source observation");
}
function ohlc(q: { open?: number; high?: number; low?: number; price: number }) {
  positive(q.price);
  assert(q.open !== undefined && q.high !== undefined && q.low !== undefined, "missing OHLC");
  positive(q.open);
  positive(q.high);
  positive(q.low);
  assert(
    q.low <= Math.min(q.open, q.price) && q.high >= Math.max(q.open, q.price),
    "incoherent OHLC",
  );
}
function history(bars: Awaited<ReturnType<typeof yahoo.getHistory>>) {
  const verdict = verifyHistoryPayload(bars);
  assert.equal(verdict.status, "passed", verdict.reason ?? "payload validation failed");
}

export async function getMarketContractCases(): Promise<CanaryCase[]> {
  const config = loadConfig();
  const { getAllTools } = await import("../../src/tools/index.js");
  const tools = getAllTools();
  async function tool(name: string, args: Record<string, unknown>) {
    const selected = tools.find((item) => item.name === name);
    assert(selected, `registered tool missing ${name}`);
    return selected.execute("provider-contract-market", args as never);
  }
  function keyed(provider: "alphaVantage" | "finnhub") {
    const key = provider === "alphaVantage" ? config.alphaVantageApiKey : config.finnhubApiKey;
    if (!key) skip(`${provider} credential unavailable`);
    return key;
  }
  const cases: CanaryCase[] = [
    {
      name: "yahoo:quote-tool",
      run: async () => {
        const direct = await yahoo.getQuote("AAPL");
        ohlc(direct);
        dated(direct.asOf);
        cache.clear();
        const result = await tool("get_stock_quote", { symbol: "AAPL" });
        const verdict = verifyQuotePayload(result.details);
        assert.equal(verdict.status, "passed", verdict.reason ?? "payload validation failed");
        const quote = result.details as Awaited<ReturnType<typeof yahoo.getQuote>>;
        ohlc(quote);
        dated(quote.asOf);
      },
    },
    {
      name: "yahoo:history-tool",
      run: async () => {
        history(await yahoo.getHistory("AAPL", "1mo", "1d"));
        cache.clear();
        const result = await tool("get_stock_history", {
          symbol: "AAPL",
          range: "1mo",
          interval: "1d",
        });
        history(result.details as Awaited<ReturnType<typeof yahoo.getHistory>>);
      },
    },
    {
      name: "yahoo:overview",
      run: async () => {
        const result = await yahoo.getYahooCompanyOverview("AAPL");
        assert.equal(result.symbol, "AAPL");
        assert(result.name);
        positive(result.marketCap);
      },
    },
    {
      name: "yahoo:financials",
      run: async () => {
        const result = await yahoo.getYahooFinancials("AAPL");
        assert(result.length);
        for (const row of result) {
          dated(row.fiscalDate);
          positive(row.revenue);
          assert(Number.isFinite(row.eps));
        }
      },
    },
    {
      name: "yahoo:holdings",
      run: async () => {
        const result = await yahoo.getFundHoldings("VOO");
        assert.equal(result.symbol, "VOO");
        assert(result.holdings.length);
        for (const row of result.holdings) {
          assert(row.symbol);
          positive(row.weight);
          assert(row.weight <= 1);
        }
      },
    },
    {
      name: "yahoo:holdings-tool",
      run: async () => {
        const result = await tool("analyze_holdings_overlap", { symbols: ["VOO", "QQQ"] });
        const details = result.details as
          | import("../../src/types/portfolio.js").FundHoldingsOverlap
          | null;
        assert(details, "holdings tool returned unavailable");
        assert.equal(details.funds.length, 2);
        assert.equal(details.pairs.length, 1);
        for (const fund of details.funds) assert(fund.holdings.length);
      },
    },
    {
      name: "yahoo:options",
      run: async () => {
        const result = await yahoo.getOptionsChain("AAPL");
        assert(result.calls.length && result.puts.length);
        assert(result.expirationDates.length);
        for (const row of [...result.calls, ...result.puts]) positive(row.strike);
      },
    },
    ...(
      [
        ["GBP", "USD"],
        ["EUR", "GBP"],
      ] as const
    ).map(
      ([source, target]): CanaryCase => ({
        name: `yahoo-fx:${source}-${target}`,
        run: async () => {
          const result = await createFxResolver(Date.now())(source, target);
          assert.equal(result.status, "ok", JSON.stringify(result));
          if (result.status !== "ok") return;
          positive(result.rate);
          assert(result.legs.length);
          for (const leg of result.legs) {
            assert.equal(leg.returnedSymbol, leg.requestedSymbol);
            assert.equal(leg.rawUnit, "USD");
            assert.equal(leg.cacheStatus, "fresh");
            assert(leg.observedAt <= Date.now());
          }
        },
      }),
    ),
    ...[
      ["AAPL", "MSFT"],
      ["NASDAQ:AAPL", "LSE:VOD"],
    ].map(
      (symbols, i): CanaryCase => ({
        name: `tradingview:quotes-${i === 0 ? "bare" : "qualified"}`,
        run: async () => {
          const rows = await tv.getQuotes(symbols);
          assert.equal(rows.length, symbols.length);
          for (const row of rows) {
            positive(row.price);
            assert(symbols.includes(row.requestedSymbol));
            assert.match(row.dataCaveat, /freshness.*unverified/i);
          }
        },
      }),
    ),
    {
      name: "tradingview:screen-tool",
      run: async () => {
        const result = await tool("screen_stocks", { limit: 3 });
        const rows = result.details as tv.ScreenerRow[];
        assert(rows.length);
        for (const row of rows) {
          assert.equal(row.sourceProvider, "tradingview");
          positive(Number(row.values.close));
          assert.match(row.dataCaveat, /freshness.*unverified/i);
        }
      },
    },
    {
      name: "alpha-vantage:overview",
      run: async () => {
        const result = await av.getOverview("AAPL", keyed("alphaVantage"));
        assert.equal(result.symbol, "AAPL");
        assert(result.name);
        positive(result.marketCap);
      },
    },
    {
      name: "alpha-vantage:quote",
      run: async () => {
        const result = await av.getGlobalQuote("AAPL", keyed("alphaVantage"));
        assert.equal(result.symbol, "AAPL");
        positive(result.price);
        dated(result.asOf);
        assert(result.high >= Math.max(result.open, result.price));
        assert(result.low <= Math.min(result.open, result.price));
      },
    },
    ...(["1mo", "6mo"] as const).map(
      (range): CanaryCase => ({
        name: `alpha-vantage:history-${range}`,
        run: async () => {
          const rows = await av.getDailyHistory("AAPL", keyed("alphaVantage"), range);
          history(rows);
          assert(rows.length >= (range === "6mo" ? 120 : 18), "requested history coverage missing");
        },
      }),
    ),
    {
      name: "alpha-vantage:financials",
      run: async () => {
        const key = keyed("alphaVantage");
        const statements = await av.getFinancials("AAPL", key);
        assert(statements.length);
        const { httpGet } = await import("../../src/infra/http-client.js");
        const { rateLimiter } = await import("../../src/infra/rate-limiter.js");
        await rateLimiter.acquire("alphavantage");
        const source = await httpGet<{
          annualEarnings?: { fiscalDateEnding: string; reportedEPS: string }[];
        }>(
          `https://www.alphavantage.co/query?function=EARNINGS&symbol=AAPL&apikey=${encodeURIComponent(key)}`,
        );
        assert(Array.isArray(source.annualEarnings), "annual earnings source unavailable");
        for (const row of statements) {
          const annual: { fiscalDateEnding: string; reportedEPS: string } | undefined =
            source.annualEarnings.find((entry) => entry.fiscalDateEnding === row.fiscalDate);
          assert(annual, "missing matching annual EPS");
          assert.equal(row.eps, Number(annual.reportedEPS));
          dated(row.fiscalDate);
          positive(row.revenue);
        }
      },
    },
    {
      name: "alpha-vantage:earnings",
      run: async () => {
        const result = await av.getEarnings("AAPL", keyed("alphaVantage"));
        assert(result.quarterly.length);
        for (const row of result.quarterly) {
          dated(row.date);
          assert(Number.isFinite(row.reportedEPS));
        }
      },
    },
    {
      name: "finnhub:news",
      run: async () => {
        const { from, to } = finnhubDateRange("week");
        const rows = await getCompanyNews("AAPL", from, to, keyed("finnhub"));
        assert(rows.length);
        for (const row of rows) {
          assert(row.headline && row.source);
          assert.match(row.url, /^https?:\/\//);
          positive(row.datetime);
          assert(row.datetime * 1000 <= Date.now());
          assert(Number.isFinite(row.id));
        }
      },
    },
  ];
  return cases.map((entry) => ({
    ...entry,
    optional: false,
    run: async () => {
      cache.clear();
      try {
        await entry.run();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/Alpha Vantage rate limited/i.test(message))
          skip("Alpha Vantage upstream rate or daily quota restriction");
        if (/Alpha Vantage entitlement/i.test(message))
          skip("Alpha Vantage premium entitlement unavailable");
        if (/\b429\b|Too Many Requests/i.test(message))
          skip("upstream HTTP 429 access restriction");
        throw error;
      }
    },
  }));
}
