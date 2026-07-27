# TOOLS

Market analysis tools organized by financial domain. Tools fetch data from `src/providers/`, return structured results for LLM synthesis.

## STRUCTURE
```
src/tools/
├── fundamentals/  # Earnings, financials, DCF, comps, SEC filings
├── technical/     # Indicators (SMA, RSI, MACD), backtesting
├── options/       # Options chains, Greeks computation
├── macro/         # FRED economic data, fear & greed index
├── sentiment/     # Reddit, Twitter/X, web/news sentiment, plus aggregate summary/trend
├── portfolio/     # Tracker, risk analysis, watchlist, correlation
├── market/        # Stock quotes, history, crypto, ticker search
├── interaction/   # ask_user clarification tool
└── index.ts       # getAllTools() registry — add new tools here
```

## LOOKUP
| Domain | Location |
|--------|----------|
| P/E, EPS, balance sheets, DCF | `fundamentals/` |
| RSI, MACD, SMA, backtest | `technical/` |
| Put/call ratio, IV, Greeks | `options/` |
| GDP, inflation, Fed rates | `macro/` |
| Reddit, Twitter/X, web/news, aggregate sentiment | `sentiment/` |
| Positions, Sharpe, VaR, watchlist | `portfolio/` |
| Quotes, OHLCV, crypto, search | `market/` |
| Clarifying questions (`ask_user`) | `interaction/` |

## ADDING A TOOL
1. Create `src/tools/<domain>/my-tool.ts` with Typebox params + `AgentTool` export.
2. Register in `src/tools/index.ts` (`getAllTools()` array).
3. Add test in `tests/unit/tools/` with fixture-based fetch mocking.

## ANTI-PATTERNS
- Never hardcode mock data in tools; call providers.
- Tools return structured data. The LLM analyzes it, not the tool.
