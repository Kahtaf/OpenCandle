import { randomBytes } from "node:crypto";
import { getConfig } from "../../../src/config.js";
import { getOverview } from "../../../src/providers/alpha-vantage.js";
import { getCryptoPrice } from "../../../src/providers/coingecko.js";
import { exaSearch } from "../../../src/providers/exa-search.js";
import { getFearGreedIndex } from "../../../src/providers/fear-greed.js";
import { getSeries } from "../../../src/providers/fred.js";
import { searchPredictionMarkets } from "../../../src/providers/polymarket.js";
import { getQuotes } from "../../../src/providers/tradingview.js";
import { braveSearch } from "../../../src/providers/web-search.js";
import {
  clearCrumbCache,
  getHistory,
  getOptionsChain,
  getQuote,
} from "../../../src/providers/yahoo-finance.js";
import {
  createHostedProviderFetch,
  type HostedRelayManifest,
} from "../../../gui/hosted/runtime/provider-relay-fetch.js";
import {
  createFirstClassModelProviders,
  modelSetupProviders,
} from "../../../src/pi/model-provider-catalog.js";

const relayUrl =
  process.env.OPENCANDLE_PROVIDER_RELAY_URL?.trim() ||
  "https://web.opencandle.app/v1/provider-fetch";
const nativeFetch = globalThis.fetch.bind(globalThis);
const clientId = randomBytes(16).toString("hex");
const config = getConfig();

interface Result {
  provider: string;
  proof: "live" | "auth-path" | "disabled";
  status: "PASS" | "FAIL" | "SKIP";
  reason?: string;
}

const results: Result[] = [];

async function check(
  provider: string,
  proof: Result["proof"],
  available: boolean,
  run: () => Promise<boolean>,
): Promise<void> {
  if (!available) {
    results.push({ provider, proof, status: "SKIP" });
    return;
  }
  try {
    const valid = await run();
    results.push({
      provider,
      proof,
      status: valid ? "PASS" : "FAIL",
      ...(!valid && { reason: "semantic-shape" }),
    });
  } catch (error) {
    const status =
      typeof error === "object" && error !== null && "status" in error
        ? Number((error as { status?: unknown }).status)
        : Number.NaN;
    results.push({
      provider,
      proof,
      status: "FAIL",
      reason: Number.isFinite(status)
        ? `upstream-http-${status}`
        : error instanceof Error
          ? error.name
          : "unknown-error",
    });
  }
}

async function relayStatus(input: {
  provider: string;
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
}): Promise<number> {
  const response = await nativeFetch(relayUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-opencandle-client": clientId,
    },
    body: JSON.stringify({
      version: 1,
      provider: input.provider,
      url: input.url,
      method: input.method ?? "GET",
      headers: input.headers ?? {},
      ...(input.body
        ? { bodyBase64: Buffer.from(input.body, "utf8").toString("base64") }
        : {}),
    }),
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
  });
  if (!response.ok) return response.status;
  const envelope = (await response.json()) as { status?: unknown };
  return typeof envelope.status === "number" ? envelope.status : 0;
}

