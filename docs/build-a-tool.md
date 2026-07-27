---
title: Build a Tool
description: Add first-party OpenCandle tools or publish Pi-compatible finance tool packages.
---

# Build an OpenCandle Tool

There are two ways to add a tool: contribute it to OpenCandle with a PR (this guide's main path), or ship it as a separate npm package (see Add-on Packages below). A good OpenCandle tool behaves like an investigator's instrument: it fetches evidence, preserves source/freshness context, formats the result clearly, and leaves synthesis to the model.

For a working reference, see `src/tools/sentiment/reddit-sentiment.ts`.

## Quick Start

1. Create your tool file: `src/tools/<domain>/my-tool.ts`
2. Add a provider if needed: `src/providers/my-source.ts`
3. Add a type if needed: `src/types/my-domain.ts`
4. Register in `src/tools/index.ts` → `getAllTools()`
5. Add fixture JSON in `tests/fixtures/<provider>/`
6. Write tests, run `npm test`, submit PR

## The Tool Contract

Every tool is an `AgentTool` with [Typebox](https://github.com/sinclairzx81/typebox) parameters:

```ts
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";

const params = Type.Object({
  symbol: Type.String({ description: "Stock ticker symbol (e.g. AAPL)" }),
  days: Type.Optional(Type.Number({ description: "Lookback in days. Default: 7" })),
});

export const twitterSentimentTool: AgentTool<typeof params, TwitterSentiment> = {
  name: "get_twitter_sentiment",
  label: "Twitter Sentiment",
  description: "Analyze Twitter/X sentiment for a stock ticker",
  parameters: params,
  async execute(toolCallId, args) {
    // Fetch data via provider, format results
    return {
      content: [{ type: "text", text: "Formatted human-readable output" }],
      details: { sentiment: 0.72, volume: 1234 },
    };
  },
};
```

### Naming Rules

- **snake_case** with a verb prefix: `get_`, `analyze_`, `search_`, `calculate_`, `compare_`, `compute_`, `track_`, `manage_`, `backtest_`, `list_`, `fetch_`, `check_`
- You can use `createTool()` from `src/tool-kit.ts` to validate this at creation time (optional convenience)

### Parameters

- Use Typebox `Type.Object({...})` as the root (recommended convention)
- Every parameter needs a `description`: the agent reads these to decide how to call the tool
- Use `Type.Optional()` for non-required params

### Return Format

```ts
{
  content: [{ type: "text", text: string }],  // Displayed to user
  details: T,                                   // Structured data for agent
}
```

- `content`: human-readable. Format nicely (tables, bullet points)
- `details`: typed structured data the agent reasons over

## Where Files Go

```
src/tools/<domain>/my-tool.ts       # Tool implementation
src/providers/my-source.ts          # API client (if new data source)
src/types/my-domain.ts              # Types (if new domain)
src/tools/index.ts                  # Register in getAllTools()
tests/fixtures/<provider>/          # Fixture JSON for mock responses
tests/unit/tools/my-tool.test.ts    # Unit tests
```

### Registering the Tool

Add your export to `src/tools/index.ts`:

```ts
import { twitterSentimentTool } from "./sentiment/twitter-sentiment.js";

export function getAllTools(options: { askUserHandler?: AskUserHandler } = {}) {
  return [
    // ... existing tools
    twitterSentimentTool,
  ];
}
```

The tool is now registered. To make it usable in normal conversations, also wire it into active-tool selection:

- Add the tool name to the relevant bundle in `src/routing/route-manifest.ts` (for example, core market tools belong in `TOOL_BUNDLE_TOOLS.core_market`).
- Update the tool catalog text in `src/prompts/context-builder.ts` and, when the global prompt mentions the same domain, `src/system-prompt.ts`.
- Add tests showing the tool is present for the intended bundle and absent from unrelated bundles.
- Add prompt or harness coverage proving the agent chooses the new tool for the intended prompt class and keeps existing tools for adjacent tasks.

`screen_stocks` is the reference for a provider-backed tool that needed this wiring: it is exposed for breadth/screening prompts, while Yahoo-backed quote/history tools remain the right choice for single-security quote or history prompts.

## Using OpenCandle Infrastructure

### HTTP Client

```ts
import { httpGet, httpPost } from "../../infra/http-client.js";

const data = await httpGet<MyApiResponse>("https://api.example.com/data", {
  headers: { Authorization: `Bearer ${apiKey}` },
});

const posted = await httpPost<MyApiResponse>("https://api.example.com/search", {
  query: "AAPL",
});
```

`httpPost` is not part of the public add-on API. Add-on packages should use only `opencandle/tool-kit`; inside the OpenCandle repo, use it freely.

### Caching

```ts
import { cache, TTL } from "../../infra/cache.js";

const cached = cache.get<MyData>("my-tool:AAPL");
if (cached) return cached;

const fresh = await fetchData("AAPL");
cache.set("my-tool:AAPL", fresh, TTL.SENTIMENT);
```

For providers that may fail intermittently, use `cache.getStale()` to return the last known value within a longer window:

```ts
import { STALE_LIMIT } from "../../infra/cache.js";

const stale = cache.getStale<MyData>("my-tool:AAPL", STALE_LIMIT.SENTIMENT);
if (stale) return stale.value; // serve stale data while provider is down
```

### Rate Limiting

```ts
import { rateLimiter } from "../../infra/rate-limiter.js";

await rateLimiter.acquire("my-api");
```

Configure first-party provider buckets in `src/infra/rate-limiter.ts`, and use the provider ID consistently in tests and `wrapProvider()`.

### New Provider Checklist

For a first-party provider, follow the Yahoo provider pattern in `src/providers/yahoo-finance.ts`:

- Put the API client in `src/providers/<provider>.ts` with verb-prefixed async functions that return typed objects.
- Use shared `httpGet`/`httpPost`, `rateLimiter.acquire("<provider>")`, `cache`, TTLs, and stale-cache fallback instead of provider-local fetch/retry logic.
- Export the provider functions from `src/providers/index.ts`.
- Save deterministic fixtures in `tests/fixtures/<provider>/`; unit tests must mock `globalThis.fetch` and must not call live APIs.
- Decode provider responses defensively and surface provider limits or freshness caveats in tool output.
- If the provider backs a new tool, register the tool in `src/tools/index.ts`, route bundles, prompt catalog text, and focused tests.

### Provider Wrapping

Use `wrapProvider()` for circuit-breaking and error handling:

```ts
import { wrapProvider } from "../../providers/wrap-provider.js";

const result = await wrapProvider("my-source", () => fetchFromMyApi(symbol));
if (result.status === "unavailable") {
  return { content: [{ type: "text", text: `Data unavailable: ${result.reason}` }], details: null };
}
// result.stale is true when serving cached data after a provider failure
```

For multi-provider fallback, use `withFallback()`; see `src/tools/market/stock-quote.ts`.

For a real-world example that uses `wrapProvider` with stale fallback and login-specific error detection, see `src/tools/sentiment/twitter-sentiment.ts`.

## Testing

Mock `globalThis.fetch` with fixture JSON. No live API calls in unit tests.

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const FIXTURE = { sentiment: 0.72, posts: 150 };

describe("get_twitter_sentiment", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(FIXTURE),
    }));
  });

  it("returns sentiment data for a valid ticker", async () => {
    const result = await twitterSentimentTool.execute("call-1", { symbol: "AAPL" });
    expect(result.details.sentiment).toBe(0.72);
    expect(result.content[0].text).toContain("AAPL");
  });
});
```

Save fixture JSON in `tests/fixtures/<provider>/` so tests are deterministic.

## Add-on Packages (Advanced)

The stable package surface for add-ons is `opencandle/tool-kit` plus documented TypeScript types. Other exported subpaths such as `opencandle/providers`, `opencandle/tools`, `opencandle/workflows`, and `opencandle/infra` are available for first-party integration and experimentation, but they can change more often until the project documents a narrower API reference for them.

If your tool has heavy dependencies or needs separate maintenance, you can ship it as a standalone npm package instead. It's a [Pi](https://github.com/earendil-works/pi) extension that imports from `opencandle/tool-kit`:

```ts
// extension.ts in your separate package
import type { ExtensionAPI } from "opencandle/tool-kit";
import { registerTools } from "opencandle/tool-kit";
import { myTool } from "./tools/my-tool.js";

export default function(pi: ExtensionAPI): void {
  registerTools(pi, [myTool]);
}
```

```json
// package.json
{
  "pi": { "extensions": ["./dist/extension.js"] },
  "keywords": ["opencandle-tools"],
  "peerDependencies": { "opencandle": "*" }
}
```

Discovery is handled by the Pi runtime via the `pi.extensions` field; exact behavior depends on the installed Pi version. For Pi extension lifecycle details, see [Pi coding-agent documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/index.md).

## Checklist

- [ ] Tool name is snake_case with verb prefix
- [ ] Every parameter has a `description`
- [ ] `execute()` returns `{ content, details }`
- [ ] Uses `cache` and `rateLimiter` for external API calls
- [ ] Tests mock `globalThis.fetch` with fixtures
- [ ] Tool registered in `src/tools/index.ts`
- [ ] The tool reports source/provider identity in structured details when useful
- [ ] Missing credentials produce a clear setup path instead of a vague failure
- [ ] Stale or partial data is labeled in the user-facing content
- [ ] The tool avoids advice language such as "buy", "sell", or "safe"
- [ ] Downside or data-quality caveats are preserved for the analyst prompt
- [ ] Fixture data is realistic enough to catch formatting and parsing regressions
