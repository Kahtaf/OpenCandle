// Pre-persist credential validation for OpenCandle data providers.
//
// Each `validateCredential` call makes a single cheap request to the
// provider's canonical API with the pasted key and classifies the response
// into one of three states:
//
//   - `valid`      — provider accepted the credential (persist it)
//   - `invalid`    — provider rejected the credential (do NOT persist;
//                    re-prompt or return a classified failure)
//   - `transient`  — network/timeout/server error (do NOT persist; the user
//                    can retry once the provider is reachable)
//
// The endpoint chosen for each provider is the cheapest one available that
// also exercises the auth header/query param — we don't pay for meaningful
// data, just "did the server like the key". Alpha Vantage is a special case:
// it returns HTTP 200 even for bad keys, with an `Error Message` or
// `Information` field in the JSON body, so the body must be inspected.
//
// All validators share a 5-second timeout via `AbortSignal.timeout` so the
// connect flow cannot hang if a provider is unreachable.

import type { ApiKeyProviderId } from "./providers.js";

const VALIDATION_TIMEOUT_MS = 5_000;

export type ValidationResult =
  | { status: "valid" }
  | { status: "invalid"; httpStatus?: number; message?: string }
  | { status: "transient"; reason: string };

type BodyClassifier = (body: string) => ValidationResult | undefined;

async function validateWithFetch(
  url: string,
  init: RequestInit,
  classifyBody?: BodyClassifier,
): Promise<ValidationResult> {
  try {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(VALIDATION_TIMEOUT_MS),
    });

    // Hard auth failures — the key is definitively bad.
    if (response.status === 401 || response.status === 403) {
      return { status: "invalid", httpStatus: response.status };
    }

    // FRED returns 400 with an `error_message` for bad keys.
    if (response.status === 400) {
      return { status: "invalid", httpStatus: 400 };
    }

    // 5xx and other non-2xx — treat as transient. The caller keeps the prior
    // credential unchanged and asks the user to retry after the outage.
    if (!response.ok) {
      return { status: "transient", reason: `HTTP ${response.status}` };
    }

    // Body-level classification for providers that return 200 with an error
    // shape (Alpha Vantage).
    if (classifyBody) {
      const body = await response.text();
      const classified = classifyBody(body);
      if (classified) return classified;
    }

    return { status: "valid" };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { status: "transient", reason };
  }
}

/**
 * Alpha Vantage returns HTTP 200 with an error shape in the JSON body when
 * the key is bad. Two fields to watch for:
 *   - `Error Message`: indicates a malformed query OR an invalid key
 *   - `Information`: used for rate-limit messages AND for "Invalid API key"
 *
 * The rate-limit form of `Information` is NOT an invalid-key signal, so we
 * only match when the string mentions "invalid api".
 */
function classifyAlphaVantageBody(body: string): ValidationResult | undefined {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const errorMessage = parsed["Error Message"];
    if (typeof errorMessage === "string" && errorMessage.length > 0) {
      return { status: "invalid", message: errorMessage };
    }
    const information = parsed.Information;
    if (typeof information === "string" && /invalid api/i.test(information)) {
      return { status: "invalid", message: information };
    }
  } catch {
    // Non-JSON body — fall through and trust the HTTP status.
  }
  return undefined;
}

/**
 * Validate a pasted credential against the provider's API. Returns a
 * ValidationResult describing whether the key should be persisted.
 *
 * This function is side-effect-free beyond the network call: it does not
 * touch the config file, onboarding state, or any in-memory cache.
 */
export async function validateCredential(
  providerId: ApiKeyProviderId,
  key: string,
): Promise<ValidationResult> {
  switch (providerId) {
    case "alpha_vantage":
      return validateWithFetch(
        `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=IBM&apikey=${encodeURIComponent(key)}`,
        { method: "GET" },
        classifyAlphaVantageBody,
      );

    case "fred":
      return validateWithFetch(
        `https://api.stlouisfed.org/fred/series?series_id=GDP&api_key=${encodeURIComponent(key)}&file_type=json`,
        { method: "GET" },
      );

    case "finnhub":
      return validateWithFetch(
        `https://finnhub.io/api/v1/quote?symbol=AAPL&token=${encodeURIComponent(key)}`,
        { method: "GET" },
      );

    case "brave":
      return validateWithFetch("https://api.search.brave.com/res/v1/web/search?q=test&count=1", {
        method: "GET",
        headers: {
          "X-Subscription-Token": key,
          Accept: "application/json",
        },
      });

    case "exa":
      return validateWithFetch("https://api.exa.ai/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
        },
        body: JSON.stringify({ query: "test", numResults: 1 }),
      });

    case "lse":
      return validateWithFetch(
        "https://api.londonstrategicedge.com/vault/candles?symbol=AAPL&timeframe=1d&limit=1",
        {
          method: "GET",
          headers: {
            "x-api-key": key,
            Accept: "application/json",
          },
        },
      );
  }
}
