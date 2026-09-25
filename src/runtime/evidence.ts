/** Source of a value flowing through the runtime. */
export type ProvenanceSource =
  | "user"
  | "preference"
  | "default"
  | "fetched"
  | "computed"
  | "unavailable"
  | "stale_cache";

/** Tracks where a value came from, when, and with what confidence. */
export interface Provenance {
  source: ProvenanceSource;
  timestamp?: string;
  provider?: string;
  confidence?: number;
  reason?: string;
}

/** A labeled data point with its provenance. */
export interface EvidenceRecord {
  label: string;
  value: unknown;
  provenance: Provenance;
}

/**
 * Usability of a captured tool result as market evidence.
 * `ok` means the tool returned structured data; `error` and `unavailable`
 * results carry no usable evidence and must not satisfy evidence guards.
 */
export type ToolEvidenceOutcome = "ok" | "error" | "unavailable";

/**
 * Classify a tool result's usability from its runtime envelope
 * (`{ content, details }` plus the `isError` flag). Unavailable tools return
 * `details: null`, an empty payload, or — for `get_price_comparison` — a
 * metadata envelope with no aligned series. Thrown failures are flagged
 * `isError`.
 */
export function classifyToolOutcome(
  result: unknown,
  isError: boolean,
  toolName?: string,
): ToolEvidenceOutcome {
  if (isError) return "error";
  if (!isPlainRecord(result)) return "unavailable";
  if (toolName === "get_price_comparison") {
    // The comparison tool always returns range/interval/freshness metadata,
    // even when it found fewer than two usable aligned series. Only actual
    // series constitute pricing evidence, and the legacy no-envelope path
    // must not qualify a comparison either.
    const details = isPlainRecord(result.details) ? result.details : undefined;
    return Array.isArray(details?.series) && details.series.length > 0 ? "ok" : "unavailable";
  }
  if (!("details" in result)) {
    // Non-envelope result (extension/legacy tools): a non-empty structured
    // payload is usable, an empty one carries no evidence.
    return Object.keys(result).length > 0 ? "ok" : "unavailable";
  }
  return hasUsableDetails(result.details) ? "ok" : "unavailable";
}

function hasUsableDetails(details: unknown): boolean {
  if (details === null || details === undefined) return false;
  if (Array.isArray(details)) return details.length > 0;
  if (isPlainRecord(details)) return Object.keys(details).length > 0;
  return false;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Successful provider result. */
export interface ProviderResultOk<T> {
  status: "ok";
  data: T;
  timestamp: string;
  provider?: string;
  cached?: boolean;
  stale?: boolean;
}

/** Failed/unavailable provider result. */
export interface ProviderResultUnavailable {
  status: "unavailable";
  reason: string;
  provider: string;
}

/** Union of provider outcomes — every provider call returns one of these. */
export type ProviderResult<T> = ProviderResultOk<T> | ProviderResultUnavailable;

/** Type guard for successful provider results. */
export function isProviderOk<T>(result: ProviderResult<T>): result is ProviderResultOk<T> {
  return result.status === "ok";
}

/** Convert a ProviderResult into an EvidenceRecord. */
export function toEvidenceRecord<T>(
  label: string,
  result: ProviderResult<T>,
  providerId?: string,
): EvidenceRecord {
  if (isProviderOk(result)) {
    return {
      label,
      value: result.data,
      provenance: {
        source: result.stale ? "stale_cache" : "fetched",
        timestamp: result.timestamp,
        provider: providerId ?? result.provider,
        confidence: result.stale ? 0.5 : undefined,
      },
    };
  }
  return {
    label,
    value: null,
    provenance: {
      source: "unavailable",
      reason: result.reason,
      provider: result.provider,
    },
  };
}
