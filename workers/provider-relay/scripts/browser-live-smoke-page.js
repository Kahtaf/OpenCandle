(async () => {
  const { clientId, keys, openaiModel, relayUrl } = globalThis.__opencandleRelayProofArgs;
  const results = [];

  const record = async (provider, available, run) => {
    if (!available) {
      results.push({ provider, status: "SKIP" });
      return;
    }
    try {
      results.push({ provider, status: (await run()) ? "PASS" : "FAIL" });
    } catch (error) {
      results.push({
        provider,
        status: "FAIL",
        reason: error instanceof Error ? error.name : "unknown-error",
      });
    }
  };

  const relay = async (input) => {
    const response = await fetch(relayUrl, {
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
        ...(input.body ? { bodyBase64: btoa(input.body) } : {}),
      }),
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
    });
    if (!response.ok) return { relayStatus: response.status, upstreamStatus: 0, body: {} };
    const envelope = await response.json();
    let body = {};
    if (typeof envelope.bodyBase64 === "string" && envelope.bodyBase64.length > 0) {
      body = JSON.parse(atob(envelope.bodyBase64));
    }
    return {
      relayStatus: response.status,
      upstreamStatus: Number(envelope.status),
      body,
    };
  };

  const modelRelay = async (input) => {
    const endpoint = new URL(relayUrl);
    endpoint.pathname = "/v1/model-fetch";
    endpoint.search = "";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        ...(input.headers ?? {}),
        "content-type": "application/json",
        "x-opencandle-client": clientId,
        "x-opencandle-provider": input.provider,
        "x-opencandle-upstream-method": input.method ?? "POST",
        "x-opencandle-upstream-url": input.url,
      },
      ...(input.body ? { body: input.body } : {}),
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
    });
    return { status: response.status, body: await response.text() };
  };

  await record("manifest", true, async () => {
    const health = new URL(relayUrl);
    health.pathname = "/v1/health";
    const response = await fetch(health, { cache: "no-store", credentials: "omit" });
    const body = await response.json();
    return (
      response.ok &&
      body.version === 1 &&
      ["brave", "exa", "fear_greed", "fred", "tradingview", "yahoo"].every((provider) =>
        body.providers?.includes(provider),
      )
    );
  });

  await record("yahoo", true, async () => {
    const response = await relay({
      provider: "yahoo",
      url: "https://query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=1d&range=5d",
      headers: { "user-agent": "OpenCandle/1.0" },
    });
    return (
      response.upstreamStatus === 200 &&
      response.body.chart?.result?.[0]?.meta?.symbol === "AAPL"
    );
  });
  await record("fear_greed", true, async () => {
    const response = await relay({
      provider: "fear_greed",
      url: "https://api.alternative.me/fng/?limit=1&format=json",
    });
    return response.upstreamStatus === 200 && Array.isArray(response.body.data);
  });
  await record("tradingview", true, async () => {
    const response = await relay({
      provider: "tradingview",
      url: "https://scanner.tradingview.com/global/scan2?label-product=screener-stock",
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        symbols: { tickers: ["NASDAQ:AAPL"] },
        columns: ["name", "close", "change", "change_abs", "volume"],
        range: [0, 1],
        options: { lang: "en" },
      }),
    });
    return response.upstreamStatus === 200 && Array.isArray(response.body.symbols);
  });
  await record("fred", Boolean(keys.fred), async () => {
    const url = new URL("https://api.stlouisfed.org/fred/series");
    url.search = new URLSearchParams({
      series_id: "FEDFUNDS",
      api_key: keys.fred,
      file_type: "json",
    }).toString();
    const response = await relay({ provider: "fred", url: url.toString() });
    return response.upstreamStatus === 200 && Array.isArray(response.body.seriess);
  });
  await record("brave", Boolean(keys.brave), async () => {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.search = new URLSearchParams({ q: "Apple earnings", count: "2" }).toString();
    const response = await relay({
      provider: "brave",
      url: url.toString(),
      headers: { accept: "application/json", "x-subscription-token": keys.brave },
    });
    return response.upstreamStatus === 200 && Array.isArray(response.body.web?.results);
  });
  await record("exa", Boolean(keys.exa), async () => {
    const response = await relay({
      provider: "exa",
      url: "https://api.exa.ai/search",
      method: "POST",
      headers: {
        accept: "application/json",
        "x-api-key": keys.exa,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query: "Apple earnings", type: "auto", numResults: 2 }),
    });
    return response.upstreamStatus === 200 && Array.isArray(response.body.results);
  });
  await record("openai_model", Boolean(keys.openai), async () => {
    const response = await modelRelay({
      provider: "openai",
      url: "https://api.openai.com/v1/responses",
      headers: { authorization: `Bearer ${keys.openai}` },
      body: JSON.stringify({
        model: openaiModel,
        input: "Reply with exactly OK.",
        max_output_tokens: 32,
        store: false,
        stream: true,
      }),
    });
    return response.status === 200 && response.body.includes("response.completed");
  });

  await record("coingecko", true, async () => {
    const response = await fetch(
      "https://api.coingecko.com/api/v3/coins/bitcoin?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false",
      { credentials: "omit" },
    );
    const body = await response.json();
    return response.ok && body.id === "bitcoin" && typeof body.market_data === "object";
  });
  await record("polymarket", true, async () => {
    const response = await fetch(
      "https://gamma-api.polymarket.com/public-search?q=Federal%20Reserve&limit=1",
      { credentials: "omit" },
    );
    const body = await response.json();
    return response.ok && (Array.isArray(body.events) || Array.isArray(body.markets));
  });
  await record("alpha_vantage", Boolean(keys.alphaVantage), async () => {
    const url = new URL("https://www.alphavantage.co/query");
    url.search = new URLSearchParams({
      function: "OVERVIEW",
      symbol: "AAPL",
      apikey: keys.alphaVantage,
    }).toString();
    const response = await fetch(url, { credentials: "omit" });
    const body = await response.json();
    return response.ok && body.Symbol === "AAPL" && typeof body.Name === "string";
  });

  return results;
})()
