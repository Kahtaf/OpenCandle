import type { WorkflowType } from "../../../src/routing/types.js";
import type { EvalTrace, LayerDetail } from "../types.js";

export interface SavedMarketStateFidelityAssertion {
  requiredSummarySymbols: string[];
  requiredSummaryValues?: string[];
  requiredFinalValues: string[];
  forbiddenWorkflow?: WorkflowType;
  expectedTaskFamily?: string;
}

export function scoreSavedMarketStateFidelity(
  trace: EvalTrace,
  assertion: SavedMarketStateFidelityAssertion,
): LayerDetail {
  const failures: string[] = [];
  const routeContext = latestRouteContextText(trace);
  const normalizedRouteContext = normalizeText(routeContext);
  const normalizedFinalText = normalizeText(trace.text);

  if (
    assertion.forbiddenWorkflow &&
    (trace.classification.workflow === assertion.forbiddenWorkflow ||
      trace.router?.workflow === assertion.forbiddenWorkflow)
  ) {
    failures.push(`forbidden workflow ${assertion.forbiddenWorkflow}`);
  }

  if (assertion.expectedTaskFamily && trace.planning?.taskFamily !== assertion.expectedTaskFamily) {
    failures.push(
      `expected task family ${assertion.expectedTaskFamily}, got ${trace.planning?.taskFamily ?? "unknown"}`,
    );
  }

  for (const symbol of assertion.requiredSummarySymbols) {
    if (!normalizedRouteContext.includes(normalizeText(symbol))) {
      failures.push(`saved-state summary missing ${symbol}`);
    }
  }

  for (const value of assertion.requiredSummaryValues ?? []) {
    if (!normalizedRouteContext.includes(normalizeText(value))) {
      failures.push(`saved-state summary missing ${value}`);
    }
  }

  for (const value of assertion.requiredFinalValues) {
    if (!normalizedFinalText.includes(normalizeText(value))) {
      failures.push(`final text missing ${value}`);
    }
  }

  const checkedCount =
    1 +
    (assertion.expectedTaskFamily ? 1 : 0) +
    assertion.requiredSummarySymbols.length +
    (assertion.requiredSummaryValues?.length ?? 0) +
    assertion.requiredFinalValues.length;
  const score = checkedCount === 0 ? 1 : (checkedCount - failures.length) / checkedCount;
  return {
    passed: failures.length === 0,
    score: Math.max(0, score),
    message:
      failures.length > 0
        ? failures.join("; ")
        : "Saved market-state summary, route, and final values matched",
  };
}

function latestRouteContextText(trace: EvalTrace): string {
  const entry = [...(trace.customEntries ?? [])]
    .reverse()
    .find((candidate) => candidate.customType === "opencandle-route-context");
  return entry ? JSON.stringify(entry.data) : "";
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replaceAll(",", "")
    .replace(/\.00\b/g, "")
    .replace(/\s+/g, " ");
}
