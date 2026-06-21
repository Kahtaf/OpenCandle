# Plan 003: Guard financial-math divisions against zero and validate lots at the service layer

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 2a508ed..HEAD -- src/tools/portfolio/tracker.ts src/tools/portfolio/predictions.ts src/tools/portfolio/risk-analysis.ts src/tools/technical/backtest.ts src/market-state/service.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `2a508ed`, 2026-06-11

## Why this matters

Several P&L/returns formulas divide by values that can be zero: cost basis,
entry price, and previous-day close. Tool-level Typebox schemas enforce
`exclusiveMinimum: 0` on user-entered shares/cost, but (a) the service layer
(`MarketStateService.updatePortfolioLot` / `addPortfolioLot`) performs **no**
bounds validation, so programmatic callers can persist invalid lots, and
(b) provider history bars can legitimately contain zero closes
(halted/delisted symbols, bad data). A zero anywhere yields `NaN` that
propagates silently into P&L, risk metrics, correlation, and backtest results
— a financial-data product must fail loudly or skip, never emit NaN.

## Current state

Division sites (verified against live code):

```ts
// src/tools/portfolio/tracker.ts:214  (totalCost = p.avgCost * p.quantity, line 185)
pnlPercent: marketValue == null ? null : ((marketValue - totalCost) / totalCost) * 100,
```

```ts
// src/tools/portfolio/predictions.ts:104
const pnlPercent = (currentPrice - p.entryPrice) / p.entryPrice;
```

```ts
// src/tools/portfolio/risk-analysis.ts:88-93
export function computeDailyReturns(prices: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  }
  return returns;
}
```

Downstream of `computeDailyReturns`, `computeRiskMetrics`
(risk-analysis.ts:62-79) feeds the returns array into `mean(...)`,
`stddev(...)`, and `computeVaR(...)`. Once zero-pairs are skipped, that array
can be EMPTY, and `mean([])` / `stddev([])` / `computeVaR([])` produce NaN —
only the Sharpe ratio currently guards (`dailyVol === 0 ? 0 : ...`). The tool
already has an "insufficient data" early-return branch near the top of
`execute` (the `details: null as any` unavailable result around line 40) —
that is the pattern to reuse.

```ts
// src/tools/technical/backtest.ts — six sites: lines 71, 79, 89, 125, 133, 143, e.g.:
const pnl = (price - entryPrice) / entryPrice;          // :71
? equity * (1 + (price - entryPrice) / entryPrice)      // :79
```

Service layer applies updates raw (no bounds checks):

```ts
// src/market-state/service.ts:802-834 (abridged)
updatePortfolioLot(id, params /* { quantity?, avgCost?, currency?, ... } */) {
  const existing = this.db.prepare("SELECT * FROM portfolio_lots WHERE id = ?").get(id) ...
  this.db.prepare(`UPDATE portfolio_lots SET quantity = ?, avg_cost = ?, ...`)
    .run(params.quantity ?? existing.quantity, params.avgCost ?? existing.avg_cost, ...);
}
// addPortfolioLot at service.ts:722 likewise inserts quantity/avgCost without validation.
```

Conventions: strictly typed TS ESM, `.js` import extensions. Tools return
`status: "unavailable"`-style results rather than throwing for data problems;
the service layer throws `Error` for invariant violations (see the
preference-update invariant error mentioned in CHANGELOG 0.4.0 for precedent).

## Commands you will need

| Purpose   | Command                                                          | Expected on success |
|-----------|------------------------------------------------------------------|---------------------|
| Typecheck | `npx tsc --noEmit`                                                | exit 0              |
| Targeted  | `npx vitest run tests/unit/tools/portfolio-tracker.test.ts tests/unit/tools/predictions.test.ts tests/unit/tools/risk-analysis.test.ts tests/unit/tools/backtest.test.ts tests/unit/market-state/service.test.ts` | all pass |
| All tests | `npx vitest run`                                                  | all pass            |

## Scope

**In scope**:
- `src/market-state/service.ts` — `addPortfolioLot`, `updatePortfolioLot` validation only
- `src/tools/portfolio/tracker.ts` — line 214 guard
- `src/tools/portfolio/predictions.ts` — line 104 guard
- `src/tools/portfolio/risk-analysis.ts` — `computeDailyReturns`
- `src/tools/technical/backtest.ts` — entry-price guards
- Corresponding test files in `tests/unit/`

**Out of scope**:
- `updatePortfolioLotsBySymbol` and other service methods — same class but
  separate flows; flag if you notice the same gap, don't fix here.
- Quote-fetching/zero-filled-quote logic (`isZeroFilledQuote`,
  `src/market-state/resolve.ts`) — already handles zero quotes.
- Any schema change to SQLite tables.

## Git workflow

- Branch: `advisor/003-financial-math-zero-guards`.
- Commit style: short imperative subject, e.g. `Guard P&L math against zero divisors`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Service-layer validation

In `src/market-state/service.ts`, at the top of `addPortfolioLot` and
`updatePortfolioLot`, validate finite positive numbers:

```ts
if (!Number.isFinite(params.quantity) || params.quantity <= 0) {
  throw new Error("Portfolio lot quantity must be a positive finite number.");
}
```