async function main(): Promise<void> {
  const healthUrl = new URL(relayUrl);
  healthUrl.pathname = "/v1/health";
  const health = await nativeFetch(healthUrl, { cache: "no-store", redirect: "error" });
  const manifest = (await health.json()) as { version?: unknown; providers?: unknown };
  if (!health.ok || manifest.version !== 1 || !Array.isArray(manifest.providers)) {
    throw new Error("Relay health contract failed");
  }
  const negotiatedManifest: HostedRelayManifest = {
    version: 1,
    providers: manifest.providers.filter((provider): provider is string => typeof provider === "string"),
  };

  globalThis.fetch = createHostedProviderFetch({
    relayUrl,
    clientId,
    fetchImpl: nativeFetch,
    loadRelayManifest: async () => negotiatedManifest,
  });

  await check("yahoo", "live", true, async () => {
    clearCrumbCache();
    const [quote, history, options] = await Promise.all([
      getQuote("AAPL"),
      getHistory("AAPL", "5d", "1d"),
      getOptionsChain("AAPL"),
    ]);
    return (
      Number.isFinite(quote.price) &&
      history.length > 0 &&
      options.calls.length > 0 &&
      options.puts.length > 0
    );
  });
  await check("coingecko", "live", true, async () => {
    const price = await getCryptoPrice("bitcoin");
    return price.id === "bitcoin" && Number.isFinite(price.price);
  });
  await check("fear_greed", "live", true, async () => {
    const index = await getFearGreedIndex();
    return Number.isFinite(index.value) && Boolean(index.label);
  });
  await check("sec_edgar", "disabled", true, async () => {
    const status = await relayStatus({
      provider: "sec_edgar",
      url: "https://www.sec.gov/files/company_tickers.json",
      headers: {
        accept: "application/json",
        "user-agent": "OpenCandle/1.0 (financial analysis agent)",
      },
    });
    return status === 400;
  });
  await check("tradingview", "live", true, async () => {
    const quotes = await getQuotes(["NASDAQ:AAPL"]);
    return quotes.length === 1 && Number.isFinite(quotes[0]?.price);
  });
  await check("polymarket", "live", true, async () => {
    const markets = await searchPredictionMarkets("Federal Reserve", 1);
    return markets.length > 0;
  });

  await check("alpha_vantage", "live", Boolean(config.alphaVantageApiKey), async () => {
    const overview = await getOverview("AAPL", config.alphaVantageApiKey ?? "");
    return overview.symbol === "AAPL" && Boolean(overview.name);
  });
  await check("fred", "live", Boolean(config.fredApiKey), async () => {
    const series = await getSeries("FEDFUNDS", config.fredApiKey ?? "", 2);
    return series.id === "FEDFUNDS" && series.observations.length > 0;
  });
  await check("brave", "live", Boolean(config.braveApiKey), async () => {
    const response = await braveSearch(
      "Apple earnings",
      { category: "news", freshness: "week", limit: 2 },
      config.braveApiKey ?? "",
    );
    return response.provider === "brave" && response.results.length > 0;
  });
  await check("exa", "live", Boolean(config.exaApiKey), async () => {
    const response = await exaSearch("Apple earnings", {
      category: "news",
      freshness: "week",
      limit: 2,
    });
    return response.provider === "exa" && response.results.length > 0;
  });

  const modelProviders = createFirstClassModelProviders();
  for (const setup of modelSetupProviders) {
    const apiKey = process.env[setup.envVar]?.trim();
    await check(`${setup.id}_model`, "live", Boolean(apiKey), async () => {
      const provider = modelProviders.find((candidate) => candidate.id === setup.id);
      const overrideName = `OPENCANDLE_RELAY_SMOKE_${setup.id.toUpperCase()}_MODEL`;
      const smokeDefault = setup.id === "openai" ? "gpt-5.4-mini" : setup.defaultModel;
      const modelId = process.env[overrideName]?.trim() || smokeDefault;
      const model = provider?.getModels().find((candidate) => candidate.id === modelId);
      if (!provider || !model || !apiKey) return false;
      const response = await provider
        .streamSimple(
          model,
          {
            messages: [{ role: "user", content: "Reply with exactly OK.", timestamp: Date.now() }],
          },
          { apiKey, maxTokens: 32 },
        )
        .result();
      return response.stopReason !== "error" && response.content.some(
        (content) => content.type === "text" && content.text.trim().toUpperCase() === "OK",
      );
    });
  }

  await check("finnhub", "disabled", true, async () => {
    const status = await relayStatus({
      provider: "finnhub",
      url: "https://finnhub.io/api/v1/company-news?symbol=AAPL&from=2026-07-24&to=2026-07-31",
    });
    return status === 400;
  });
  await check("lse", "disabled", true, async () => {
    const status = await relayStatus({
      provider: "lse",
      url: "https://api.londonstrategicedge.com/vault/candles?symbol=AAPL&timeframe=1d&limit=1",
    });
    return status === 400;
  });

  globalThis.fetch = nativeFetch;
  for (const result of results) {
    process.stdout.write(
      `${result.status.padEnd(4)} ${result.provider.padEnd(16)} ${result.proof}${result.reason ? ` ${result.reason}` : ""}\n`,
    );
  }
  const failed = results.filter((result) => result.status === "FAIL");
  const skipped = results.filter((result) => result.status === "SKIP");
  process.stdout.write(
    `SUMMARY pass=${results.length - failed.length - skipped.length} fail=${failed.length} skip=${skipped.length}\n`,
  );
  if (failed.length > 0) process.exitCode = 1;
}

await main().finally(() => {
  globalThis.fetch = nativeFetch;
});
