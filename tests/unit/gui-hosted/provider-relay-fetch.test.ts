import { describe, expect, it, vi } from "vitest";
import {
  createHostedProviderFetch,
  createHostedRelayManifestLoader,
  fetchHostedRelayManifest,
} from "../../../gui/hosted/runtime/provider-relay-fetch.js";

describe("hosted provider relay fetch", () => {
  it("serializes a proxy-classified request and reconstructs a normal Response", async () => {
    const relayFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      expect(request.url).toBe("https://web.opencandle.app/v1/provider-fetch");
      expect(request.headers.get("x-opencandle-client")).toBe("0123456789abcdef0123456789abcdef");
      await expect(request.json()).resolves.toMatchObject({
        version: 1,
        provider: "yahoo",
        method: "GET",
        url: "https://query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=1d&range=1d",
        headers: { "user-agent": "OpenCandle/1.0" },
      });
      return new Response(
        JSON.stringify({
          version: 1,
          status: 200,
          statusText: "OK",
          headers: { "content-type": "application/json", "set-cookie": "A=1" },
          bodyBase64: Buffer.from('{"chart":{"result":[]}}').toString("base64"),
        }),
      );
    });
    const hostedFetch = createHostedProviderFetch({
      relayUrl: "https://web.opencandle.app/v1/provider-fetch",
      clientId: "0123456789abcdef0123456789abcdef",
      fetchImpl: relayFetch,
    });

    const response = await hostedFetch(
      "https://query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=1d&range=1d",
      { headers: { "User-Agent": "OpenCandle/1.0" } },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBe("A=1");
    await expect(response.json()).resolves.toEqual({ chart: { result: [] } });
    expect(relayFetch).toHaveBeenCalledOnce();
  });

  it.each([
    "https://gamma-api.polymarket.com/public-search?q=fed",
    "https://api.coingecko.com/api/v3/coins/bitcoin",
    "https://www.alphavantage.co/query?function=OVERVIEW&symbol=AAPL&apikey=test",
    "https://api.openai.com/v1/responses",
    "https://api.anthropic.com/v1/messages",
  ])("leaves direct and model requests direct: %s", async (url) => {
    const directFetch = vi.fn(async () => new Response("direct"));
    const hostedFetch = createHostedProviderFetch({
      relayUrl: "https://web.opencandle.app/v1/provider-fetch",
      clientId: "0123456789abcdef0123456789abcdef",
      fetchImpl: directFetch,
    });

    await expect(hostedFetch(url)).resolves.toBeInstanceOf(Response);
    expect(directFetch).toHaveBeenCalledWith(url, undefined);
  });

  it("fails closed when a proxy provider has no configured relay", async () => {
    const hostedFetch = createHostedProviderFetch({
      relayUrl: "",
      clientId: "0123456789abcdef0123456789abcdef",
      fetchImpl: vi.fn(),
    });

    await expect(
      hostedFetch("https://api.stlouisfed.org/fred/series?series_id=GDP"),
    ).rejects.toThrow("Hosted provider relay is unavailable");
  });

  it("propagates aborts to the relay request", async () => {
    const controller = new AbortController();
    const relayFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal?.aborted).toBe(true);
      throw new DOMException("aborted", "AbortError");
    });
    const hostedFetch = createHostedProviderFetch({
      relayUrl: "https://web.opencandle.app/v1/provider-fetch",
      clientId: "0123456789abcdef0123456789abcdef",
      fetchImpl: relayFetch,
    });

    controller.abort();
    await expect(
      hostedFetch("https://finnhub.io/api/v1/company-news?symbol=AAPL", {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("negotiates the exact relay policy version before tools are enabled", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("https://web.opencandle.app/v1/health");
      return new Response(JSON.stringify({ version: 1, providers: ["yahoo", "fred"] }));
    });
    await expect(
      fetchHostedRelayManifest({
        relayUrl: "https://web.opencandle.app/v1/provider-fetch",
        fetchImpl,
      }),
    ).resolves.toEqual({ version: 1, providers: ["fred", "yahoo"] });
  });

  it("fails relay negotiation on an incompatible policy version", async () => {
    await expect(
      fetchHostedRelayManifest({
        relayUrl: "https://web.opencandle.app/v1/provider-fetch",
        fetchImpl: vi.fn(
          async () => new Response(JSON.stringify({ version: 2, providers: ["yahoo"] })),
        ),
      }),
    ).rejects.toThrow("incompatible");
  });

  it("retries relay negotiation after a transient failure and caches success", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary outage"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: 1, providers: ["yahoo"] })));
    const load = createHostedRelayManifestLoader({
      relayUrl: "https://web.opencandle.app/v1/provider-fetch",
      fetchImpl,
    });

    await expect(load()).resolves.toBeUndefined();
    await expect(load()).resolves.toEqual({ version: 1, providers: ["yahoo"] });
    await expect(load()).resolves.toEqual({ version: 1, providers: ["yahoo"] });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("revalidates an expired manifest and fails closed when refresh fails", async () => {
    let now = 0;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: 1, providers: ["yahoo"] })))
      .mockRejectedValueOnce(new Error("relay withdrawn"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: 1, providers: ["fred"] })));
    const load = createHostedRelayManifestLoader({
      relayUrl: "https://web.opencandle.app/v1/provider-fetch",
      fetchImpl,
      maxAgeMs: 1_000,
      now: () => now,
    });

    await expect(load()).resolves.toEqual({ version: 1, providers: ["yahoo"] });
    now = 500;
    await expect(load()).resolves.toEqual({ version: 1, providers: ["yahoo"] });
    now = 1_001;
    await expect(load()).resolves.toBeUndefined();
    await expect(load()).resolves.toEqual({ version: 1, providers: ["fred"] });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("bounds relay negotiation while the manifest body is still streaming", async () => {
    vi.useFakeTimers();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });

    try {
      const negotiation = fetchHostedRelayManifest({
        relayUrl: "https://web.opencandle.app/v1/provider-fetch",
        timeoutMs: 250,
        fetchImpl: vi.fn(async () => new Response(body)),
      });
      const rejection = expect(negotiation).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(250);
      await rejection;
      expect(cancelled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels a streamed relay manifest that exceeds its byte bound", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(20_000));
      },
      cancel() {
        cancelled = true;
      },
    });

    await expect(
      fetchHostedRelayManifest({
        relayUrl: "https://web.opencandle.app/v1/provider-fetch",
        fetchImpl: vi.fn(async () => new Response(body)),
      }),
    ).rejects.toThrow("too large");
    expect(cancelled).toBe(true);
  });
});
