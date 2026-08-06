import { alertThresholdPrefill } from "../market-state/MarketStatePage.jsx";

/**
 * Open the existing alert sheet with this symbol and a level already in its
 * threshold field. The level is written with the sheet's own prefill rule, so a
 * sub-cent instrument keeps the precision the sheet would have used itself; the
 * sheet remains authoritative for the currency and the distance hint.
 *
 * @returns {string | null} null when there is nothing honest to prefill.
 */
export function levelAlertHref(symbol, level) {
  const ticker = String(symbol ?? "")
    .trim()
    .toUpperCase();
  const threshold = alertThresholdPrefill(level);
  if (!ticker || !threshold) return null;
  return `/alerts?alertSymbol=${encodeURIComponent(ticker)}&alertThreshold=${encodeURIComponent(threshold)}`;
}

export async function invokeSymbolMutation({
  role,
  toolName,
  args,
  invokeTool,
  setToast,
  refresh,
  refreshQuotes,
}) {
  if (role !== "writer") {
    setToast?.("Saved-state changes are available in the writer window.");
    return false;
  }
  try {
    if (typeof invokeTool !== "function") {
      throw new Error("Market-state mutations require acknowledged tool invocation support.");
    }
    await invokeTool(toolName, args, "", { recordTranscript: false });
    await refresh?.();
    await refreshQuotes?.();
    return true;
  } catch (error) {
    setToast?.(error instanceof Error ? error.message : String(error), {
      destructive: true,
      title: "Tool failed",
    });
    return false;
  }
}
