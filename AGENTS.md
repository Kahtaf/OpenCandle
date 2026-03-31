# OPENCANDLE

Financial data analysis agent. TypeScript + Vitest + Pi shell framework.
Integrates Yahoo Finance, AlphaVantage, FRED, CoinGecko, Reddit, SEC EDGAR.

## COMMANDS
```bash
npm start                      # run agent (tsx src/index.ts)
npm test                       # unit tests (vitest run)
npm run test:watch             # vitest in watch mode
npm run test:e2e               # e2e tool tests
npm run test:e2e:cli           # e2e CLI tests
npm run test:e2e:providers     # e2e provider tests (hits live APIs)
```

## STRUCTURE
```
src/
├── providers/    # API clients (yahoo-finance, alpha-vantage, fred, coingecko, reddit, sec-edgar, fear-greed)
├── tools/        # Market data tools by domain → see src/tools/AGENTS.md
├── infra/        # HTTP client, cache, rate-limiter, browser, opencandle-paths
├── types/        # Shared interfaces (market, options, fundamentals, macro, sentiment, portfolio)
├── routing/      # Intent classification, entity extraction, slot resolution
├── workflows/    # Multi-step workflow builders
├── memory/       # SQLite-backed session logs, preferences, retrieval
├── analysts/     # Multi-analyst analysis orchestration
├── prompts/      # Workflow prompt templates
├── onboarding/   # First-run setup flow
├── pi/           # Pi shell extension, session, tool adapter, setup wizard
├── config.ts     # Env + file config loading
├── system-prompt.ts
└── index.ts      # Entry point
tests/            → see tests/AGENTS.md
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| New API provider | `src/providers/` | Add fixture in `tests/fixtures/` |
| New market tool | `src/tools/<domain>/` | See `src/tools/AGENTS.md` |
| New workflow | `src/workflows/` | Wire routing in `src/routing/` |
| System prompt | `src/system-prompt.ts` | Core AI persona instructions |
| Type definitions | `src/types/<domain>.ts` | One file per domain |
| Memory / persistence | `src/memory/` | SQLite-backed |
| Pi shell integration | `src/pi/` | Extension, session, tool adapter |

## CODE STYLE
```ts
// Files: kebab-case.ts
// Imports: node: prefix, .js extensions on relative imports, type keyword for type-only
import { readFileSync } from "node:fs";
import { httpGet } from "../infra/http-client.js";
import type { StockQuote } from "../types/market.js";

// Tools: Typebox params above, named AgentTool export, snake_case name
const params = Type.Object({
  symbol: Type.String({ description: "Ticker symbol" }),
});
export const stockQuoteTool: AgentTool<typeof params, StockQuote> = {
  name: "get_stock_quote",
  parameters: params,
  async execute(toolCallId, args) { ... },
};

// Providers: verb-prefixed async function, returns typed interface
export async function getQuote(symbol: string): Promise<StockQuote> { ... }

// Infra: module-level singleton exports
export const cache = new Cache();
```

## CONVENTIONS
- **TDD mandatory**: write failing test first, then implement.
- Strictly typed. No `any` except provider raw API responses.
- Tools fetch + format. Analysts/LLM synthesize. Never analyze within a tool.
- Use `cache` and `rateLimiter` from `src/infra/` for all external calls.
- Tests mock `globalThis.fetch` with fixture JSON. No live API calls in unit tests.

## BOUNDARIES

**Always (do autonomously):**
- Run `npm test` after changes
- Add fixture JSON in `tests/fixtures/<provider>/` for new API responses
- Use existing `cache`/`rateLimiter` infra for new providers
- Use `.js` extensions on all relative imports

**Ask first:**
- Adding a new provider (needs rate-limit config, fixture strategy)
- Changing system prompt or analyst orchestration
- Modifying Pi shell integration (`src/pi/`)
- Schema changes in memory SQLite tables

**Never:**
- Guess financial numbers, prices, ratios, or metrics
- Downplay downside scenarios; always flag risks prominently
- Hardcode mock data in tools; use providers
- Make live API calls in unit tests
- Draw conclusions until all relevant data is gathered

## RUNTIME STATE
- Pi config: `.pi/` and `~/.pi/agent/` — do not move into OpenCandle storage.
- OpenCandle user state: `~/.opencandle/` — CLI must not depend on repo-local `.pi/extensions/`.
