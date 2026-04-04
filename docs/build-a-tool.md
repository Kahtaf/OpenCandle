# Build an OpenCandle Tool

Add a new data tool to OpenCandle by submitting a PR. This guide covers the tool contract, where files go, and how to test.

For a working reference, see `src/tools/sentiment/reddit-sentiment.ts`.

## Quick Start

1. Create your tool file: `src/tools/<domain>/my-tool.ts`
2. Add a provider if needed: `src/providers/my-source.ts`
3. Add a type if needed: `src/types/my-domain.ts`
4. Register in `src/tools/index.ts` → `getAllTools()`
5. Add fixture JSON in `tests/fixtures/<provider>/`
6. Write tests, run `npm test`, submit PR

## The Tool Contract

Every tool is an `AgentTool` with Typebox parameters:

```ts
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";

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
- Every parameter needs a `description` — the agent reads these to decide how to call the tool
- Use `Type.Optional()` for non-required params

### Return Format

```ts
{
  content: [{ type: "text", text: string }],  // Displayed to user
  details: T,                                   // Structured data for agent
}
```

- `content` — human-readable. Format nicely (tables, bullet points)
- `details` — typed structured data the agent reasons over

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

export function getAllTools(): AgentTool<any>[] {
  return [
    // ... existing tools
    twitterSentimentTool,
  ];
}
```

That's it — the tool is now available to the agent.

## Using OpenCandle Infrastructure

### HTTP Client

```ts
import { httpGet } from "../infra/http-client.js";

const data = await httpGet<MyApiResponse>("https://api.example.com/data", {
  headers: { Authorization: `Bearer ${apiKey}` },
});
```

### Caching

```ts
import { cache, TTL } from "../infra/cache.js";

const cached = cache.get<MyData>("my-tool:AAPL");
if (cached) return cached;

const fresh = await fetchData("AAPL");
cache.set("my-tool:AAPL", fresh, TTL.MINUTES_15);
```

### Rate Limiting

```ts
import { rateLimiter } from "../infra/rate-limiter.js";

await rateLimiter.acquire("my-api", { maxPerMinute: 30 });
```

### Provider Wrapping

Use `wrapProvider()` for circuit-breaking and error handling:

```ts
import { wrapProvider } from "../providers/wrap-provider.js";

const result = await wrapProvider("my-source", () => fetchFromMyApi(symbol));
if (result.status === "unavailable") {
  return { content: [{ type: "text", text: `Data unavailable: ${result.reason}` }], details: null };
}
```

For multi-provider fallback, use `withFallback()` — see `src/tools/market/stock-quote.ts`.

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

If your tool has heavy dependencies or needs separate maintenance, you can ship it as a standalone npm package instead. It's a Pi extension that imports from `opencandle/tool-kit`:

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

Pi discovers it automatically when installed. For Pi extension lifecycle details, see [Pi documentation](https://github.com/nicobailon/pi-coding-agent).

## Checklist

- [ ] Tool name is snake_case with verb prefix
- [ ] Every parameter has a `description`
- [ ] `execute()` returns `{ content, details }`
- [ ] Uses `cache` and `rateLimiter` for external API calls
- [ ] Tests mock `globalThis.fetch` with fixtures
- [ ] Tool registered in `src/tools/index.ts`
