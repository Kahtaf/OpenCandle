# TESTS

Unit + e2e tests for all OpenCandle modules.

## COMMANDS
```bash
npm test                       # vitest run (unit only)
npm run gates                  # full agent handoff proof battery
npm run test:watch             # vitest watch mode
npm run test:agent-tools       # maintainer/agent helper tests
npm run test:scripts:typecheck # type-check opt-in eval/front-door scripts
npm run test:e2e               # e2e tool tests
npm run test:e2e:cli           # e2e CLI tests
npm run test:e2e:providers     # e2e provider tests (hits live APIs)
```

## STRUCTURE
```
tests/
├── unit/         # Mirrors src/ (tests/unit/<module>/ ↔ src/<module>/), plus gui-server/, gui-web/, website/
├── agent-tools/  # Repo-maintainer/agent helper tests, not default unit coverage
├── harness/      # Agent test harness (file-based IPC) → see tests/harness/README.md
├── evals/        # Agent/session eval cases, scoring, and report helpers
├── scripts/      # Eval front door and long-running opt-in eval runners
├── e2e/          # End-to-end workflow, CLI, and GUI browser tests
├── screenshots/  # GUI screenshot capture harness (npx tsx tests/screenshots/capture.ts)
└── fixtures/     # Mock JSON responses, one directory per provider (yahoo/, alphavantage/, lse/, polymarket/, …)
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
- Keep repo-maintainer helper tests under `tests/agent-tools/`; they should run explicitly instead of bloating public `npm test`.
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
