# TESTS KNOWLEDGE BASE

**Generated:** 2026-03-29T19:27:06Z

## OVERVIEW
Test suites for the financial tools and API providers, strongly relying on static fixtures to prevent live API calls during CI.

## STRUCTURE
```
tests/
├── unit/
│   ├── tools/       # Tests for each domain tool
│   ├── providers/   # Tests for API clients
│   └── infra/       # Tests for core utilities
├── fixtures/        # Mock JSON responses
│   ├── alphavantage/
│   ├── coingecko/
│   ├── fred/
│   └── yahoo/
└── e2e/             # End-to-end workflow tests
```

## WHERE TO LOOK
| Task | Location |
|------|----------|
| Updating mock API data | `tests/fixtures/[provider]/` |
| Testing a new tool | `tests/unit/tools/` |

## CONVENTIONS
- **TDD MANDATORY**: Red/green TDD is strictly required for all new features. Write failing tests before implementation.

## ANTI-PATTERNS
- **NEVER** write implementation code before writing a failing test.
- **NEVER** make live external API calls in unit tests (use `tests/fixtures/`).
