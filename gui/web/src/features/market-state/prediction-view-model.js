export function predictionProgress({ direction, entryPrice, targetPrice, currentPrice }) {
  if (
    typeof targetPrice !== "number" ||
    typeof currentPrice !== "number" ||
    typeof entryPrice !== "number"
  ) {
    return null;
  }
  const span = targetPrice - entryPrice;
  if (span === 0) return { percent: 100, targetHit: true, directionCorrect: true };
  const moved = currentPrice - entryPrice;
  const ratio = moved / span;
  const percent = Math.min(100, Math.max(0, ratio * 100));
  return {
    percent,
    targetHit: ratio >= 1,
    directionCorrect:
      direction === "bearish" ? currentPrice <= entryPrice : currentPrice >= entryPrice,
  };
}

export function buildPredictionScorecard(predictions = []) {
  const open = predictions.filter((prediction) => prediction.status === "open");
  const scored = predictions.filter(
    (prediction) => prediction.status === "resolved" || prediction.status === "expired",
  );

  const results = scored
    .map((prediction) => parseResult(prediction.resultJson))
    .filter((result) => result != null);
  const hits = results.filter((result) => result.correct === true);

  const nextExpiry =
    open
      .map((prediction) => prediction.expiresAt)
      .filter(Boolean)
      .sort()[0] ?? null;

  return {
    openCount: open.length,
    resolvedCount: scored.length,
    hitRatePercent: scored.length > 0 ? (hits.length / scored.length) * 100 : null,
    avgHitPnlPercent:
      hits.length > 0
        ? hits.reduce((sum, result) => sum + (result.pnlPercent ?? 0), 0) / hits.length
        : null,
    nextExpiry,
  };
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
