const VALIDATION_TIMEOUT_MS = 5_000;

export type ModelKeyProviderId = "google" | "openai" | "anthropic";

export type ModelKeyValidationResult =
  | { status: "valid"; providerLabel: string }
  | { status: "invalid"; providerLabel: string }
  | { status: "transient"; providerLabel: string; reason: string };

interface ModelKeyProbe {
  label: string;
  url: string;
  headers: (key: string) => HeadersInit;
}

const MODEL_KEY_PROBES: Record<ModelKeyProviderId, ModelKeyProbe> = {
  google: {
    label: "Google Gemini",
    url: "https://generativelanguage.googleapis.com/v1beta/models",
    headers: (key) => ({ "x-goog-api-key": key }),
  },
  openai: {
    label: "OpenAI",
    url: "https://api.openai.com/v1/models",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  anthropic: {
    label: "Anthropic",
    url: "https://api.anthropic.com/v1/models",
    headers: (key) => ({ "x-api-key": key, "anthropic-version": "2023-06-01" }),
  },
};

/**
 * Checks whether an API key is accepted by a model provider without saving it.
 * Transient failures deliberately permit saving so offline setup remains usable.
 */
export async function validateModelKey(
  providerId: ModelKeyProviderId,
  key: string,
): Promise<ModelKeyValidationResult> {
  const probe = MODEL_KEY_PROBES[providerId];
  try {
    const response = await fetch(probe.url, {
      method: "GET",
      headers: probe.headers(key),
      signal: AbortSignal.timeout(VALIDATION_TIMEOUT_MS),
    });
    if (response.status === 401 || response.status === 403) {
      return { status: "invalid", providerLabel: probe.label };
    }
    if (!response.ok) {
      return { status: "transient", providerLabel: probe.label, reason: `HTTP ${response.status}` };
    }
    return { status: "valid", providerLabel: probe.label };
  } catch (error) {
    return {
      status: "transient",
      providerLabel: probe.label,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
