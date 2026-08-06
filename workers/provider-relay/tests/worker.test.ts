import { describe, expect, it, vi } from "vitest";
import {
  MODEL_RELAY_HEADERS,
  PROVIDER_RELAY_RUNTIME_TOKEN_PATH,
} from "../../../src/runtime/provider-relay-contract.js";
import { createProviderRelay } from "../src/relay.js";

const endpoint = "https://relay.test/v1/provider-fetch";
const modelEndpoint = "https://relay.test/v1/model-fetch";
const runtimeTokenEndpoint = `https://relay.test${PROVIDER_RELAY_RUNTIME_TOKEN_PATH}`;
const hostedOrigin = "https://web.opencandle.app";
const runtimeOrigin = "https://runtime-123.local-corp.webcontainer-api.io";
const stackblitzRuntimeOrigin = "https://stackblitz.com";
const clientId = "0123456789abcdef0123456789abcdef";

describe("hosted provider relay", () => {
  it("issues a rate-limited runtime token when a same-origin client omits Origin", async () => {
    const relay = createProviderRelay({
      fetchImpl: vi.fn(),
      now: () => 1_000_000,
    });
    const request = new Request(runtimeTokenEndpoint, {
      method: "POST",
      headers: {
        "cf-connecting-ip": "203.0.113.10",
        [MODEL_RELAY_HEADERS.client]: clientId,
      },
    });

    const issued = await relay.fetch(request, environment());

    expect(issued.status).toBe(200);
  });

  it("permits sandboxed WebContainer preflight while requiring a signed actual request", async () => {
    const relay = createProviderRelay({ fetchImpl: vi.fn() });
    const preflight = await relay.fetch(
      new Request("https://relay.test/v1/health", {
        method: "OPTIONS",
        headers: {
          origin: "null",
          "access-control-request-headers": `${MODEL_RELAY_HEADERS.client}, ${MODEL_RELAY_HEADERS.runtimeToken}`,
        },
      }),
      environment(),
    );
    const unsigned = await relay.fetch(
      new Request("https://relay.test/v1/health", {
        headers: { origin: "null", [MODEL_RELAY_HEADERS.client]: clientId },
      }),
      environment(),
    );

    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
    expect(unsigned.status).toBe(403);
    expect(unsigned.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("accepts the actual StackBlitz WebContainer execution origin", async () => {
    const relay = createProviderRelay({
      fetchImpl: vi.fn(),
      now: () => 1_000_000,
    });

    const issued = await relay.fetch(
      runtimeTokenRequest({
        origin: hostedOrigin,
      }),
      environment(),
    );

    expect(issued.status).toBe(200);
    const { token } = (await issued.json()) as { token: string };
    const health = await relay.fetch(
      new Request("https://relay.test/v1/health", {
        headers: {
          origin: stackblitzRuntimeOrigin,
          [MODEL_RELAY_HEADERS.client]: clientId,
          [MODEL_RELAY_HEADERS.runtimeToken]: token,
        },
      }),
      environment(),
    );
    expect(health.status).toBe(200);
    expect(health.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("authorizes an embedded runtime from token issuance through health and provider fetch", async () => {
    const upstreamFetch = vi.fn(async () => new Response('{"quotes":[{"symbol":"AAPL"}]}'));
    const relay = createProviderRelay({
      fetchImpl: upstreamFetch,
      now: () => 1_000_000,
    });
    const env = environment();

    const issued = await relay.fetch(
      runtimeTokenRequest({ origin: hostedOrigin }),
      env,
    );
    expect(issued.status).toBe(200);
    expect(issued.headers.get("access-control-allow-origin")).toBe(hostedOrigin);
    const authorization = (await issued.json()) as { token: string; expiresAt: number };
    expect(authorization.token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(authorization.expiresAt).toBeGreaterThan(1_000_000);

    const runtimeHeaders = {
      origin: runtimeOrigin,
      [MODEL_RELAY_HEADERS.client]: clientId,
      [MODEL_RELAY_HEADERS.runtimeToken]: authorization.token,
    };
    const preflight = await relay.fetch(
      new Request("https://relay.test/v1/health", {
        method: "OPTIONS",
        headers: {
          origin: runtimeOrigin,
          "access-control-request-headers": `${MODEL_RELAY_HEADERS.client}, ${MODEL_RELAY_HEADERS.runtimeToken}`,
        },
      }),
      env,
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
    expect(preflight.headers.get("access-control-allow-headers")).toContain(
      "X-OpenCandle-Runtime-Token",
    );
    const health = await relay.fetch(
      new Request("https://relay.test/v1/health", { headers: runtimeHeaders }),
      env,
    );
    expect(health.status).toBe(200);
    expect(health.headers.get("access-control-allow-origin")).toBe("*");

    const provider = await relay.fetch(
      relayRequest(
        {
          provider: "yahoo",
          method: "GET",
          url: "https://query1.finance.yahoo.com/v1/finance/search?q=AAPL",
        },
        clientId,
        "203.0.113.10",
        runtimeOrigin,
        authorization.token,
      ),
      env,
    );
    expect(provider.status).toBe(200);
    expect(provider.headers.get("access-control-allow-origin")).toBe("*");
    expect(upstreamFetch).toHaveBeenCalledOnce();
  });

  it("rejects embedded runtime requests without a valid client-bound token", async () => {
    const upstreamFetch = vi.fn();
    const relay = createProviderRelay({
      fetchImpl: upstreamFetch,
      now: () => 1_000_000,
    });
    const env = environment();
    const issued = await relay.fetch(
      runtimeTokenRequest({ origin: hostedOrigin }),
      env,
    );
    const { token } = (await issued.json()) as { token: string };

    const health = await relay.fetch(
      new Request("https://relay.test/v1/health", {
        headers: { origin: runtimeOrigin, [MODEL_RELAY_HEADERS.client]: clientId },
      }),
      env,
    );
    expect(health.status).toBe(403);
    expect(health.headers.get("access-control-allow-origin")).toBeNull();

    for (const candidate of [undefined, `${token}tampered`]) {
      const response = await relay.fetch(
        relayRequest(
          {
            provider: "yahoo",
            method: "GET",
            url: "https://query1.finance.yahoo.com/v1/finance/search?q=AAPL",
          },
          clientId,
          "203.0.113.10",
          runtimeOrigin,
          candidate,
        ),
        env,
      );
      expect(response.status).toBe(403);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
    }
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("refreshes a valid runtime token but rejects expired and client-mismatched tokens", async () => {
    let now = 1_000_000;
    const relay = createProviderRelay({
      fetchImpl: vi.fn(),
      now: () => now,
      runtimeTokenTtlMs: 1_000,
    });
    const env = environment();
    const issued = await relay.fetch(
      runtimeTokenRequest({ origin: hostedOrigin }),
      env,
    );
    const { token } = (await issued.json()) as { token: string };

    const mismatched = await relay.fetch(
      runtimeTokenRequest({ origin: runtimeOrigin, token, client: "fedcba9876543210fedcba9876543210" }),
      env,
    );
    expect(mismatched.status).toBe(403);

    now += 500;
    const refreshed = await relay.fetch(
      runtimeTokenRequest({ origin: runtimeOrigin, token }),
      env,
    );
    expect(refreshed.status).toBe(200);
    expect(refreshed.headers.get("access-control-allow-origin")).toBe("*");

    now += 1_000;
    const expired = await relay.fetch(
      runtimeTokenRequest({ origin: runtimeOrigin, token }),
      env,
    );
    expect(expired.status).toBe(403);
  });

  it("issues a client-bound authorization without a browser challenge", async () => {
    const relay = createProviderRelay({
      fetchImpl: vi.fn(),
      now: () => 1_000_000,
    });
    const env = environment();

    expect((await relay.fetch(runtimeTokenRequest({ origin: hostedOrigin }), env)).status).toBe(200);
    expect((await relay.fetch(runtimeTokenRequest({ origin: runtimeOrigin }), env)).status).toBe(403);

    const issued = await relay.fetch(
      runtimeTokenRequest({ origin: hostedOrigin }),
      env,
    );
    const { token } = (await issued.json()) as { token: string };
    const response = await relay.fetch(
      new Request("https://relay.test/v1/health", {
        headers: {
          origin: "https://runtime-456.local-corp.webcontainer-api.io",
          [MODEL_RELAY_HEADERS.client]: clientId,
          [MODEL_RELAY_HEADERS.runtimeToken]: token,
        },
      }),
      env,
    );
    expect(response.status).toBe(200);
  });

  it("requires a valid client identity for token issuance", async () => {
    const relay = createProviderRelay({ fetchImpl: vi.fn() });
    const response = await relay.fetch(
      new Request(runtimeTokenEndpoint, {
        method: "POST",
        headers: { origin: hostedOrigin, "cf-connecting-ip": "203.0.113.10" },
      }),
      environment(),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_client" });
  });

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
          {
            status: 401,
            headers: { "retry-after": "30", "request-id": "request-safe" },
          },
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
    expect(response.headers.get("retry-after")).toBe("30");
    expect(response.headers.get("request-id")).toBe("request-safe");
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

  it.each([
    ["openai", "https://api.openai.com/v1/models", { authorization: "Bearer test" }],
    [
      "anthropic",
      "https://api.anthropic.com/v1/models",
      {
        "x-api-key": "test",
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
    ],
    [
      "google",
      "https://generativelanguage.googleapis.com/v1beta/models",
      { "x-goog-api-key": "test" },
    ],
  ] as const)("accepts the %s shared GET model-key probe through the relay", async (provider, url, headers) => {
    const upstreamFetch = vi.fn(async () => Response.json({ data: [] }));
    const relay = createProviderRelay({ fetchImpl: upstreamFetch });
    const response = await relay.fetch(
      new Request(modelEndpoint, {
        method: "POST",
        headers: {
          ...headers,
          "x-opencandle-client": "0123456789abcdef0123456789abcdef",
          "x-opencandle-provider": provider,
          "x-opencandle-upstream-method": "GET",
          "x-opencandle-upstream-url": url,
          "cf-connecting-ip": "203.0.113.10",
        },
        // Fetch may materialize an empty body for an otherwise bodyless GET
        // probe. The relay must accept that empty stream but reject bytes.
        body: new Uint8Array(),
      }),
      environment(),
    );

    expect(response.status).toBe(200);
    expect(upstreamFetch).toHaveBeenCalledOnce();
    const upstream = upstreamFetch.mock.calls[0]?.[0] as Request;
    expect(upstream.method).toBe("GET");
    expect(upstream.url).toBe(url);
    for (const [name, value] of Object.entries(headers)) {
      expect(upstream.headers.get(name)).toBe(value);
    }
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

  it.each([
    [
      "finnhub",
      "https://finnhub.io/api/v1/company-news?symbol=AAPL&from=2026-08-01&to=2026-08-02&token=test",
      {},
    ],
    [
      "finnhub",
      "https://finnhub.io/api/v1/quote?symbol=AAPL&token=test",
      { accept: "application/json" },
    ],
    ["ddg", "https://duckduckgo.com/?q=AAPL&ia=news", { "user-agent": "OpenCandle/1.0" }],
    ["ddg", "https://duckduckgo.com/news.js?q=AAPL&vqd=1-1", {}],
    ["ddg", "https://links.duckduckgo.com/d.js?q=AAPL&vqd=1-1", {}],
    [
      "lse",
      "https://api.londonstrategicedge.com/vault/candles?symbol=AAPL&timeframe=1d&limit=1",
      { "x-api-key": "test" },
    ],
    [
      "lse",
      "https://api.londonstrategicedge.com/vault/ref/financial_reports?symbol=AAPL&report_type=income&period=FY",
      { "x-api-key": "test" },
    ],
  ])("forwards the audited %s provider endpoint", async (provider, url, headers) => {
    const upstreamFetch = vi.fn(async () => new Response("[]"));
    const relay = createProviderRelay({ fetchImpl: upstreamFetch });

    const response = await relay.fetch(
      relayRequest({ provider, method: "GET", url, headers }),
      environment(),
    );

    expect(response.status).toBe(200);
    expect(upstreamFetch).toHaveBeenCalledOnce();
  });

  it.each([
    ["https://html.duckduckgo.com/html/", "q=AAPL"],
    ["https://lite.duckduckgo.com/lite/", "q=AAPL"],
  ])("forwards the audited DDG fallback %s endpoint", async (url, body) => {
    const upstreamFetch = vi.fn(async () => new Response("[]"));
    const relay = createProviderRelay({ fetchImpl: upstreamFetch });

    const response = await relay.fetch(
      relayRequest({
        provider: "ddg",
        method: "POST",
        url,
        headers: { "content-type": "application/x-www-form-urlencoded" },
        bodyBase64: Buffer.from(body).toString("base64"),
      }),
      environment(),
    );

    expect(response.status).toBe(200);
    expect(upstreamFetch).toHaveBeenCalledOnce();
  });

  it.each([
    ["finnhub", "https://finnhub.io/api/v1/profile2?symbol=AAPL&token=test"],
    ["ddg", "https://duckduckgo.com/settings"],
    ["lse", "https://api.londonstrategicedge.com/vault/admin"],
  ])("rejects %s paths outside its audited contract", async (provider, url) => {
    const upstreamFetch = vi.fn();
    const relay = createProviderRelay({ fetchImpl: upstreamFetch });

    const response = await relay.fetch(
      relayRequest({ provider, method: "GET", url }),
      environment(),
    );

    expect(response.status).toBe(403);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("rejects DDG methods outside its audited request shapes", async () => {
    const upstreamFetch = vi.fn();
    const relay = createProviderRelay({ fetchImpl: upstreamFetch });

    const response = await relay.fetch(
      relayRequest({ provider: "ddg", method: "POST", url: "https://duckduckgo.com/" }),
      environment(),
    );

    expect(response.status).toBe(403);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("rejects DDG form posts with a non-form content type", async () => {
    const upstreamFetch = vi.fn();
    const relay = createProviderRelay({ fetchImpl: upstreamFetch });

    const response = await relay.fetch(
      relayRequest({
        provider: "ddg",
        method: "POST",
        url: "https://html.duckduckgo.com/html/",
        headers: { "content-type": "application/json" },
        bodyBase64: Buffer.from('{"q":"AAPL"}').toString("base64"),
      }),
      environment(),
    );

    expect(response.status).toBe(403);
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
    expect(body.providers).toContain("finnhub");
    expect(body.providers).toContain("lse");
    expect(JSON.stringify(body)).not.toContain("url");
  });
});

function relayRequest(
  body: Record<string, unknown>,
  clientId = "0123456789abcdef0123456789abcdef",
  connectingIp = "203.0.113.10",
  origin?: string,
  runtimeToken?: string,
): Request {
  return new Request(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-opencandle-client": clientId,
      "cf-connecting-ip": connectingIp,
      ...(origin ? { origin } : {}),
      ...(runtimeToken ? { [MODEL_RELAY_HEADERS.runtimeToken]: runtimeToken } : {}),
    },
    body: JSON.stringify({ version: 1, ...body }),
  });
}

function runtimeTokenRequest(options: {
  origin: string;
  token?: string;
  client?: string;
}): Request {
  return new Request(runtimeTokenEndpoint, {
    method: "POST",
    headers: {
      origin: options.origin,
      "cf-connecting-ip": "203.0.113.10",
      [MODEL_RELAY_HEADERS.client]: options.client ?? clientId,
      ...(options.token ? { [MODEL_RELAY_HEADERS.runtimeToken]: options.token } : {}),
    },
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
    RELAY_RUNTIME_TOKEN_SECRET: "test-runtime-token-secret-at-least-32-bytes",
    PROVIDER_RELAY_RATE_LIMITER: {
      limit: vi.fn(async () => ({ success: true })),
    },
  };
}
