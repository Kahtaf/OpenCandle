# TESTS

Unit + e2e tests for all OpenCandle modules. Fixtures prevent live API calls in CI.

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
├── harness/          # Agent test harness (file-based IPC) → see tests/harness/README.md
├── evals/            # Agent/session eval cases, scoring, and report helpers
├── scripts/          # Eval front door and long-running opt-in eval runners
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

## EVALS AND SCRIPTS
- Use `npm run eval -- <suite>` as the eval front door. It prints the delegated command/env flags and appends run metadata to `tests/evals/runs/index.jsonl`.
- Keep suite logic in the existing runner or scorer files; `tests/scripts/run-evals.ts` only dispatches and maps CLI options onto existing env flags.
- `cases` uses `EVAL_TIER`; `--known-fail e1` and `--known-fail e2` are opt-in usually-tier paths for tracked failures, not default CI coverage.
- Product eval opt-in cases stay behind `--include-opt-in`. Do not promote a case by editing runner filters; change the case tier intentionally.
- Use `// PROMOTE:` comments near known-fail or opt-in eval cases when the intended promotion condition is important for future cleanup.
- Do not commit raw files from `tests/evals/runs/`; `.gitkeep` is the only tracked file there.

## ANTI-PATTERNS
- Never write implementation before a failing test.
- Never make live API calls in unit tests (use `tests/fixtures/`).
- Never import test fixtures into production code.
