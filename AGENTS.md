# OPENCANDLE

Financial data analysis agent. TypeScript + Vitest + Pi shell framework.
Integrates Yahoo Finance, AlphaVantage, FRED, CoinGecko, Reddit, SEC EDGAR.

## COMMANDS
```bash
npm start                      # run agent (tsx src/cli.ts)
npm run gui                    # run local browser GUI at 127.0.0.1:14567
npm test                       # unit tests (vitest run)
npm run test:watch             # vitest in watch mode
npm run test:e2e               # e2e tool tests
npm run test:e2e:cli           # e2e CLI tests
npm run test:e2e:providers     # e2e provider tests (hits live APIs)
```

## STRUCTURE
```
src/
├── providers/    # API clients and provider wrappers
├── tools/        # Market data tools by domain → see src/tools/AGENTS.md
├── infra/        # HTTP client, cache, rate-limiter, opencandle-paths
├── types/        # Shared interfaces (market, options, fundamentals, macro, sentiment, portfolio)
├── routing/      # Intent classification, entity extraction, slot resolution
├── workflows/    # WorkflowDefinition builders
├── runtime/      # Session coordinator, workflow runner, runtime context
├── market-state/ # Durable watchlists, portfolios, predictions, alerts, reports
├── memory/       # SQLite-backed session logs, preferences, retrieval
├── sentiment/    # Cross-source sentiment pipeline, scoring, adapters, trends
├── analysts/     # Multi-analyst analysis orchestration
├── prompts/      # Workflow prompt templates
├── onboarding/   # First-run setup flow
├── pi/           # Pi shell extension, session, tool adapter, setup wizard
├── cli.ts        # CLI entry point
├── monitor.ts    # Local automation heartbeat command
├── tool-kit.ts   # Public add-on tool helpers
├── config.ts     # Env + file config loading
├── system-prompt.ts
└── index.ts      # Public package exports
gui/
├── server/       # local HTTP/WebSocket GUI server, session projector, writer lock
└── web/          # React + Tailwind browser app served by gui/server
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
| Local GUI | `gui/` | Server owns writer lock; browser renders chat/catalog/dashboard |
| Add-on tool package | `docs/build-a-tool.md` | Guide for building tools as separate npm packages |

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
- **TDD mandatory**: write failing test first, then implement - refer to tdd skill
- Strictly typed. No `any` except provider raw API responses.
- Tools fetch + format. Analysts/LLM synthesize. Never analyze within a tool.
- Use `cache` and `rateLimiter` from `src/infra/` for all external calls.
- Tests mock `globalThis.fetch` with fixture JSON. No live API calls in unit tests.

## ENV FLAGS
- The LLM router is the only production routing path. `OPENCANDLE_ROUTER_MODE` accepts only `llm` (or unset); the removed `rules` value fails startup with migration guidance.

## BOUNDARIES

**Always (do autonomously):**
- Run `npm test` after changes
- Follow Pi conventions where possible (sessions, TUI) (https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/index.md)
- Add fixture JSON in `tests/fixtures/<provider>/` for new API responses
- Use existing `cache`/`rateLimiter` infra for new providers
- Use `.js` extensions on all relative imports
- For new atomic features or bug fixes, update the @CHANGELOG.md (use changelog-automation skill)

**Ask first:**
- Adding a new provider (needs rate-limit config, fixture strategy)
- Changing system prompt or analyst orchestration
- Modifying Pi shell integration (`src/pi/`)
- Schema changes in memory SQLite tables

**Never:**
- Prompt engineering: never overfit prompts to specific tickers, sectors, rates, dollar amounts, share counts, or benchmark phrases
- Guess financial numbers, prices, ratios, or metrics
- Downplay downside scenarios; always flag risks prominently
- Hardcode mock data in tools; use providers
- Make live API calls in unit tests
- Draw conclusions until all relevant data is gathered

## TESTING OPENCANDLE AS AN AGENT

Use `runOpenCandleSession()` from `tests/harness/opencandle-runner.ts` for scripted evals and competitive benchmarking. For external-agent/manual ask-user driving, run `npx tsx tests/harness/cli.ts run --prompt "<prompt>" --ipc <ipc-dir>` in background, poll with `npx tsx tests/harness/cli.ts wait --ipc <ipc-dir>`, answer pending questions with `npx tsx tests/harness/cli.ts answer --ipc <ipc-dir> --value "<answer>"`, and read the final trace with `npx tsx tests/harness/cli.ts trace --ipc <ipc-dir>`.

When fixing eval or competitive-benchmark regressions, classify the issue into the narrowest durable layer before editing prompts: routing/planning, slot/entity extraction, tool capability, evidence normalization, policy card, workflow prompt, answer contract, structured check, eval assertion, or harness. Do not append benchmark-specific instructions to the fallback playbook or a broad prompt. If production prompt guidance changes, run `npx vitest run tests/unit/prompts/prompt-debt-guard.test.ts` and keep benchmark literals in manifests/tests only.

## RUNTIME STATE
- Pi config: `.pi/` and `~/.pi/agent/` — do not move into OpenCandle storage.
- OpenCandle user state: `~/.opencandle/` — CLI must not depend on repo-local `.pi/extensions/`.
- GUI writer/follower: one process holds `writer.lock` per Pi session; followers are read-only and poll/re-render session entries.

## GRAPHIFY

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, invoke the `skill` tool with `skill: "graphify"` before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
