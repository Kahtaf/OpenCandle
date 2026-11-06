import { currentAbortSignal, runWithAbortSignal } from "../infra/abort-context.js";
import { cache, TTL } from "../infra/cache.js";
import { httpGet } from "../infra/http-client.js";
import { rateLimiter } from "../infra/rate-limiter.js";
import { type FxLeg, type FxResult, resolveFx } from "../portfolio/fx.js";
import { wrapProvider } from "./wrap-provider.js";

interface ChartResponse {
  chart?: {
    result?: {
      meta?: {
        symbol?: string;
        currency?: string;
        regularMarketPrice?: number;
        regularMarketTime?: number;
        marketState?: string;
      };
    }[];
    error?: unknown;
  };
}
type Observation = Awaited<ReturnType<typeof fetchLeg>>;
const inFlight = new Map<string, Promise<Observation>>();

async function fetchLeg(source: string) {
  const symbol = `${source}USD=X`;
  const cacheKey = `yahoo:fx:${symbol}`;
  return wrapProvider("yahoo", async (): Promise<FxLeg> => {
    const cached = cache.get<FxLeg>(cacheKey);
    if (cached) return { ...cached, cacheStatus: "cached" };
    await rateLimiter.acquire("yahoo");
    const data = await httpGet<ChartResponse>(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`,
      { maxRetries: 0, headers: { "User-Agent": "OpenCandle/1.0" } },
    );
    const meta = data.chart?.result?.[0]?.meta;
    if (data.chart?.error || !meta) throw new Error("missing_fx_observation");
    const leg: FxLeg = {
      provider: "yahoo",
      requestedSymbol: symbol,
      returnedSymbol: meta.symbol ?? "",
      rawUnit: meta.currency ?? "",
      source,
      target: "USD",
      rate: meta.regularMarketPrice ?? NaN,
      observedAt: typeof meta.regularMarketTime === "number" ? meta.regularMarketTime * 1000 : NaN,
      fetchedAt: Date.now(),
      cacheStatus: "fresh",
      marketState: meta.marketState ?? null,
    };
    // Cache observations, never failures; eligibility is rechecked against each snapshot clock.
    if (resolveFx(source, "USD", leg, leg.observedAt).status === "ok")
      cache.set(cacheKey, leg, TTL.QUOTE);
    return leg;
  });
}
function acquireLeg(source: string): Promise<Observation> {
  let request = inFlight.get(source);
  if (!request) {
    const deadline = AbortSignal.timeout(12000);
    request = runWithAbortSignal(deadline, () => fetchLeg(source))
      .catch((error): Observation => {
        // This deadline belongs to the shared acquisition, not a caller's Stop signal.
        // Preserve other holdings when FX times out; waitFor still propagates caller cancellation.
        if (!deadline.aborted) throw error;
        return { status: "unavailable", provider: "yahoo", reason: "fx_timeout" };
      })
      .finally(() => {
        inFlight.delete(source);
      });
    inFlight.set(source, request);
  }
  return request;
}
function waitFor<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** Create once per snapshot: memoizes successes and failures without a persistent negative cache. */
export function createFxResolver(now: number) {
  const observations = new Map<string, Promise<Observation>>();
  return async (source: string, target: string): Promise<FxResult> => {
    const preliminary = resolveFx(source, target, null, now);
    const signal = currentAbortSignal();
    signal?.throwIfAborted();
    if (preliminary.status === "ok" || preliminary.reason !== "missing_fx") return preliminary;
    const required = [source, target].filter((currency) => currency !== "USD");
    const results = await Promise.all(
      required.map((currency) => {
        let request = observations.get(currency);
        if (!request) {
          request = acquireLeg(currency);
          observations.set(currency, request);
        }
        return waitFor(request, signal);
      }),
    );
    const legs: FxLeg[] = [];
    for (const result of results) {
      if (result.status !== "ok")
        return {
          status: "unavailable",
          source,
          target,
          provider: result.provider,
          reason: result.reason,
        };
      legs.push(result.data);
    }
    return resolveFx(source, target, legs, now);
  };
}
