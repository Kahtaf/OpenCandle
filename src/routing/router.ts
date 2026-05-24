import { extractEntities, isAmbiguousConceptUsage } from "./entity-extractor.js";
import { classifyIntent } from "./classify-intent.js";
import { buildRouterPrompt } from "./router-prompt.js";
import {
  computeMissingRequiredSlots,
  isDispatchableWorkflow,
  isRouteKind,
  isToolBundleName,
  legacyRouteForRouteKind,
  routeKindFromLegacyRoute,
  selectToolBundles,
} from "./route-manifest.js";
import type {
  RouterDiagnostic,
  RouterInputContext,
  RouterLlmClient,
  RouterOutput,
  RouterPreferenceUpdate,
  RouterRoute,
  RouterRouteKind,
  RouterSlot,
  ToolBundleName,
} from "./router-types.js";
import type { ExtractedEntities, WorkflowType } from "./types.js";

const VALID_ROUTES: readonly RouterRoute[] = ["workflow", "fallback"];
const VALID_WORKFLOWS: ReadonlyArray<Exclude<WorkflowType, "unclassified">> = [
  "portfolio_builder",
  "options_screener",
  "compare_assets",
  "single_asset_analysis",
  "watchlist_or_tracking",
  "general_finance_qa",
];
const VALID_SOURCES = new Set(["user", "preference", "default", "prior_context", "memory"]);
const VALID_CONFIDENCE = new Set(["high", "medium", "low"]);

/**
 * Run the LLM router against the given input context. Retries once on
 * validation failure with a corrective message. Falls back to a minimal
 * `route: "fallback"` output on persistent failure.
 *
 * The LLM client is injected so unit tests can supply deterministic responses.
 */
export async function route(
  input: RouterInputContext,
  client: RouterLlmClient,
): Promise<RouterOutput> {
  const prompt = buildRouterPrompt(input);

  let firstError: string | undefined;
  try {
    const raw = await client.complete(prompt);
    return postProcessRouterOutput(input.text, validateRouterOutput(raw));
  } catch (err) {
    firstError = err instanceof Error ? err.message : String(err);
  }

  // Retry once with error feedback.
  try {
    const retryPrompt = `${prompt}\n\n(Your previous response failed validation: ${firstError}. Return a valid JSON object conforming to RouterOutput. Nothing else.)`;
    const raw = await client.complete(retryPrompt);
    return postProcessRouterOutput(input.text, validateRouterOutput(raw));
  } catch {
    // Persistent failure — return a minimal fallback with regex-extracted symbols.
    return postProcessRouterOutput(input.text, minimalFallback(input.text));
  }
}

export function validateRouterOutput(raw: string): RouterOutput {
  const parsed = parseJsonPayload(raw);

  if (!parsed || typeof parsed !== "object") {
    throw new Error("router output was not a JSON object");
  }
  const obj = parsed as Record<string, unknown>;

  const rawMissingRequired = validateStringArray(obj.missing_required, "missing_required");

  const explicitRouteKind = obj.routeKind;
  if (
    explicitRouteKind !== undefined &&
    (typeof explicitRouteKind !== "string" || !isRouteKind(explicitRouteKind))
  ) {
    throw new Error(`invalid routeKind: ${JSON.stringify(explicitRouteKind)}`);
  }

  const rawRoute = obj.route;
  let route: RouterRoute;
  if (typeof rawRoute === "string") {
    if (!VALID_ROUTES.includes(rawRoute as RouterRoute)) {
      throw new Error(`invalid route: ${JSON.stringify(rawRoute)}`);
    }
    route = rawRoute as RouterRoute;
  } else if (typeof explicitRouteKind === "string" && isRouteKind(explicitRouteKind)) {
    route = legacyRouteForRouteKind(explicitRouteKind);
  } else {
    throw new Error(`invalid route: ${JSON.stringify(rawRoute)}`);
  }

  let workflow: RouterOutput["workflow"];
  const routeKind: RouterRouteKind =
    typeof explicitRouteKind === "string" && isRouteKind(explicitRouteKind)
      ? explicitRouteKind
      : routeKindFromLegacyRoute(route, rawMissingRequired);

  if (route === "workflow" || routeKind === "workflow_dispatch") {
    if (typeof obj.workflow !== "string" || !VALID_WORKFLOWS.includes(obj.workflow as Exclude<WorkflowType, "unclassified">)) {
      throw new Error(`workflow route requires a valid workflow; got ${JSON.stringify(obj.workflow)}`);
    }
    workflow = obj.workflow as Exclude<WorkflowType, "unclassified">;
  } else if (typeof obj.workflow === "string" && VALID_WORKFLOWS.includes(obj.workflow as Exclude<WorkflowType, "unclassified">)) {
    workflow = obj.workflow as Exclude<WorkflowType, "unclassified">;
  }

  const entities = validateEntities(obj.entities);
  const slots = validateSlots(obj.slots);
  const preference_updates = validatePreferenceUpdates(obj.preference_updates);
  const missing_required = rawMissingRequired;
  const tool_bundles = validateToolBundles(obj.tool_bundles);
  const diagnostics = validateDiagnostics(obj.diagnostics);
  const reasoning =
    typeof obj.reasoning === "string" ? obj.reasoning : "";

  return {
    routeKind,
    route: legacyRouteForRouteKind(routeKind),
    workflow,
    entities,
    slots,
    preference_updates,
    missing_required,
    tool_bundles,
    diagnostics,
    reasoning,
  };
}

