import type { MemoryCategory, MemoryEntry } from "../memory/types.js";
import {
  buildPlanningEnvelope,
  type PlanningBuildOptions,
  type PlanningEnvelope,
} from "./planning.js";
import { activeToolsForBundles, memoryScopesForRoute } from "./route-manifest.js";
import type {
  RouterDiagnostic,
  RouterInputContext,
  RouterOutput,
  RouterRoute,
  RouterRouteKind,
  RouterSlot,
  ToolBundleName,
} from "./router-types.js";
import type { ExtractedEntities, WorkflowType } from "./types.js";

export interface MemoryQueryPlan {
  routeKind: RouterRouteKind;
  workflow?: Exclude<WorkflowType, "unclassified">;
  categories: MemoryCategory[];
  symbols: string[];
  slotKeys: string[];
}

export interface MemoryProvenance {
  category: MemoryCategory;
  key: string;
  source?: string;
  recordedAt: string;
  confidence?: string;
  filtered?: boolean;
  filterReason?: string;
}

export interface ResolvedTurnContext {
  userInput: string;
  priorTurns: RouterInputContext["priorTurns"];
  routeKind: RouterRouteKind;
  legacyRoute: RouterRoute;
  workflow?: Exclude<WorkflowType, "unclassified">;
  entities: ExtractedEntities;
  slots: Record<string, RouterSlot>;
  missingRequired: string[];
  toolBundles: ToolBundleName[];
  activeToolNames: string[];
  memoryQueryPlan: MemoryQueryPlan;
  memoryProvenance: MemoryProvenance[];
  promptPlaybook: RouterRouteKind;
  diagnostics: RouterDiagnostic[];
  planning: PlanningEnvelope;
}

export function buildResolvedTurnContext(
  input: RouterInputContext,
  output: RouterOutput,
  options: {
    availableToolNames?: readonly string[];
    memoryEntries?: readonly MemoryEntry[];
    filteredMemory?: readonly MemoryProvenance[];
    planning?: PlanningBuildOptions;
  } = {},
): ResolvedTurnContext {
  const memoryQueryPlan = buildMemoryQueryPlan(output);
  const memoryProvenance = [
    ...(options.memoryEntries ?? []).map(memoryEntryToProvenance),
    ...(options.filteredMemory ?? []),
  ];

  return {
    userInput: input.text,
    priorTurns: input.priorTurns,
    routeKind: output.routeKind,
    legacyRoute: output.route,
    workflow: output.workflow,
    entities: output.entities,
    slots: output.slots,
    missingRequired: output.missing_required,
    toolBundles: output.tool_bundles,
    activeToolNames: activeToolsForBundles(output.tool_bundles, options.availableToolNames),
    memoryQueryPlan,
    memoryProvenance,
    promptPlaybook: output.routeKind,
    diagnostics: output.diagnostics,
    planning: buildPlanningEnvelope(input, output, options.planning),
  };
}

export function buildMemoryQueryPlan(output: RouterOutput): MemoryQueryPlan {
  return {
    routeKind: output.routeKind,
    workflow: output.workflow,
    categories: memoryScopesForRoute(output.routeKind, output.workflow),
    symbols: output.entities.symbols,
    slotKeys: Object.keys(output.slots),
  };
}

function memoryEntryToProvenance(entry: MemoryEntry): MemoryProvenance {
  return {
    category: entry.category,
    key: entry.key,
    source: entry.source,
    recordedAt: entry.recordedAt,
    confidence: entry.confidence,
  };
}
