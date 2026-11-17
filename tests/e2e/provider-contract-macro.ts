import assert from "node:assert/strict";
import { loadConfig } from "../../src/config.js";
import { cache } from "../../src/infra/cache.js";
import { rateLimiter } from "../../src/infra/rate-limiter.js";
import { getCryptoPrice } from "../../src/providers/coingecko.js";
import { getSeries } from "../../src/providers/fred.js";
import { searchPredictionMarkets } from "../../src/providers/polymarket.js";
import { type SECFiling, searchFilings } from "../../src/providers/sec-edgar.js";
import { getAllTools } from "../../src/tools/index.js";
import { type CanaryCase, skip } from "./live-canary-results.js";
import type { SmokeToolLike } from "./provider-release-smoke.js";

export function getMacroContractCases(): CanaryCase[] {
  const tools = getAllTools();
  const tool = (name: string) => {
    const found = tools.find((candidate) => candidate.name === name);
    assert(found, `registered tool missing: ${name}`);
    return found as SmokeToolLike;
  };
  const cases: CanaryCase[] = [
    {
      name: "coingecko:price",
      run: async () => {
        const price = await getCryptoPrice("bitcoin");
        assert(Number.isFinite(price.price) && price.price > 0);
        assert(price.asOf && Number.isFinite(Date.parse(price.asOf)));
      },
    },
    {
      name: "coingecko:history",
      run: async () => {
        const result = await tool("get_crypto_history").execute("provider-contract", {
          id: "bitcoin",
          days: 1,
        });
        assert(
          Array.isArray(result.details) && result.details.length > 2,
          "expected nonempty intraday candles",
        );
        let previous = 0;
        for (const bar of result.details) {
          assert(
            typeof bar.timestamp === "number" && bar.timestamp > previous,
            "unique ordered source timestamps required",
          );
          previous = bar.timestamp;
          assert(
            [bar.open, bar.high, bar.low, bar.close].every((n) => Number.isFinite(n) && n > 0),
          );
          assert(
            bar.high >= Math.max(bar.open, bar.close) && bar.low <= Math.min(bar.open, bar.close),
          );
        }
        const text = JSON.stringify(result.content);
        assert(
          /volume.*unavailable/i.test(text) && /cadence|spacing/i.test(text),
          "source caveats required",
        );
        assert(!/Annualized|Sharpe|Value at Risk/.test(text));
      },
    },
    {
      name: "feargreed:index",
      run: async () => {
        const result = await tool("get_fear_greed").execute("provider-contract", {});
        const data = result.details as { value: number; asOf?: string } | null;
        assert(data && Number.isFinite(data.value) && data.value >= 0 && data.value <= 100);
        assert(
          data.asOf && Number.isFinite(Date.parse(data.asOf)),
          "source observation date required",
        );
        assert.match(JSON.stringify(result.content), /Alternative\.me/);
        assert(JSON.stringify(result.content).includes(data.asOf));
      },
    },
    {
      name: "fred:series",
      run: async () => {
        const key = loadConfig().fredApiKey;
        if (!key) skip("FRED credentials unavailable");
        const original = rateLimiter.acquire.bind(rateLimiter);
        let acquisitions = 0;
        rateLimiter.acquire = async (provider) => {
          if (provider === "fred") acquisitions++;
          await original(provider);
        };
        try {
          const series = await getSeries("FEDFUNDS", key, 3);
          assert(series.observations.length > 0 && series.observations.length <= 3);
          assert(
            series.observations.every(
              (o, i, all) => Number.isFinite(o.value) && (i === 0 || o.date > all[i - 1].date),
            ),
          );
          assert.equal(acquisitions, 2, "each FRED request requires a limiter acquisition");
        } finally {
          rateLimiter.acquire = original;
        }
      },
    },
    {
      name: "sec-edgar:filings",
      run: async () => {
        const original = rateLimiter.acquire.bind(rateLimiter);
        let acquisitions = 0;
        rateLimiter.acquire = async (provider) => {
          if (provider === "sec_edgar") acquisitions++;
          await original(provider);
        };
        try {
          const metadata = await searchFilings("AAPL", ["10-K"], 1);
          const result = await tool("get_sec_filings").execute("provider-contract", {
            symbol: "AAPL",
            form_types: ["10-K"],
            limit: 1,
            include_snippets: true,
          });
          const enriched = (result.details as { filings?: SECFiling[] } | null)?.filings;
          assert(enriched?.length);
          assert.equal(metadata.length, 1);
          assert.equal(
            enriched[0].accessionNumber,
            metadata[0].accessionNumber,
            "enrichment must preserve selection",
          );
          assert.equal(metadata[0].formType, "10-K");
          assert(enriched[0].evidenceSnippets?.length, "live primary document evidence required");
          assert(!metadata[0].evidenceSnippets, "enrichment must not mutate metadata cache");
          assert.equal(
            acquisitions,
            3,
            "SEC ticker, submission and document requests must each acquire",
          );
          assert(JSON.stringify(result.content).includes(metadata[0].filedDate));
        } finally {
          rateLimiter.acquire = original;
        }
      },
    },
    {
      name: "polymarket:search",
      run: async () => {
        const quotes = await searchPredictionMarkets("bitcoin", 3);
        assert(
          quotes.length > 0 && quotes.length <= 3,
          "positive query must return bounded outcome quotes",
        );
        const rendered = await tool("get_event_probabilities").execute("provider-contract", {
          query: "bitcoin",
          limit: 3,
        });
        assert(Array.isArray(rendered.details) && rendered.details.length === quotes.length);
        for (const quote of quotes) {
          assert(
            Number.isFinite(quote.probability) && quote.probability >= 0 && quote.probability <= 1,
          );
          assert(quote.title && quote.outcome && quote.url.startsWith("https://polymarket.com/"));
          assert(quote.asOf && Number.isFinite(Date.parse(quote.asOf)));
        }
      },
    },
  ];
  return cases.map((entry) => ({
    ...entry,
    run: async () => {
      cache.clear();
      await entry.run();
    },
  }));
}