function parseJsonPayload(raw: string): unknown {
  const trimmed = raw.trim();
  // Tolerate ```json ... ``` fences even though the prompt forbids them.
  const stripped = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(stripped);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`router output was not valid JSON: ${msg}`);
  }
}

function validateEntities(raw: unknown): ExtractedEntities {
  if (!raw || typeof raw !== "object") {
    throw new Error("entities must be an object");
  }
  const e = raw as Record<string, unknown>;
  const symbols = validateStringArray(e.symbols, "entities.symbols").map((s) =>
    s.toUpperCase(),
  );

  const out: ExtractedEntities = { symbols };
  if (typeof e.budget === "number") out.budget = e.budget;
  if (typeof e.maxPremium === "number") out.maxPremium = e.maxPremium;
  if (typeof e.costBasis === "number") out.costBasis = e.costBasis;
  if (typeof e.shareQuantity === "number") out.shareQuantity = e.shareQuantity;
  if (typeof e.timeHorizon === "string") out.timeHorizon = e.timeHorizon;
  if (typeof e.riskProfile === "string") out.riskProfile = e.riskProfile;
  if (e.direction === "bullish" || e.direction === "bearish") out.direction = e.direction;
  if (typeof e.dteHint === "string") out.dteHint = e.dteHint;
  if (e.optionStrategy === "covered_call" || e.optionStrategy === "protective_put") out.optionStrategy = e.optionStrategy;
  if (typeof e.heldSymbol === "string") out.heldSymbol = e.heldSymbol.toUpperCase();
  const catalystSymbols = validateStringArray(e.catalystSymbols, "entities.catalystSymbols").map((s) =>
    s.toUpperCase(),
  );
  if (catalystSymbols.length > 0) out.catalystSymbols = catalystSymbols;
  const compareMetrics = validateStringArray(e.compareMetrics, "entities.compareMetrics");
  if (compareMetrics.length > 0) out.compareMetrics = compareMetrics;
  return out;
}

