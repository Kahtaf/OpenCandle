import { extractEntities } from "./entity-extractor.js";
import { buildRouterPrompt } from "./router-prompt.js";
import type {
  RouterInputContext,
  RouterLlmClient,
  RouterOutput,
  RouterPreferenceUpdate,
  RouterRoute,
  RouterSlot,
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
const VALID_SOURCES = new Set(["user", "preference", "default"]);
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
    return validateRouterOutput(raw);
  } catch (err) {
    firstError = err instanceof Error ? err.message : String(err);
  }

  // Retry once with error feedback.
  try {
    const retryPrompt = `${prompt}\n\n(Your previous response failed validation: ${firstError}. Return a valid JSON object conforming to RouterOutput. Nothing else.)`;
    const raw = await client.complete(retryPrompt);
    return validateRouterOutput(raw);
  } catch {
    // Persistent failure — return a minimal fallback with regex-extracted symbols.
    return minimalFallback(input.text);
  }
}

export function validateRouterOutput(raw: string): RouterOutput {
  const parsed = parseJsonPayload(raw);

  if (!parsed || typeof parsed !== "object") {
    throw new Error("router output was not a JSON object");
  }
  const obj = parsed as Record<string, unknown>;

  const route = obj.route;
  if (typeof route !== "string" || !VALID_ROUTES.includes(route as RouterRoute)) {
    throw new Error(`invalid route: ${JSON.stringify(route)}`);
  }

  let workflow: RouterOutput["workflow"];
  if (route === "workflow") {
    if (typeof obj.workflow !== "string" || !VALID_WORKFLOWS.includes(obj.workflow as Exclude<WorkflowType, "unclassified">)) {
      throw new Error(`workflow route requires a valid workflow; got ${JSON.stringify(obj.workflow)}`);
    }
    workflow = obj.workflow as Exclude<WorkflowType, "unclassified">;
  }

  const entities = validateEntities(obj.entities);
  const slots = validateSlots(obj.slots);
  const preference_updates = validatePreferenceUpdates(obj.preference_updates);
  const missing_required = validateStringArray(obj.missing_required, "missing_required");
  const reasoning =
    typeof obj.reasoning === "string" ? obj.reasoning : "";

  return {
    route: route as RouterRoute,
    workflow,
    entities,
    slots,
    preference_updates,
    missing_required,
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
  if (typeof e.timeHorizon === "string") out.timeHorizon = e.timeHorizon;
  if (typeof e.riskProfile === "string") out.riskProfile = e.riskProfile;
  if (e.direction === "bullish" || e.direction === "bearish") out.direction = e.direction;
  if (typeof e.dteHint === "string") out.dteHint = e.dteHint;
  return out;
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
    route: "fallback",
    entities: { symbols: entities.symbols },
    slots: {},
    preference_updates: [],
    missing_required: [],
    reasoning: "router validation failed; emitted minimal fallback",
  };
}
