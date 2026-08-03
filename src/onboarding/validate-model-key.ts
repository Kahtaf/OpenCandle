const VALIDATION_TIMEOUT_MS = 5_000;
const MODEL_KEY_PROBE_BASE_URL_ENV = "OPENCANDLE_MODEL_KEY_PROBE_BASE_URL";

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
    headers: (key) => ({
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    }),
  },
};

/**
 * Checks whether an API key is accepted by a model provider without saving it.
 * Callers must persist the key only after a `valid` result; a transient result
 * means the provider (or, in hosted mode, its bounded relay) could not verify
 * admission.
 */
export async function validateModelKey(
  providerId: ModelKeyProviderId,
  key: string,
  options: { timeoutMs?: number } = {},
): Promise<ModelKeyValidationResult> {
  const probe = MODEL_KEY_PROBES[providerId];
  const timeoutMs =
    Number.isSafeInteger(options.timeoutMs) && Number(options.timeoutMs) > 0
      ? Number(options.timeoutMs)
      : VALIDATION_TIMEOUT_MS;
  try {
    const response = await fetch(resolveProbeUrl(probe.url), {
      method: "GET",
      headers: probe.headers(key),
      signal: AbortSignal.timeout(timeoutMs),
      // Probes carry the typed key in headers that survive cross-origin
      // redirects (x-goog-api-key, x-api-key); provider probe endpoints do
      // not redirect, so any redirect is treated as a transient failure
      // rather than followed.
      redirect: "error",
    });
    if (response.status === 401 || response.status === 403) {
      return { status: "invalid", providerLabel: probe.label };
    }
    if (!response.ok) {
      // Google reports bad keys as 400 INVALID_ARGUMENT / API_KEY_INVALID
      // rather than 401.
      if (response.status === 400) {
        const body = await response.text().catch(() => "");
        if (/API_KEY_INVALID|API key not valid/i.test(body)) {
          return { status: "invalid", providerLabel: probe.label };
        }
      }
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

function resolveProbeUrl(probeUrl: string): string {
  const override = process.env[MODEL_KEY_PROBE_BASE_URL_ENV]?.trim();
  if (!override) return probeUrl;

  // Test-support hook only. Overrides are limited to loopback hosts because
  // the probe request carries the typed API key in its headers; honoring an
  // arbitrary origin (for example from a poisoned .env) would forward that
  // key to a foreign host.
  let baseUrl: URL;
  try {
    baseUrl = new URL(override);
  } catch {
    return probeUrl;
  }
  if (!isLoopbackHostname(baseUrl.hostname)) return probeUrl;

  const url = new URL(probeUrl);
  url.protocol = baseUrl.protocol;
  url.host = baseUrl.host;
  return url.toString();
}

function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" || host === "::1" || host === "[::1]" || /^127(\.\d{1,3}){3}$/.test(host)
  );
}
