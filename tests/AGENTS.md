# TESTS

Unit + e2e tests for all Vantage modules. Fixtures prevent live API calls in CI.

## COMMANDS
```bash
npm test                       # vitest run (unit only)
npm run test:watch             # vitest watch mode
npm run test:e2e               # e2e tool tests
npm run test:e2e:cli           # e2e CLI tests
npm run test:e2e:providers     # e2e provider tests (hits live APIs)
```

## STRUCTURE
```
tests/
├── unit/
│   ├── tools/        # One test per tool
│   ├── providers/    # One test per API client
│   ├── infra/        # Cache, rate-limiter, HTTP, browser, paths, config
│   ├── memory/       # SQLite storage, sessions, preferences, retrieval
│   ├── routing/      # Intent classification, entity extraction, slots
│   ├── workflows/    # Workflow builders
│   ├── pi/           # Pi extension, setup, session, tool adapter
│   ├── prompts/      # Workflow prompt templates
│   └── onboarding/   # Setup flow
├── e2e/              # End-to-end workflow + CLI tests
├── integration/      # Cross-module integration tests
└── fixtures/         # Mock JSON responses
    ├── alphavantage/  # Income, balance sheet, cash flow
    ├── coingecko/     # Crypto prices, fear & greed
    ├── fred/          # Economic indicators
    └── yahoo/         # Quotes, history, options, reddit
```

## TEST PATTERN
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cache } from "../../../src/infra/cache.js";
import quoteFixture from "../../fixtures/yahoo/AAPL-quote.json";

const originalFetch = globalThis.fetch;
beforeEach(() => { cache.clear(); });
afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });

globalThis.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve(quoteFixture),
});
```

## CONVENTIONS
- **TDD mandatory.** Write the failing test first.
- Unit tests mirror `src/` structure: `tests/unit/<module>/` maps to `src/<module>/`.
- Mock fetch at `globalThis.fetch` level. Never stub provider internals.
- Use `:memory:` SQLite for memory/storage tests.

## ANTI-PATTERNS
- Never write implementation before a failing test.
- Never make live API calls in unit tests (use `tests/fixtures/`).
- Never import test fixtures into production code.
