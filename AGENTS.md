# PROJECT KNOWLEDGE BASE

## OVERVIEW
TypeScript-based financial data analysis and market intelligence toolset. Integrates multiple market data providers to analyze fundamentals, technicals, options, and macroeconomic sentiment.

## STRUCTURE
```
./
├── src/
│   ├── providers/  # API integrations (Yahoo, AlphaVantage, FRED, CoinGecko)
│   ├── tools/      # Market data fetching and analysis capabilities
│   ├── infra/      # Core infrastructure and utilities
│   ├── types/      # Global TypeScript definitions
│   └── analysts/   # AI analyst personas/prompts
├── tests/
│   ├── unit/       # Unit tests for tools, providers, and infra
│   ├── e2e/        # End-to-end integration flows
│   └── fixtures/   # Mock responses for API providers
└── src/index.ts    # Main entry point
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Adding a new API | `src/providers/` | Create corresponding mock in `tests/fixtures/` |
| Adding a market feature | `src/tools/` | See `src/tools/AGENTS.md` for sub-domains |
| Modifying system prompts | `src/system-prompt.ts` | Core AI persona instructions |
| Type definitions | `src/types/` | Shared interfaces |

## CONVENTIONS
- **TDD MANDATORY**: All new features must be implemented using red/green Test-Driven Development (write failing test first).
- Strictly typed TypeScript environment.
- Tools fetch raw data, analysts synthesize it.

## ANTI-PATTERNS (THIS PROJECT)
- **NEVER** guess financial numbers, prices, ratios, or metrics.
- **DO NOT** draw conclusions until all relevant data is gathered (quote, fundamentals, technicals, options, sentiment).
- **NEVER** downplay downside scenarios; flag risks prominently.

## COMMANDS
```bash
npm run build
npm test
```

## RUNTIME STATE
- Pi runtime config belongs in `.pi/` and `~/.pi/agent/...`; do not move Pi auth, models, or settings into Vantage storage.
- Vantage user state belongs in `~/.vantage/`, and the published CLI should not depend on a repo-local `.pi/extensions/...` file.
