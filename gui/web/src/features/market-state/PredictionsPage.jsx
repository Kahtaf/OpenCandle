import { TrendingUp } from "lucide-react";
import { useMemo } from "react";
import { Button } from "../../components/ui/button.jsx";
import { relativeTime, shortDateLabel } from "./format.js";
import { buildPredictionScorecard, predictionProgress } from "./prediction-view-model.js";
import {
  Badge,
  ConfirmButton,
  EmptyState,
  filterItems,
  moneyOrDash,
  Panel,
  SignedPercent,
  Sym,
} from "./shared.jsx";

export function PredictionsPage({ state, filter, readOnly, openPanel, invokeTool }) {
  const rows = useMemo(
    () => filterItems(state.predictions ?? [], filter, ["symbol", "direction", "status"]),
    [state.predictions, filter],
  );
  const scorecard = useMemo(
    () => buildPredictionScorecard(state.predictions ?? []),
    [state.predictions],
  );
  const quotesBySymbol = useMemo(() => {
    const map = new Map();
    for (const quote of state.quoteSnapshot?.watchlistQuotes ?? []) {
      if (quote.status === "ok") map.set(quote.symbol, quote.price);
    }
    for (const quote of state.quoteSnapshot?.portfolioQuotes ?? []) {
      if (quote.status === "ok" && !map.has(quote.symbol))
        map.set(quote.symbol, quote.currentPrice);
    }
    return map;
  }, [state.quoteSnapshot]);

  const open = rows.filter((prediction) => prediction.status === "open");
  const scored = rows.filter(
    (prediction) => prediction.status === "resolved" || prediction.status === "expired",
  );

  return (
    <div className="flex flex-col gap-3">
      {scorecard.openCount > 0 || scorecard.resolvedCount > 0 ? (
        <section className="flex flex-wrap items-baseline gap-x-10 gap-y-3 rounded-xl border border-border bg-card p-4 shadow-subtle-xs sm:p-5">
          <Stat
            value={`${scorecard.openCount} open`}
            hint={
              scorecard.nextExpiry
                ? `next expires ${shortDateLabel(scorecard.nextExpiry)}`
                : "no expiries pending"
            }
          />
          {scorecard.hitRatePercent != null ? (
            <Stat
              value={`${Math.round(scorecard.hitRatePercent)}% hit rate`}
              hint={`${scorecard.resolvedCount} scored`}
            />
          ) : null}
          {scorecard.avgHitPnlPercent != null ? (
            <Stat
              value={<SignedPercent value={scorecard.avgHitPnlPercent} decimals={1} />}
              hint="avg move captured when right"
            />
          ) : null}
        </section>
      ) : null}

      <Panel
        title="Open"
        count={open.length}
        actions={
          <Button
            type="button"
            variant="bordered"
            size="sm"
            disabled={readOnly}
            onClick={() => invokeTool("track_prediction", { action: "check" })}
          >
            Score now
          </Button>
        }
      >
        {open.length === 0 ? (
          <EmptyState
            icon={TrendingUp}
            title={state.predictions?.length ? "No open predictions" : "No predictions recorded"}
            action="Record a directional call with an entry, target, and timeframe; OpenCandle scores it against live quotes."
            cta={{
              label: "Record prediction",
              disabled: readOnly,
              onClick: () => openPanel("thesis-record"),
            }}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm md:min-w-[640px]">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Call</th>
                  <th className="hidden px-4 py-2 text-right font-medium sm:table-cell">
                    Entry → Now
                  </th>
                  <th className="px-4 py-2 font-medium">Progress to target</th>
                  <th className="hidden px-4 py-2 text-right font-medium md:table-cell">Expires</th>
                  <th className="px-4 py-2 pr-4" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {open.map((prediction) => {
                  const currentPrice = quotesBySymbol.get(prediction.symbol) ?? null;
                  const progress = predictionProgress({
                    direction: prediction.direction,
                    entryPrice: prediction.entryPrice,
                    targetPrice: prediction.targetPrice,
                    currentPrice,
                  });
                  const movePercent =
                    currentPrice != null && prediction.entryPrice > 0
                      ? ((currentPrice - prediction.entryPrice) / prediction.entryPrice) * 100
                      : null;
                  return (
                    <tr key={prediction.id} className="border-b border-border/70 last:border-0">
                      <td className="px-4 py-2.5">
                        <Sym
                          symbol={prediction.symbol}
                          name={`${capitalize(prediction.direction)} to ${moneyOrDash(prediction.targetPrice)} · conviction ${prediction.conviction}/10`}
                        />
                      </td>
                      <td className="hidden px-4 py-2.5 text-right tabular-nums sm:table-cell">
                        {moneyOrDash(prediction.entryPrice)} → {moneyOrDash(currentPrice)}{" "}
                        {movePercent != null ? (
                          <SignedPercent value={movePercent} decimals={1} />
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5">
                        {progress ? (
                          progress.targetHit ? (
                            <Badge tone="ok">Target hit</Badge>
                          ) : (
                            <span className="flex min-w-[160px] items-center gap-2">
                              <span className="relative h-[5px] flex-1 rounded-full bg-tertiary">
                                <span
                                  className="absolute inset-y-0 left-0 rounded-full bg-hard"
                                  style={{ width: `${progress.percent}%` }}
                                />
                              </span>
                              <span className="text-xs tabular-nums text-muted-foreground">
                                {Math.round(progress.percent)}%
                              </span>
                            </span>
                          )
                        ) : (
                          <span className="text-xs text-muted-foreground">awaiting quote</span>
                        )}
                      </td>
                      <td className="hidden px-4 py-2.5 text-right text-xs tabular-nums text-muted-foreground md:table-cell">
                        {shortDateLabel(prediction.expiresAt) || "—"}
                      </td>
                      <td className="px-4 py-2.5 pr-4 text-right">
                        <ConfirmButton
                          label="Cancel"
                          confirmLabel="Cancel call?"
                          disabled={readOnly}
                          onConfirm={() =>
                            invokeTool("track_prediction", { action: "cancel", id: prediction.id })
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {scored.length > 0 ? (
        <Panel title="Resolved" count={scored.length}>
          <ul>
            {scored.map((prediction) => {
              const result = parseResult(prediction.resultJson);
              return (
                <li
                  key={prediction.id}
                  className="grid grid-cols-[90px_minmax(0,1fr)] gap-3 border-b border-border/70 px-4 py-2.5 text-[13px] last:border-0 sm:grid-cols-[110px_minmax(0,1fr)]"
                >
                  <time className="tabular-nums text-muted-foreground">
                    {relativeTime(prediction.resolvedAt ?? prediction.expiresAt) ||
                      shortDateLabel(prediction.expiresAt)}
                  </time>
                  <div>
                    <span className="font-semibold">{prediction.symbol}</span>{" "}
                    {prediction.direction} to {moneyOrDash(prediction.targetPrice)} —{" "}
                    {result?.correct === true ? (
                      <span className="font-medium text-success">hit</span>
                    ) : result?.correct === false ? (
                      <span className="font-medium text-destructive">missed</span>
                    ) : (
                      <span className="text-muted-foreground">{prediction.status}</span>
                    )}
                    {typeof result?.pnlPercent === "number" ? (
                      <span className="text-muted-foreground">
                        {" "}
                        ({result.pnlPercent > 0 ? "+" : ""}
                        {result.pnlPercent.toFixed(1)}% from entry)
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}

function Stat({ value, hint }) {
  return (
    <div>
      <div className="text-[22px] font-semibold leading-tight tabular-nums text-foreground">
        {value}
      </div>
      <div className="text-xs text-muted-foreground">{hint}</div>
    </div>
  );
}

function capitalize(value) {
  return typeof value === "string" && value ? value[0].toUpperCase() + value.slice(1) : value;
}

function parseResult(resultJson) {
  if (typeof resultJson !== "string" || resultJson === "") return null;
  try {
    const parsed = JSON.parse(resultJson);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
