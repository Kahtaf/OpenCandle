export const STORAGE_KEY = "opencandle.browser-runtime-spike.v1";

export interface StoredRuntimeRecord {
  version: 1;
  provider: "google" | "openai" | "anthropic";
  modelId: string;
  modelKey: string;
  credentialProvider?: "google" | "openai" | "anthropic";
  lastQuestion?: string;
  lastResult?: unknown;
}

export type ModelProvider = StoredRuntimeRecord["provider"];

const MODEL_SELECTIONS = {
  google: {
    provider: "google",
    modelId: "gemini-2.5-flash",
    envVar: "GEMINI_API_KEY",
  },
  openai: {
    provider: "openai",
    modelId: "gpt-5-mini",
    envVar: "OPENAI_API_KEY",
  },
  anthropic: {
    provider: "anthropic",
    modelId: "claude-haiku-4-5",
    envVar: "ANTHROPIC_API_KEY",
  },
} as const;

export function getModelSelection(provider: ModelProvider) {
  return MODEL_SELECTIONS[provider];
}

export function toSafeStoredMetadata(record: StoredRuntimeRecord) {
  return {
    configuredLabel: "Saved on this device" as const,
    provider: record.provider,
    modelId: record.modelId,
    ...(record.lastQuestion !== undefined && { lastQuestion: record.lastQuestion }),
    ...(record.lastResult !== undefined && { lastResult: record.lastResult }),
  };
}

export function clearStoredRuntimeRecord(storage: Pick<Storage, "removeItem">): void {
  storage.removeItem(STORAGE_KEY);
}

export function updateStoredDiagnostic(
  record: StoredRuntimeRecord,
  lastQuestion: string,
  lastResult: unknown,
): StoredRuntimeRecord {
  return { ...record, lastQuestion, lastResult };
}

export function updateStoredSelection(
  record: StoredRuntimeRecord,
  provider: ModelProvider,
): StoredRuntimeRecord {
  const selection = getModelSelection(provider);
  return { ...record, provider, modelId: selection.modelId };
}

export function parseStorageRecord(serialized: string | null): StoredRuntimeRecord | undefined {
  if (serialized === null) return undefined;
  try {
    const value: unknown = JSON.parse(serialized);
    if (!isStoredRuntimeRecord(value)) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

function isStoredRuntimeRecord(value: unknown): value is StoredRuntimeRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const provider = record.provider;
  return (
    record.version === 1 &&
    (provider === "google" || provider === "openai" || provider === "anthropic") &&
    record.modelId === MODEL_SELECTIONS[provider].modelId &&
    typeof record.modelKey === "string" &&
    (record.credentialProvider === undefined ||
      record.credentialProvider === "google" ||
      record.credentialProvider === "openai" ||
      record.credentialProvider === "anthropic") &&
    (record.lastQuestion === undefined || typeof record.lastQuestion === "string")
  );
}
