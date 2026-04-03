/** Source of a value flowing through the runtime. */
export type ProvenanceSource =
  | "user"
  | "preference"
  | "default"
  | "fetched"
  | "computed"
  | "unavailable";

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

/** Successful provider result. */
export interface ProviderResultOk<T> {
  status: "ok";
  data: T;
  timestamp: string;
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
): EvidenceRecord {
  if (isProviderOk(result)) {
    return {
      label,
      value: result.data,
      provenance: {
        source: "fetched",
        timestamp: result.timestamp,
        provider: undefined,
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