export function postProcessRouterOutput(text: string, output: RouterOutput): RouterOutput {
  const extracted = extractEntities(text);
  const deterministic = classifyIntent(text);
  let diagnostics: RouterDiagnostic[] = [...output.diagnostics];
  let next: RouterOutput = {
    ...output,
    entities: {
      ...output.entities,
      symbols: output.entities.symbols.filter((symbol) =>
        !isAmbiguousConceptUsage(text, symbol),
      ),
      budget: output.entities.budget ?? extracted.budget,
      maxPremium: output.entities.maxPremium ?? extracted.maxPremium,
      timeHorizon: output.entities.timeHorizon ?? extracted.timeHorizon,
      riskProfile: output.entities.riskProfile ?? extracted.riskProfile,
      assetScope: output.entities.assetScope ?? extracted.assetScope,
      compareMetrics: output.entities.compareMetrics ?? extracted.compareMetrics,
      direction: output.entities.direction ?? extracted.direction,
      optionStrategy: output.entities.optionStrategy ?? extracted.optionStrategy,
      costBasis: output.entities.costBasis ?? extracted.costBasis,
      shareQuantity: output.entities.shareQuantity ?? extracted.shareQuantity,
      heldSymbol: output.entities.heldSymbol ?? extracted.heldSymbol,
      catalystSymbols: output.entities.catalystSymbols ?? extracted.catalystSymbols,
      dteHint: output.entities.dteHint ?? (output.workflow === "options_screener" ? extracted.dteHint : undefined),
    },
    diagnostics,
  };

  if (next.workflow === "options_screener" && isExistingPositionOptionRequest(text, extracted) && extracted.heldSymbol) {
    const reorderedSymbols = [
      extracted.heldSymbol,
      ...mergeSymbols(next.entities.symbols, extracted.symbols).filter((symbol) => symbol !== extracted.heldSymbol),
    ];
    if (next.entities.symbols[0] !== extracted.heldSymbol) {
      diagnostics.push({
        code: extracted.optionStrategy === "protective_put"
          ? "existing_position_underlying_corrected"
          : "covered_call_underlying_corrected",
        message: `using owned position ${extracted.heldSymbol} as the option-chain underlying`,
      });
    }
    next = {
      ...next,
      entities: {
        ...next.entities,
        symbols: reorderedSymbols,
        optionStrategy: extracted.optionStrategy ?? next.entities.optionStrategy,
        direction: extracted.direction ?? next.entities.direction,
        heldSymbol: extracted.heldSymbol,
        catalystSymbols: reorderedSymbols.filter((symbol) => symbol !== extracted.heldSymbol),
        costBasis: extracted.costBasis ?? next.entities.costBasis,
        shareQuantity: extracted.shareQuantity ?? next.entities.shareQuantity,
        dteHint: extracted.dteHint ?? next.entities.dteHint,
      },
      diagnostics,
    };
  }

  if (
    next.diagnostics.some((d) => d.code === "router_validation_failed") &&
    deterministic.workflow !== "unclassified"
  ) {
    next = {
      ...next,
      routeKind: isDispatchableWorkflow(deterministic.workflow)
        ? "workflow_dispatch"
        : "agent_task",
      route: isDispatchableWorkflow(deterministic.workflow) ? "workflow" : "fallback",
      workflow: deterministic.workflow,
      entities: {
        ...deterministic.entities,
        budget: deterministic.entities.budget ?? extracted.budget,
        maxPremium: deterministic.entities.maxPremium ?? extracted.maxPremium,
        timeHorizon: deterministic.entities.timeHorizon ?? extracted.timeHorizon,
        riskProfile: deterministic.entities.riskProfile ?? extracted.riskProfile,
        assetScope: deterministic.entities.assetScope ?? extracted.assetScope,
        compareMetrics: deterministic.entities.compareMetrics ?? extracted.compareMetrics,
        direction: deterministic.entities.direction ?? extracted.direction,
        costBasis: deterministic.entities.costBasis ?? extracted.costBasis,
        shareQuantity: deterministic.entities.shareQuantity ?? extracted.shareQuantity,
        heldSymbol: deterministic.entities.heldSymbol ?? extracted.heldSymbol,
        catalystSymbols: deterministic.entities.catalystSymbols ?? extracted.catalystSymbols,
      },
      diagnostics: [
        ...diagnostics,
        {
          code: "deterministic_failure_recovery",
          message: `deterministic classifier selected ${deterministic.workflow} after router validation failure`,
        },
      ],
      reasoning: next.reasoning
        ? `${next.reasoning}; deterministic classifier selected ${deterministic.workflow}`
        : `deterministic classifier selected ${deterministic.workflow}`,
    };
    diagnostics = next.diagnostics;
  }

  if (next.routeKind === "workflow_dispatch" && !isDispatchableWorkflow(next.workflow)) {
    diagnostics.push({
      code: "route_kind_corrected_to_agent_task",
      message: next.workflow
        ? `${next.workflow} is not a dispatchable workflow`
        : "workflow_dispatch requires a dispatchable workflow",
    });
    next = {
      ...next,
      routeKind: "agent_task",
      route: "fallback",
      diagnostics,
    };
  }

  if (
    next.workflow === "compare_assets" &&
    next.entities.symbols.length === 0 &&
    isExplicitMacroDataRequest(text)
  ) {
    diagnostics.push({
      code: "compare_route_corrected_to_macro_task",
      message: "macro/source acronyms were not explicit tickers",
    });
    next = {
      ...next,
      routeKind: "agent_task",
      route: "fallback",
      workflow: "general_finance_qa",
      missing_required: [],
      diagnostics,
    };
  }

  if (
    next.routeKind === "agent_task" &&
    !next.workflow &&
    next.entities.symbols.length === 0 &&
    isExplicitMacroDataRequest(text)
  ) {
    diagnostics.push({
      code: "macro_task_inferred_from_prompt",
      message: "macro data terms were present without explicit tickers",
    });
    next = {
      ...next,
      workflow: "general_finance_qa",
      diagnostics,
    };
  }

  if (next.workflow === "portfolio_builder" && isPortfolioEvaluationRequest(text)) {
    diagnostics.push({
      code: "portfolio_evaluation_corrected_to_agent_task",
      message: "existing portfolio/allocation evaluation does not require portfolio-construction budget",
    });
    next = {
      ...next,
      routeKind: "agent_task",
      route: "fallback",
      workflow: "general_finance_qa",
      missing_required: [],
      diagnostics,
    };
  }

  if (
    next.workflow === "portfolio_builder" &&
    next.entities.symbols.length >= 2 &&
    isPortfolioTradeoffComparisonRequest(text)
  ) {
    diagnostics.push({
      code: "portfolio_tradeoff_corrected_to_compare_assets",
      message: "explicit multi-asset tradeoff question should compare the requested assets before constructing a portfolio",
    });
    next = {
      ...next,
      routeKind: "workflow_dispatch",
      route: "workflow",
      workflow: "compare_assets",
      missing_required: [],
      diagnostics,
    };
  }

  const missingRequired = computeMissingRequiredSlots(
    next.workflow,
    next.entities,
    next.slots,
    next.missing_required,
  );
  if (missingRequired.length > 0 && next.routeKind !== "pass_through") {
    if (next.routeKind !== "clarification") {
      diagnostics.push({
        code: "route_kind_corrected_to_clarification",
        message: `missing required slots: ${missingRequired.join(", ")}`,
      });
    }
    next = {
      ...next,
      routeKind: "clarification",
      route: "fallback",
      missing_required: missingRequired,
      diagnostics,
    };
  }

  const selectedToolBundles = isConceptualEducationRequest(text, next)
    ? []
    : selectToolBundles(next);
  if (selectedToolBundles.length === 0 && isConceptualEducationRequest(text, next)) {
    diagnostics.push({
      code: "conceptual_education_no_tools",
      message: "conceptual education prompt does not need live finance tools",
    });
  }
  const emittedUnsupported = next.tool_bundles.filter((bundle) => !selectedToolBundles.includes(bundle));
  if (emittedUnsupported.length > 0) {
    diagnostics.push({
      code: "tool_bundles_corrected",
      message: `unsupported emitted bundles dropped: ${emittedUnsupported.join(", ")}`,
    });
  }

  return omitUndefined({
    ...next,
    route: legacyRouteForRouteKind(next.routeKind),
    tool_bundles: selectedToolBundles,
    diagnostics,
  });
}