For `updatePortfolioLot` apply the check only when the param is provided
(`params.quantity != null`); same for `avgCost`.

**Verify**: `npx tsc --noEmit` → exit 0; `npx vitest run tests/unit/market-state/service.test.ts` → all pass (existing tests must not break — they only use valid values).

### Step 2: Tracker guard

In `src/tools/portfolio/tracker.ts:214`, treat zero cost as un-computable:

```ts
pnlPercent: marketValue == null || totalCost === 0 ? null : ((marketValue - totalCost) / totalCost) * 100,
```

(`pnl` at line 213 is fine — subtraction.) The rendering code already handles
`null` pnlPercent (it handles `marketValue == null` rows); confirm by reading
the formatting block below line 220 before relying on it.

**Verify**: `npx vitest run tests/unit/tools/portfolio-tracker.test.ts` → all pass.

### Step 3: Predictions guard

In `src/tools/portfolio/predictions.ts:104`, skip scoring when
`p.entryPrice <= 0`: treat the prediction like the existing
`"quote unavailable"` branch directly above (push a detail row with
`pnlPercent: null`-equivalent and `dataGap: "invalid entry price"`, keep
status `"open"`). Match the existing dataGap row shape exactly.

**Verify**: `npx vitest run tests/unit/tools/predictions.test.ts` → all pass.

### Step 4: Returns and backtest guards

- `computeDailyReturns` (risk-analysis.ts): skip pairs where
  `prices[i - 1] <= 0` (continue, do not push). Document the skip in one short
  comment only if non-obvious.
- `computeRiskMetrics` (risk-analysis.ts:62): guard the empty/near-empty
  returns case. Make `computeRiskMetrics` throw
  `new Error("insufficient usable price history")` when
  `dailyReturns.length === 0`, and in the tool's `execute`, pre-check (or
  catch) and return the existing "insufficient data" unavailable-style text
  result instead of metrics. Returning zeroed metrics is NOT acceptable —
  fabricated risk numbers are worse than an explicit gap. Check whether
  `computeVaR` has its own empty-array behavior worth a direct guard while
  you're in the file; if other callers of these stat helpers exist
  (`grep -rn "computeRiskMetrics\|computeVaR\|stddev(" src/`), list them in
  the PR description.
- `backtest.ts`: at the buy-signal site (`entryPrice = price`), skip opening a
  position when `price <= 0` (both strategy loops, lines ~66 and ~120). With
  entry prices guaranteed > 0, the six division sites need no further guards —
  do NOT add redundant per-division checks.

**Verify**: `npx vitest run tests/unit/tools/risk-analysis.test.ts tests/unit/tools/backtest.test.ts` → all pass.

## Test plan

New tests (one `it` each unless noted), modeled on existing tests in the same files:

- `tests/unit/market-state/service.test.ts`: `addPortfolioLot` with
  `quantity: 0`, `avgCost: -1`, `quantity: NaN` → throws; `updatePortfolioLot`
  with `avgCost: 0` → throws; omitting both fields still works.
- `tests/unit/tools/portfolio-tracker.test.ts`: a lot whose `totalCost` is 0
  (insert via direct service/db call to bypass tool validation) renders with
  `pnlPercent: null` and no NaN in the output text (`expect(text).not.toMatch(/NaN/)`).
- `tests/unit/tools/predictions.test.ts`: prediction with entryPrice 0 reports
  the dataGap row, status stays open, output contains no NaN.
- `tests/unit/tools/risk-analysis.test.ts`: `computeDailyReturns([100, 0, 110])`
  returns only finite numbers (no NaN/Infinity); `computeRiskMetrics` with an
  all-zero price series throws "insufficient usable price history"; the tool
  with an all-zero closes fixture returns the unavailable-style text (no NaN
  anywhere in the output: `expect(text).not.toMatch(/NaN/)`).
- `tests/unit/tools/backtest.test.ts`: a price series containing zero closes
  produces a result with no NaN equity/pnl entries.
- Verification: `npx vitest run` → all pass.

## Done criteria

- [x] `npx tsc --noEmit` exits 0
- [x] `npx vitest run` exits 0; all new tests above exist and pass
- [x] `addPortfolioLot`/`updatePortfolioLot` reject non-finite or ≤0 quantity/avgCost
- [x] No files outside the in-scope list modified (`git status`)
- [x] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- Any excerpt no longer matches the live code (drift).
- Existing tests assert NaN-producing behavior (would indicate the current
  behavior is depended upon — report, don't delete assertions).
- You discover GUI mutation paths writing lots WITHOUT going through
  `addPortfolioLot`/`updatePortfolioLot` (search
  `grep -rn "portfolio_lots" gui/ src/ --include='*.ts' -l`) — service-layer
  validation would then be bypassable; report the extra path.

## Maintenance notes

- Future FX-conversion work (currency mixing is currently excluded from
  totals) will touch the same `tracker.ts` enrichment block — these guards
  must survive that refactor.
- Reviewer: check that service-layer throws are surfaced as readable tool
  errors, not stack traces, in the GUI (tool layer already catches and
  formats; confirm in the PR).
