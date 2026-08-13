import type { RouterOutput } from "../../src/routing/router-types.js";

export function stripNonContract(
  out: RouterOutput,
  expected?: { slotKeys: string[]; toolBundles: string[] },
): unknown {
  const entities = {
    ...out.entities,
    symbols: [...new Set(out.entities.symbols)],
  };
  delete entities.dteHint;
  delete entities.compareMetrics;
  if (!expected?.slotKeys.includes("time_horizon") || out.slots.dte_target) {
    delete entities.timeHorizon;
  }
  if (entities.catalystSymbols?.length === 0) delete entities.catalystSymbols;

  return {
    routeKind: out.routeKind,
    route: out.route,
    workflow: out.routeKind === "workflow_dispatch" ? out.workflow : undefined,
    entities,
    slots: contractSlotValues(out.slots, expected?.slotKeys),
    preference_updates: out.preference_updates,
    tool_bundles: contractToolBundles(out.tool_bundles, expected?.toolBundles),
    missing_required: out.missing_required,
  };
}

function contractToolBundles(bundles: string[] | undefined, allowedExtra?: string[]): string[] {
  const sorted = [...(bundles ?? [])].sort();
  if (!allowedExtra) return sorted;
  const expectedSet = new Set(allowedExtra);
  return sorted.filter((bundle) => expectedSet.has(bundle));
}

function contractSlotValues(
  slots: RouterOutput["slots"],
  allowedKeys?: string[],
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [key, slot] of Object.entries(slots ?? {})) {
    if (allowedKeys && !allowedKeys.includes(key)) continue;
    if (key === "time_horizon" && (slots.dte_target || allowedKeys?.includes("dte_target"))) {
      continue;
    }
    const value = Array.isArray(slot?.value) ? [...new Set(slot.value)] : slot?.value;
    values[key] = value;
  }
  return values;
}
