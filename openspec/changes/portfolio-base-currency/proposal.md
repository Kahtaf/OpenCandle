# Portfolio reporting currency

Expose the persisted portfolio base currency in create and explicit edit operations through the shared portfolio tool and GUI. Default new portfolios to USD; normalize and validate against Intl supported ISO currency codes. Explicit conflicting create/add requests fail and direct users to an explicit edit. Editing only updates the portfolio reporting currency; lots and instruments remain unchanged, and unmatched currencies stay excluded from totals.

GUI creation includes a selector; existing and default portfolios have a separate reporting-currency save control in portfolio settings. Local and hosted runtimes use the same tool contract.

Non-goals: FX conversion, provider additions, schema changes, prompt or orchestration changes.

Validation: failing-first service, tool and GUI tests, persistence, currency exclusion regression, desktop/mobile browser and TUI verification, full gates and local autoreview. User authorization supplied with implementation brief, 2026-11-06.

## User contract

- `track_portfolio({ action: "create", portfolio_name: "Europe", base_currency: "EUR" })` creates an EUR reporting portfolio; omission preserves USD for new portfolios and the saved currency for existing names.
- `track_portfolio({ action: "set_base_currency", portfolio_name: "Europe", base_currency: "GBP" })` explicitly edits reporting currency. Omit `portfolio_name` to edit the default portfolio.
- `currency` continues to mean lot cost currency. `base_currency` is accepted on implicit creation via `add`; a conflicting saved currency errors before adding a lot. Other actions reject `base_currency` instead of silently dropping it.
- In Portfolios, choose Reporting currency under New Portfolio, or open Portfolio settings beside the selected portfolio tab and use Save reporting currency.
- No FX conversion is performed. Changing reporting currency changes which lots contribute to totals; it does not convert or relabel their costs or quotes.
