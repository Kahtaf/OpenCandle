import { describe, expect, it, vi } from "vitest";
import {
  createHostedProviderFetch,
  createHostedRelayManifestLoader,
  createHostedRuntimeTokenManager,
  fetchHostedRelayManifest,
  fetchHostedRuntimeAuthorization,
  relayProviderForUrl,
} from "../../../gui/hosted/runtime/provider-relay-fetch.js";

describe("hosted provider relay fetch", () => {
  it("exchanges a rate-limited client request for bounded runtime authorization", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      expect(request.url).toBe("https://web.opencandle.app/v1/runtime-token");
      expect(request.method).toBe("POST");
      expect(request.headers.get("x-opencandle-client")).toBe("0123456789abcdef0123456789abcdef");
      return new Response(
        JSON.stringify({ version: 1, token: "payload.signature", expiresAt: 2_000_000 }),
      );
    });

    await expect(
      fetchHostedRuntimeAuthorization({
        relayUrl: "https://web.opencandle.app/v1/provider-fetch",
        clientId: "0123456789abcdef0123456789abcdef",
        fetchImpl,
      }),
    ).resolves.toEqual({ token: "payload.signature", expiresAt: 2_000_000 });
  });

  it("bounds runtime authorization when the relay stalls", async () => {
    vi.useFakeTimers();
    try {
      const authorization = fetchHostedRuntimeAuthorization({
        relayUrl: "https://web.opencandle.app/v1/provider-fetch",
        clientId: "0123456789abcdef0123456789abcdef",
        timeoutMs: 250,
        fetchImpl: vi.fn(
          async (_input, init) =>
            new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener(
                "abort",
                () => reject(new DOMException("aborted", "AbortError")),
                { once: true },
              );
            }),
        ),
      });
      const rejection = expect(authorization).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(250);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it("surfaces only the relay's bounded semantic authorization error", async () => {
    await expect(
      fetchHostedRuntimeAuthorization({
        relayUrl: "https://web.opencandle.app/v1/provider-fetch",
        clientId: "0123456789abcdef0123456789abcdef",
        fetchImpl: vi.fn(async () =>
          Response.json({ error: "relay_rate_limited" }, { status: 429 }),
        ),
      }),
    ).rejects.toThrow("429: relay_rate_limited");
  });

  it("refreshes runtime authorization before expiry and coalesces concurrent refreshes", async () => {
    let now = 1_000_000;
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request("https://web.opencandle.app/v1/runtime-token", init);
      expect(request.headers.get("x-opencandle-runtime-token")).toBe("old.signature");
      return new Response(
        JSON.stringify({ version: 1, token: "new.signature", expiresAt: 2_000_000 }),
      );
    });
    const getRuntimeToken = createHostedRuntimeTokenManager({
      relayUrl: "https://web.opencandle.app/v1/provider-fetch",
      clientId: "0123456789abcdef0123456789abcdef",
      initialToken: "old.signature",
      expiresAt: 1_000_500,
      fetchImpl,
      now: () => now,
    });

    await expect(Promise.all([getRuntimeToken(), getRuntimeToken()])).resolves.toEqual([
      "new.signature",
      "new.signature",
    ]);
    expect(fetchImpl).toHaveBeenCalledOnce();
    now += 1_000;
    await expect(getRuntimeToken()).resolves.toBe("new.signature");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("lazily exchanges initial runtime authorization inside the runtime", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request("https://web.opencandle.app/v1/runtime-token", init);
      expect(request.headers.get("x-opencandle-runtime-token")).toBeNull();
      return Response.json({ version: 1, token: "runtime.signature", expiresAt: 2_000_000 });
    });
    const getRuntimeToken = createHostedRuntimeTokenManager({
      relayUrl: "https://web.opencandle.app/v1/provider-fetch",
      clientId: "0123456789abcdef0123456789abcdef",
      fetchImpl,
      now: () => 1_000_000,
    });

    await expect(Promise.all([getRuntimeToken(), getRuntimeToken()])).resolves.toEqual([
      "runtime.signature",
      "runtime.signature",
    ]);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("serializes a proxy-classified request and reconstructs a normal Response", async () => {
    const relayFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      expect(request.url).toBe("https://web.opencandle.app/v1/provider-fetch");
      expect(request.headers.get("x-opencandle-client")).toBe("0123456789abcdef0123456789abcdef");
      expect(request.headers.get("x-opencandle-runtime-token")).toBe("payload.signature");
      await expect(request.json()).resolves.toMatchObject({
        version: 1,
        provider: "yahoo",
        method: "GET",
        url: "https://query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=1d&range=1d",
        headers: { "user-agent": "OpenCandle/1.0" },
        upstreamCookie: "A3=session-cookie",
      });
      return new Response(
        JSON.stringify({
          version: 1,
          status: 200,
          statusText: "OK",
          headers: { "content-type": "application/json" },
          upstreamSetCookie: "A=1",
          bodyBase64: Buffer.from('{"chart":{"result":[]}}').toString("base64"),
        }),
      );
    });
    const hostedFetch = createHostedProviderFetch({
      relayUrl: "https://web.opencandle.app/v1/provider-fetch",
      clientId: "0123456789abcdef0123456789abcdef",
      fetchImpl: relayFetch,
      getRuntimeToken: async () => "payload.signature",
    });

    const response = await hostedFetch(
      "https://query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=1d&range=1d",
      { headers: { "User-Agent": "OpenCandle/1.0", Cookie: "A3=session-cookie" } },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("x-opencandle-upstream-set-cookie")).toBe("A=1");
    await expect(response.json()).resolves.toEqual({ chart: { result: [] } });
    expect(relayFetch).toHaveBeenCalledOnce();
  });

  it("routes the fixed DuckDuckGo request hosts through the relay", () => {
    expect(relayProviderForUrl(new URL("https://duckduckgo.com/?q=AAPL"))).toBe("ddg");
    expect(relayProviderForUrl(new URL("https://links.duckduckgo.com/d.js?vqd=1-1"))).toBe("ddg");
    expect(relayProviderForUrl(new URL("https://html.duckduckgo.com/html/"))).toBe("ddg");
    expect(relayProviderForUrl(new URL("https://lite.duckduckgo.com/lite/"))).toBe("ddg");
  });

  it.each([
    "https://gamma-api.polymarket.com/public-search?q=fed",
    "https://api.coingecko.com/api/v3/coins/bitcoin",
    "https://www.alphavantage.co/query?function=OVERVIEW&symbol=AAPL&apikey=test",
  ])("leaves browser-compatible providers direct: %s", async (url) => {
    const directFetch = vi.fn(async () => new Response("direct"));
    const hostedFetch = createHostedProviderFetch({
      relayUrl: "https://web.opencandle.app/v1/provider-fetch",
      clientId: "0123456789abcdef0123456789abcdef",
      fetchImpl: directFetch,
    });

    await expect(hostedFetch(url)).resolves.toBeInstanceOf(Response);
    expect(directFetch).toHaveBeenCalledWith(url, undefined);
  });

  it.each([
    [
      "openai",
      "https://api.openai.com/v1/responses",
      { Authorization: "Bearer openai-secret", "Content-Type": "application/json" },
    ],
    [
      "anthropic",
      "https://api.anthropic.com/v1/messages",
      { "X-Api-Key": "anthropic-secret", "Anthropic-Version": "2023-06-01" },
    ],
    [
      "google",
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse",
      { "X-Goog-Api-Key": "google-secret", "Content-Type": "application/json" },
    ],
  ] as const)("streams %s model traffic through the raw relay", async (provider, url, headers) => {
    const relayFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      expect(request.url).toBe("https://web.opencandle.app/v1/model-fetch");
      expect(request.headers.get("x-opencandle-client")).toBe("0123456789abcdef0123456789abcdef");
      expect(request.headers.get("x-opencandle-runtime-token")).toBe("payload.signature");
      expect(request.headers.get("x-opencandle-provider")).toBe(provider);
      expect(request.headers.get("x-opencandle-upstream-url")).toBe(url);
      expect(request.headers.get("authorization")).toBe(
        provider === "openai" ? "Bearer openai-secret" : null,
      );
      expect(request.headers.get("x-api-key")).toBe(
        provider === "anthropic" ? "anthropic-secret" : null,
      );
      expect(request.headers.get("x-goog-api-key")).toBe(
        provider === "google" ? "google-secret" : null,
      );
      await expect(request.text()).resolves.toBe('{"stream":true}');
      return new Response('data: {"type":"response.completed"}\n\n', {
        headers: { "content-type": "text/event-stream", "x-request-id": "request-1" },
      });
    });
    const hostedFetch = createHostedProviderFetch({
      relayUrl: "https://web.opencandle.app/v1/provider-fetch",
      clientId: "0123456789abcdef0123456789abcdef",
      fetchImpl: relayFetch,
      loadRelayManifest: async () => ({ version: 1, providers: [provider] }),
      getRuntimeToken: async () => "payload.signature",
    });

    const response = await hostedFetch(url, {
      method: "POST",
      headers,
      body: '{"stream":true}',
    });

    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("x-request-id")).toBe("request-1");
    await expect(response.text()).resolves.toContain("response.completed");
  });

  it("routes model-key probes through the same model relay boundary", async () => {
    const relayFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      expect(request.url).toBe("https://web.opencandle.app/v1/model-fetch");
      expect(request.headers.get("x-opencandle-provider")).toBe("openai");
      expect(request.headers.get("x-opencandle-upstream-method")).toBe("GET");
      expect(request.headers.get("authorization")).toBe("Bearer key");
      expect(request.body).toBeNull();
      return new Response('{"data":[]}');
    });
    const hostedFetch = createHostedProviderFetch({
      relayUrl: "https://web.opencandle.app/v1/provider-fetch",
      clientId: "0123456789abcdef0123456789abcdef",
      fetchImpl: relayFetch,
      loadRelayManifest: async () => ({ version: 1, providers: ["openai"] }),
    });

    await expect(
      hostedFetch("https://api.openai.com/v1/models", {
        headers: { authorization: "Bearer key" },
      }),
    ).resolves.toBeInstanceOf(Response);
  });

  it("fails closed when the negotiated relay manifest omits a model provider", async () => {
    const relayFetch = vi.fn();
    const hostedFetch = createHostedProviderFetch({
      relayUrl: "https://web.opencandle.app/v1/provider-fetch",
      clientId: "0123456789abcdef0123456789abcdef",
      fetchImpl: relayFetch,
      loadRelayManifest: async () => ({ version: 1, providers: ["yahoo"] }),
    });

    await expect(
      hostedFetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { authorization: "Bearer key" },
        body: "{}",
      }),
    ).rejects.toThrow("OpenAI model relay is unavailable");
    expect(relayFetch).not.toHaveBeenCalled();
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
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://web.opencandle.app/v1/health");
      expect(new Headers(init?.headers).get("x-opencandle-runtime-token")).toBe(
        "payload.signature",
      );
      expect(new Headers(init?.headers).get("x-opencandle-client")).toBe(
        "0123456789abcdef0123456789abcdef",
      );
      return new Response(JSON.stringify({ version: 1, providers: ["yahoo", "fred"] }));
    });
    await expect(
      fetchHostedRelayManifest({
        relayUrl: "https://web.opencandle.app/v1/provider-fetch",
        clientId: "0123456789abcdef0123456789abcdef",
        getRuntimeToken: async () => "payload.signature",
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

  it("reports a bounded relay negotiation failure to hosted diagnostics", async () => {
    const onError = vi.fn();
    const load = createHostedRelayManifestLoader({
      relayUrl: "https://web.opencandle.app/v1/provider-fetch",
      fetchImpl: vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
      onError,
    });

    await expect(load()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "fetch failed" }));
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
