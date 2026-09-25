import { redactSensitiveOutput } from "../../src/onboarding/provider-status.js";

/**
 * A provider can name its own credential inside a natural-language message,
 * for example "We have detected your API key as <value> and our standard API
 * rate limit is 25 requests per day." The repo's `redactSensitiveOutput` only
 * catches `name=value` assignments, cookie headers, and credential paths, so
 * this bounded, case-insensitive phrase pass redacts just the token after
 * "API key as" and leaves the surrounding diagnostic readable.
 */
const API_KEY_AS_PHRASE =
  /\b(api[\s_-]?key\s+as\s+)([A-Za-z0-9_+=./-]+?)(?=[.,;:!?)\]}'"]?(?:\s|$))/gi;

/**
 * `name=value` / `name: value` assignments whose name marks a credential
 * (`api_key`, `client_secret`, `password`, ...). `redactSensitiveOutput` covers
 * session/token/cookie names only.
 */
const CREDENTIAL_ASSIGNMENT =
  /\b([a-z0-9_-]*(?:api[_-]?key|secret|passw(?:or)?d)[a-z0-9_-]*)(\s*[:=]\s*)[^;\s,)]+/gi;

/** Redact one diagnostic string and cap it at `maxChars`. */
export function redactDiagnosticString(value: string, maxChars: number): string {
  return redactSensitiveOutput(
    value
      .replace(API_KEY_AS_PHRASE, "$1[redacted]")
      .replace(CREDENTIAL_ASSIGNMENT, "$1$2[redacted]"),
  ).slice(0, maxChars);
}