function isExplicitMacroDataRequest(text: string): boolean {
  return /\b(?:get_economic_data|fred|cpi|inflation|fed\s+funds?|unemployment|gdp|macro)\b/i.test(text);
}

function isConceptualEducationRequest(text: string, output: RouterOutput): boolean {
  if (output.routeKind !== "agent_task") return false;
  if (output.entities.symbols.length > 0) return false;
  if (/\b(?:current|recent|today|right now|latest|news|sentiment|build|portfolio|buy|sell|allocate|compare)\b/i.test(text)) {
    return false;
  }
  return /\b(?:explain|what is|define|how (?:do|should|to)|teach me|help me understand)\b/i.test(text);
}

function isCoveredCallRequest(text: string): boolean {
  return /\bcovered\s+calls?\b/i.test(text);
}

function isPortfolioEvaluationRequest(text: string): boolean {
  const lower = text.toLowerCase();
  const hasEvaluationIntent =
    /\b(?:evaluat(?:e|ion)|review|assess|analy[sz]e|prospects?|risks?|opportunities?|mitigat(?:e|ion)|adjustment)\b/.test(lower);
  const hasPortfolioObject =
    /\b(?:portfolio|allocation|asset\s+allocation|60\/40|equity|fixed\s+income|bonds?)\b/.test(lower);
  const hasConstructionIntent =
    /\b(?:build|create|construct|put\s+together|invest|allocate)\b/.test(lower) &&
    (/\$\s*\d|\b\d+(?:\.\d+)?\s*k\b|\bbudget\b|\bcapital\b/.test(lower));
  return hasEvaluationIntent && hasPortfolioObject && !hasConstructionIntent;
}

function isPortfolioTradeoffComparisonRequest(text: string): boolean {
  const lower = text.toLowerCase();
  return /\b(?:prioritize|tradeoffs?|growth[-\s]?oriented|dividend|income|which\s+(?:one|is)\s+better|should\s+i)\b/.test(lower) &&
    /\b(?:or|vs\.?|versus|compare)\b/.test(lower);
}

