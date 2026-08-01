import { describe, expect, it, vi } from "vitest";
import { createProviderRelay } from "../src/relay.js";

const endpoint = "https://relay.test/v1/provider-fetch";
const modelEndpoint = "https://relay.test/v1/model-fetch";

describe("hosted provider relay", () => {
  it("rejects untrusted browser origins before rate limiting", async () => {
    const relay = createProviderRelay({ fetchImpl: vi.fn() });
    const env = environment();
    const response = await relay.fetch(
      relayRequest(
        {
          provider: "yahoo",
          method: "GET",
          url: "https://query1.finance.yahoo.com/v8/finance/chart/AAPL",
        },
        undefined,
        undefined,
        "https://attacker.example",
      ),
      env,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "origin_not_allowed" });
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(env.PROVIDER_RELAY_RATE_LIMITER.limit).not.toHaveBeenCalled();
  });

  it("echoes the approved hosted origin in CORS responses", async () => {
    const relay = createProviderRelay({ fetchImpl: vi.fn(async () => new Response("{}")) });
    const response = await relay.fetch(
      relayRequest(
        {
          provider: "yahoo",
          method: "GET",
          url: "https://query1.finance.yahoo.com/v8/finance/chart/AAPL",
        },
        undefined,
        undefined,
        "https://web.opencandle.app",
      ),
      environment(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://web.opencandle.app",
    );
    expect(response.headers.get("vary")).toBe("Origin");
  });

  it.each([
    ["brave", "GET", "https://api.search.brave.com/res/v1/web/search?q=markets"],
    ["exa", "POST", "https://api.exa.ai/search"],
    ["fear_greed", "GET", "https://api.alternative.me/fng/?limit=1"],
    ["fred", "GET", "https://api.stlouisfed.org/fred/series?series_id=GDP"],
    ["tradingview", "POST", "https://scanner.tradingview.com/america/scan2"],
    ["yahoo", "GET", "https://query1.finance.yahoo.com/v8/finance/chart/AAPL"],
    ["yahoo", "GET", "https://query2.finance.yahoo.com/v7/finance/quote?symbols=AAPL"],
    [
      "yahoo",
      "GET",
      "https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/AAPL?type=annualTotalRevenue",
    ],
  ] as const)("accepts the audited %s policy", async (provider, method, url) => {
    const upstreamFetch = vi.fn(async () => new Response("{}"));
    const relay = createProviderRelay({ fetchImpl: upstreamFetch });
    const response = await relay.fetch(
      relayRequest({
        provider,
        method,
        url,
        headers: method === "POST" ? { "content-type": "application/json" } : {},
        ...(method === "POST" ? { bodyBase64: Buffer.from("{}").toString("base64") } : {}),
      }),
      environment(),
    );

    expect(response.status).toBe(200);
    expect(upstreamFetch).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "openai",
      "https://api.openai.com/v1/responses",
      { authorization: "Bearer openai-secret", "content-type": "application/json" },
    ],
    [
      "anthropic",
      "https://api.anthropic.com/v1/messages",
      {
        "x-api-key": "anthropic-secret",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
    ],
    [
      "google",
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse",
      { "x-goog-api-key": "google-secret", "content-type": "application/json" },
    ],
  ] as const)("streams the audited %s model API without buffering", async (provider, url, headers) => {
    const upstreamFetch = vi.fn(async (request: Request) => {
      expect(request.url).toBe(url);
      expect(request.method).toBe("POST");
      for (const [name, value] of Object.entries(headers)) {
        expect(request.headers.get(name)).toBe(value);
      }
      await expect(request.text()).resolves.toBe('{"stream":true}');
      return new Response('data: {"type":"response.completed"}\n\n', {
        headers: {
          "content-type": "text/event-stream",
          "x-request-id": "request-1",
          "set-cookie": "must-not-leak=1",
        },
      });
    });
    const relay = createProviderRelay({ fetchImpl: upstreamFetch });

    const response = await relay.fetch(
      modelRelayRequest({ provider, url, headers, body: '{"stream":true}' }),
      environment(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("x-request-id")).toBe("request-1");
    expect(response.headers.get("set-cookie")).toBeNull();
    await expect(response.text()).resolves.toContain("response.completed");
  });

  it.each([
    ["openai", "https://attacker.example/v1/responses"],
    ["openai", "https://api.openai.com/v1/files"],
    ["anthropic", "https://api.anthropic.com/v1/admin"],
    ["google", "https://generativelanguage.googleapis.com/v1beta/files"],
  ])("rejects model relay destination %s %s", async (provider, url) => {
    const upstreamFetch = vi.fn();
    const relay = createProviderRelay({ fetchImpl: upstreamFetch });
    const response = await relay.fetch(
      modelRelayRequest({ provider, url, headers: {}, body: "{}" }),
      environment(),
    );

    expect(response.status).toBe(403);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("does not reflect model credentials when an upstream request fails", async () => {
    const credential = "model-credential-canary";
    const relay = createProviderRelay({
      fetchImpl: vi.fn(async () => {
        throw new Error(credential);
      }),
    });
    const response = await relay.fetch(
      modelRelayRequest({
        provider: "openai",
        url: "https://api.openai.com/v1/responses",
        headers: { authorization: `Bearer ${credential}` },
        body: "{}",
      }),
      environment(),
    );

    expect(response.status).toBe(502);
    expect(await response.text()).toBe('{"error":"upstream_unavailable"}');
  });

  it("does not reflect model credentials from a non-success upstream body", async () => {
    const credential = "model-credential-in-error-body";
    let cancelled = false;
    const relay = createProviderRelay({
      fetchImpl: vi.fn(async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(`invalid key: ${credential}`));
            },
            cancel() {
              cancelled = true;
            },
          }),
          { status: 401 },
        ),
      ),
    });
    const response = await relay.fetch(
      modelRelayRequest({
        provider: "openai",
        url: "https://api.openai.com/v1/responses",
        headers: { authorization: `Bearer ${credential}` },
        body: "{}",
      }),
      environment(),
    );

    expect(response.status).toBe(401);
    expect(await response.text()).toBe('{"error":"model_provider_request_failed"}');
    expect(cancelled).toBe(true);
  });

  it("rejects an oversized model request before forwarding it", async () => {
    const upstreamFetch = vi.fn();
    const relay = createProviderRelay({ maxModelRequestBytes: 3, fetchImpl: upstreamFetch });
    const response = await relay.fetch(
      modelRelayRequest({
        provider: "openai",
        url: "https://api.openai.com/v1/responses",
        headers: { authorization: "Bearer test" },
        body: "four",
      }),
      environment(),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: "request_too_large" });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("terminates an oversized streamed model response", async () => {
    const relay = createProviderRelay({
      maxModelResponseBytes: 3,
      fetchImpl: vi.fn(async () => new Response("four")),
    });
    const response = await relay.fetch(
      modelRelayRequest({
        provider: "openai",
        url: "https://api.openai.com/v1/models",
        headers: { authorization: "Bearer test" },
      }),
      environment(),
    );

    expect(response.status).toBe(200);
    await expect(response.text()).rejects.toBeDefined();
  });

  it("cancels a model stream that stalls after response headers", async () => {
    let cancelled = false;
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: first\n\n"));
      },
      cancel() {
        cancelled = true;
      },
    });
    const relay = createProviderRelay({
      modelTimeoutMs: 20,
      fetchImpl: vi.fn(async () => new Response(upstream)),
    });
    const response = await relay.fetch(
      modelRelayRequest({
        provider: "openai",
        url: "https://api.openai.com/v1/responses",
        headers: { authorization: "Bearer test", "content-type": "application/json" },
        body: "{}",
      }),
      environment(),
    );
    const reader = response.body!.getReader();

    await expect(reader.read()).resolves.toMatchObject({ done: false });
    await expect(reader.read()).rejects.toThrow("upstream_timeout");
    expect(cancelled).toBe(true);
  });

  it.each(["america", "global"])(
    "accepts the complete hosted TradingView market contract for %s",
    async (market) => {
      const upstreamFetch = vi.fn(async () => new Response("{}"));
      const relay = createProviderRelay({ fetchImpl: upstreamFetch });
      const response = await relay.fetch(
        relayRequest({
          provider: "tradingview",
          method: "POST",
          url: `https://scanner.tradingview.com/${market}/scan2?label-product=screener-stock`,
          headers: { "content-type": "application/json" },
          bodyBase64: Buffer.from("{}").toString("base64"),
        }),
        environment(),
      );

      expect(response.status).toBe(200);
      expect(upstreamFetch).toHaveBeenCalledOnce();
    },
  );

  it("rejects TradingView market paths outside the hosted screener contract", async () => {
    const upstreamFetch = vi.fn();
    const relay = createProviderRelay({ fetchImpl: upstreamFetch });
    const response = await relay.fetch(
      relayRequest({
        provider: "tradingview",
        method: "POST",
        url: "https://scanner.tradingview.com/germany/scan2?label-product=screener-stock",
        headers: { "content-type": "application/json" },
        bodyBase64: Buffer.from("{}").toString("base64"),
      }),
      environment(),
    );

    expect(response.status).toBe(403);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it.each([
    ["alpha_vantage", "https://www.alphavantage.co/query?function=GLOBAL_QUOTE"],
    ["coingecko", "https://api.coingecko.com/api/v3/coins/bitcoin"],
    ["polymarket", "https://gamma-api.polymarket.com/public-search?q=fed"],
    ["sec_edgar", "https://www.sec.gov/files/company_tickers.json"],
    ["finnhub", "https://finnhub.io/api/v1/company-news?symbol=AAPL"],
    ["lse", "https://api.londonstrategicedge.com/vault/candles?symbol=AAPL"],
  ])("rejects browser-direct provider %s", async (provider, url) => {
    const upstreamFetch = vi.fn();
    const relay = createProviderRelay({ fetchImpl: upstreamFetch });
    const response = await relay.fetch(
      relayRequest({ provider, method: "GET", url }),
      environment(),
    );

    expect(response.status).toBe(400);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("forwards one allowed provider request and reconstructs a bounded envelope", async () => {
    const upstreamFetch = vi.fn(async (request: Request) => {
      expect(request.url).toBe(
        "https://query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=1d&range=1d",
      );
      expect(request.method).toBe("GET");
      expect(request.headers.get("user-agent")).toBe("OpenCandle/1.0");
      return new Response('{"chart":{"result":[]}}', {
        status: 200,
        headers: { "content-type": "application/json", "retry-after": "2" },
      });
    });
    const relay = createProviderRelay({ fetchImpl: upstreamFetch });

    const response = await relay.fetch(
      relayRequest({
        provider: "yahoo",
        url: "https://query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=1d&range=1d",
        method: "GET",
        headers: { "User-Agent": "OpenCandle/1.0" },
      }),
      environment(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      version: 1,
      status: 200,
      statusText: "",
      headers: { "content-type": "application/json", "retry-after": "2" },
      bodyBase64: Buffer.from('{"chart":{"result":[]}}').toString("base64"),
    });
    expect(upstreamFetch).toHaveBeenCalledOnce();
  });

  it("carries Yahoo cookies outside browser-forbidden header fields", async () => {
    const upstreamFetch = vi.fn(async (request: Request) => {
      expect(request.headers.get("cookie")).toBe("A3=session-cookie");
      return new Response("ok", { headers: { "set-cookie": "A3=next-cookie; Path=/" } });
    });
    const relay = createProviderRelay({ fetchImpl: upstreamFetch });

    const response = await relay.fetch(
      relayRequest({
        provider: "yahoo",
        url: "https://query2.finance.yahoo.com/v1/test/getcrumb",
        method: "GET",
        upstreamCookie: "A3=session-cookie",
      }),
      environment(),
    );

    await expect(response.json()).resolves.toMatchObject({
      headers: {},
      upstreamSetCookie: "A3=next-cookie; Path=/",
    });
  });

  it("rejects cookie side channels for non-Yahoo providers", async () => {
    const upstreamFetch = vi.fn();
    const relay = createProviderRelay({ fetchImpl: upstreamFetch });
    const response = await relay.fetch(
      relayRequest({
        provider: "fred",
        url: "https://api.stlouisfed.org/fred/series?series_id=GDP",
        method: "GET",
        upstreamCookie: "secret",
      }),
      environment(),
    );

    expect(response.status).toBe(403);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("rejects an arbitrary destination before fetch", async () => {
    const upstreamFetch = vi.fn();
    const relay = createProviderRelay({ fetchImpl: upstreamFetch });

    const response = await relay.fetch(
      relayRequest({
        provider: "yahoo",
        url: "https://attacker.example/private",
        method: "GET",
      }),
      environment(),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "provider_request_not_allowed",
    });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it.each([
    ["GET", "/v1/provider-fetch", 405],
    ["GET", "/v1/model-fetch", 405],
    ["POST", "/not-a-relay", 404],
  ])("rejects %s %s", async (method, path, status) => {
    const relay = createProviderRelay({ fetchImpl: vi.fn() });
    const response = await relay.fetch(
      new Request(`https://relay.test${path}`, { method }),
      environment(),
    );
    expect(response.status).toBe(status);
  });

  it("strips unapproved headers and denies provider/header mismatches", async () => {
    const upstreamFetch = vi.fn();
    const relay = createProviderRelay({ fetchImpl: upstreamFetch });
    const response = await relay.fetch(
      relayRequest({
        provider: "brave",
        url: "https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=AAPL&apikey=test",
        method: "GET",
        headers: { Cookie: "secret", Authorization: "Bearer secret" },
      }),
      environment(),
    );

    expect(response.status).toBe(403);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("returns a bounded client error for an invalid allowed header value", async () => {
    const upstreamFetch = vi.fn();
    const relay = createProviderRelay({ fetchImpl: upstreamFetch });
    const response = await relay.fetch(
      relayRequest({
        provider: "yahoo",
        url: "https://query1.finance.yahoo.com/v8/finance/chart/AAPL",
        method: "GET",
        headers: { accept: "application/json\r\nx-injected: true" },
      }),
      environment(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_request" });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("cancels an oversized upstream response without returning partial data", async () => {
    const relay = createProviderRelay({
      maxResponseBytes: 3,
      fetchImpl: vi.fn(async () => new Response("four")),
    });
    const response = await relay.fetch(
      relayRequest({
        provider: "yahoo",
        url: "https://query1.finance.yahoo.com/v8/finance/chart/AAPL",
        method: "GET",
      }),
      environment(),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "upstream_response_too_large" });
  });

  it("rejects an oversized request before forwarding upstream", async () => {
    const upstreamFetch = vi.fn();
    const relay = createProviderRelay({ maxRequestBytes: 32, fetchImpl: upstreamFetch });
    const response = await relay.fetch(
      relayRequest({
        provider: "yahoo",
        url: "https://query1.finance.yahoo.com/v8/finance/chart/AAPL",
        method: "GET",
        padding: "x".repeat(64),
      }),
      environment(),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: "request_too_large" });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("aborts a stalled upstream request and returns a bounded timeout", async () => {
    let forwardedSignal: AbortSignal | undefined;
    const upstreamFetch = vi.fn(
      async (request: Request) =>
        new Promise<Response>((_resolve, reject) => {
          forwardedSignal = request.signal;
          request.signal.addEventListener(
            "abort",
            () => reject(request.signal.reason ?? new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    const relay = createProviderRelay({ timeoutMs: 1, fetchImpl: upstreamFetch });
    const response = await relay.fetch(
      relayRequest({
        provider: "yahoo",
        url: "https://query1.finance.yahoo.com/v8/finance/chart/AAPL",
        method: "GET",
      }),
      environment(),
    );

    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toEqual({ error: "upstream_timeout" });
    expect(forwardedSignal?.aborted).toBe(true);
  });

  it("does not reflect credentials from an upstream failure", async () => {
    const credential = "credential-canary-do-not-reflect";
    const relay = createProviderRelay({
      fetchImpl: vi.fn(async () => {
        throw new Error(credential);
      }),
    });
    const response = await relay.fetch(
      relayRequest({
        provider: "brave",
        url: "https://api.search.brave.com/res/v1/web/search?q=markets",
        method: "GET",
        headers: { "X-Subscription-Token": credential },
      }),
      environment(),
    );

    expect(response.status).toBe(502);
    expect(await response.text()).toBe('{"error":"upstream_unavailable"}');
  });

  it("does not reflect an upstream HTTP error body that contains credentials", async () => {
    const credential = "credential-canary-from-upstream-body";
    const relay = createProviderRelay({
      fetchImpl: vi.fn(async () =>
        new Response(`invalid API key: ${credential}`, {
          status: 401,
          headers: { "content-type": "text/plain" },
        }),
      ),
    });
    const response = await relay.fetch(
      relayRequest({
        provider: "brave",
        url: "https://api.search.brave.com/res/v1/web/search?q=markets",
        method: "GET",
        headers: { "X-Subscription-Token": credential },
      }),
      environment(),
    );

    const body = await response.text();
    expect(body).not.toContain(credential);
    expect(JSON.parse(body)).toMatchObject({ version: 1, status: 401, bodyBase64: "" });
  });

  it("rejects redirects without following them", async () => {
    const upstreamFetch = vi.fn(async () =>
      new Response(null, { status: 302, headers: { location: "https://attacker.example" } }),
    );
    const relay = createProviderRelay({ fetchImpl: upstreamFetch });
    const response = await relay.fetch(
      relayRequest({
        provider: "fred",
        url: "https://api.stlouisfed.org/fred/series?series_id=GDP&api_key=test",
        method: "GET",
      }),
      environment(),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "upstream_redirect_rejected" });
    expect((upstreamFetch.mock.calls[0]?.[0] as Request).redirect).toBe("manual");
  });

  it("rate limits before reading or forwarding provider data", async () => {
    const upstreamFetch = vi.fn();
    const relay = createProviderRelay({ fetchImpl: upstreamFetch });
    const env = environment();
    env.PROVIDER_RELAY_RATE_LIMITER.limit.mockResolvedValue({ success: false });
    const response = await relay.fetch(
      relayRequest({
        provider: "yahoo",
        url: "https://query1.finance.yahoo.com/v8/finance/chart/AAPL",
        method: "GET",
      }),
      env,
    );

    expect(response.status).toBe(429);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("uses one pseudonymous server-observed rate-limit key across rotated client ids", async () => {
    const relay = createProviderRelay({ fetchImpl: vi.fn(async () => new Response("{}")) });
    const env = environment();
    const target = {
      provider: "yahoo",
      url: "https://query1.finance.yahoo.com/v8/finance/chart/AAPL",
      method: "GET",
    };

    await relay.fetch(
      relayRequest(target, "0123456789abcdef0123456789abcdef", "203.0.113.10"),
      env,
    );
    await relay.fetch(
      relayRequest(target, "fedcba9876543210fedcba9876543210", "203.0.113.10"),
      env,
    );

    const firstKey = env.PROVIDER_RELAY_RATE_LIMITER.limit.mock.calls[0]?.[0].key;
    const secondKey = env.PROVIDER_RELAY_RATE_LIMITER.limit.mock.calls[1]?.[0].key;
    expect(firstKey).toBe(secondKey);
    expect(firstKey).not.toContain("203.0.113.10");
    expect(firstKey).not.toContain("0123456789abcdef0123456789abcdef");
  });

  it("fails closed when the server-observed rate-limit identity is unavailable", async () => {
    const upstreamFetch = vi.fn();
    const relay = createProviderRelay({ fetchImpl: upstreamFetch });
    const request = relayRequest({
      provider: "yahoo",
      url: "https://query1.finance.yahoo.com/v8/finance/chart/AAPL",
      method: "GET",
    });
    request.headers.delete("cf-connecting-ip");

    const response = await relay.fetch(request, environment());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "relay_rate_limit_identity_unavailable",
    });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("publishes only the policy version and provider ids in health", async () => {
    const relay = createProviderRelay({ fetchImpl: vi.fn() });
    const response = await relay.fetch(
      new Request("https://relay.test/v1/health"),
      environment(),
    );
    const body = (await response.json()) as { version: number; providers: string[] };
    expect(body.version).toBe(1);
    expect(body.providers).toContain("yahoo");
    expect(JSON.stringify(body)).not.toContain("url");
  });
});

function relayRequest(
  body: Record<string, unknown>,
  clientId = "0123456789abcdef0123456789abcdef",
  connectingIp = "203.0.113.10",
  origin?: string,
): Request {
  return new Request(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-opencandle-client": clientId,
      "cf-connecting-ip": connectingIp,
      ...(origin ? { origin } : {}),
    },
    body: JSON.stringify({ version: 1, ...body }),
  });
}

function modelRelayRequest(input: {
  provider: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}): Request {
  return new Request(modelEndpoint, {
    method: "POST",
    headers: {
      ...input.headers,
      "x-opencandle-client": "0123456789abcdef0123456789abcdef",
      "x-opencandle-provider": input.provider,
      "x-opencandle-upstream-method": input.body === undefined ? "GET" : "POST",
      "x-opencandle-upstream-url": input.url,
      "cf-connecting-ip": "203.0.113.10",
    },
    body: input.body,
  });
}

function environment() {
  return {
    PROVIDER_RELAY_RATE_LIMITER: {
      limit: vi.fn(async () => ({ success: true })),
    },
  };
}
