# TOOLS KNOWLEDGE BASE

**Generated:** 2026-03-29T19:27:06Z

## OVERVIEW
Market analysis tools divided by financial domains. These tools fetch real data from `src/providers` for AI synthesis.

## STRUCTURE
```
src/tools/
├── fundamentals/  # Corporate financials, earnings, ratios
├── technical/     # Price action, moving averages, indicators
├── options/       # Options chains, greeks, implied volatility
├── macro/         # Economic indicators, treasury yields
├── sentiment/     # News sentiment, market breadth
├── portfolio/     # Portfolio allocation, risk metrics
└── market/        # Broad market context, indices
```

## WHERE TO LOOK
| Task | Location |
|------|----------|
| P/E, EPS, balance sheets | `fundamentals/` |
| RSI, MACD, SMA | `technical/` |
| Put/Call ratio, implied vol | `options/` |
| GDP, Inflation, Fed rates | `macro/` |

## ANTI-PATTERNS
- **NEVER** hardcode mock data in tools; use providers.
- **DO NOT** analyze data within the tool itself; tools return structured data, the LLM analyzes it.