function isExistingPositionOptionRequest(text: string, extracted: ExtractedEntities): boolean {
  return isCoveredCallRequest(text) || extracted.optionStrategy === "protective_put";
}

function mergeSymbols(primary: string[], secondary: string[]): string[] {
  const merged: string[] = [];
  for (const symbol of [...primary, ...secondary]) {
    if (!merged.includes(symbol)) merged.push(symbol);
  }
  return merged;
}

function omitUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(omitUndefined) as T;
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) out[key] = omitUndefined(entry);
  }
  return out as T;
}

function validateSlots(raw: unknown): Record<string, RouterSlot> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object") {
    throw new Error("slots must be an object");
  }
  const out: Record<string, RouterSlot> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!val || typeof val !== "object") {
      throw new Error(`slot ${key} must be an object`);
    }
    const s = val as Record<string, unknown>;
    if (!VALID_SOURCES.has(s.source as string)) {
      throw new Error(`slot ${key} has invalid source: ${JSON.stringify(s.source)}`);
    }
    if (!VALID_CONFIDENCE.has(s.confidence as string)) {
      throw new Error(`slot ${key} has invalid confidence: ${JSON.stringify(s.confidence)}`);
    }
    out[key] = {
      value: s.value,
      source: s.source as RouterSlot["source"],
      confidence: s.confidence as RouterSlot["confidence"],
    };
  }
  return out;
}

function validatePreferenceUpdates(raw: unknown): RouterPreferenceUpdate[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new Error("preference_updates must be an array");
  }
  return raw.map((item, idx) => {
    if (!item || typeof item !== "object") {
      throw new Error(`preference_updates[${idx}] must be an object`);
    }
    const p = item as Record<string, unknown>;
    if (typeof p.key !== "string" || p.key.length === 0) {
      throw new Error(`preference_updates[${idx}].key must be a non-empty string`);
    }
    if (typeof p.value !== "string") {
      throw new Error(`preference_updates[${idx}].value must be a string`);
    }
    if (!VALID_CONFIDENCE.has(p.confidence as string)) {
      throw new Error(`preference_updates[${idx}].confidence is invalid`);
    }
    // Router-emitted preferences are always inferred — absent is accepted
    // (normalized), but any explicit non-"inferred" value is an invariant
    // violation the caller should see rather than silently lose.
    if (p.source !== undefined && p.source !== "inferred") {
      throw new Error(`preference_updates[${idx}].source must be "inferred" (got ${JSON.stringify(p.source)})`);
    }
    return {
      key: p.key,
      value: p.value,
      confidence: p.confidence as RouterPreferenceUpdate["confidence"],
      source: "inferred",
    };
  });
}

function validateToolBundles(raw: unknown): ToolBundleName[] {
  const bundles = validateStringArray(raw, "tool_bundles");
  return bundles.filter(isToolBundleName);
}

function validateDiagnostics(raw: unknown): RouterDiagnostic[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new Error("diagnostics must be an array");
  }
  return raw.map((item, idx) => {
    if (!item || typeof item !== "object") {
      throw new Error(`diagnostics[${idx}] must be an object`);
    }
    const diagnostic = item as Record<string, unknown>;
    if (typeof diagnostic.code !== "string" || diagnostic.code.length === 0) {
      throw new Error(`diagnostics[${idx}].code must be a non-empty string`);
    }
    if (typeof diagnostic.message !== "string") {
      throw new Error(`diagnostics[${idx}].message must be a string`);
    }
    return {
      code: diagnostic.code,
      message: diagnostic.message,
    };
  });
}

function validateStringArray(raw: unknown, field: string): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new Error(`${field} must be an array`);
  }
  return raw.map((item, idx) => {
    if (typeof item !== "string") {
      throw new Error(`${field}[${idx}] must be a string`);
    }
    return item;
  });
}

function minimalFallback(text: string): RouterOutput {
  const entities = extractEntities(text);
  return {
    routeKind: "agent_task",
    route: "fallback",
    entities,
    slots: {},
    preference_updates: [],
    missing_required: [],
    tool_bundles: [],
    diagnostics: [
      {
        code: "router_validation_failed",
        message: "router validation failed persistently; emitted minimal fallback",
      },
    ],
    reasoning: "router validation failed; emitted minimal fallback",
  };
}
