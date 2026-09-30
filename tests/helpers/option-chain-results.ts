import { cache } from "../../src/infra/cache.js";
import { rateLimiter } from "../../src/infra/rate-limiter.js";
import { clearCrumbCache } from "../../src/providers/yahoo-finance.js";
import { optionChainTool } from "../../src/tools/options/option-chain.js";

type OptionChainToolResult = Awaited<ReturnType<typeof optionChainTool.execute>>;

/**
 * Serve a Yahoo options fixture (plus the cookie/crumb handshake) without
 * touching the network. Anything else is rejected so a test cannot silently
 * depend on a live endpoint.
 */
export function yahooOptionsFetch(fixture: unknown, fallback?: typeof fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("https://fc.yahoo.com/")) {
      return new Response("", { status: 200, headers: { "set-cookie": "A3=d=test; Path=/" } });
    }
    if (url.startsWith("https://query2.finance.yahoo.com/v1/test/getcrumb")) {
      return new Response("testCrumb", { status: 200 });
    }
    if (url.startsWith("https://query1.finance.yahoo.com/v7/finance/options/")) {
      return new Response(JSON.stringify(fixture), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (fallback) return fallback(input, init);
    throw new Error(`Unexpected external URL in option-chain fixture test: ${url}`);
  }) as typeof fetch;
}

/** Run the real get_option_chain tool against a checked-in Yahoo fixture. */
export async function optionChainToolResult(
  fixture: unknown,
  symbol = "AAPL",
): Promise<OptionChainToolResult> {
  const originalFetch = globalThis.fetch;
  cache.clear();
  clearCrumbCache();
  rateLimiter.configure("yahoo", 5, 5);
  globalThis.fetch = yahooOptionsFetch(fixture);
  try {
    return await optionChainTool.execute("fixture-call", { symbol });
  } finally {
    globalThis.fetch = originalFetch;
    cache.clear();
    clearCrumbCache();
  }
}
