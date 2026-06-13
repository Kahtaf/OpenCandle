// Tool-boundary helpers for credentialed providers.
//
// `withCredentialCheck` is the single-entry helper that OpenCandle tools use
// to wrap their provider calls. It centralizes:
//   1. The upfront "credential missing" check via the registry.
//   2. The catch-and-convert logic for `ProviderCredentialError` thrown from
//      providers on 401/403 (stale credential after HTTP call).
//   3. The tagged `[OPENCANDLE_CREDENTIAL_REQUIRED ...]` content emission that
//      the Pi `tool_result` extension hook intercepts.
//
// Non-credential errors (network timeouts, parse errors, etc.) are re-thrown
// unchanged so existing error handling in `wrapProvider` continues to work.

import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { ProviderCredentialError } from "../providers/provider-credential-error.js";
import { getProvider, hasCredential, type ProviderId } from "./providers.js";
import { buildCredentialRequiredTag, type CredentialRequiredReason } from "./tool-tags.js";

// Metadata carried on `details` for UI / test assertion. This is NOT the
// LLM-facing contract — that lives in `content` as the tagged line. Pi
// provider adapters serialize `content`, not `details`, into the model's
// conversation.
export interface CredentialRequiredDetails {
  credentialRequired: {
    provider: ProviderId;
    reason: CredentialRequiredReason;
    httpStatus?: number;
  };
}

function buildCredentialRequiredResult(
  provider: ProviderId,
  reason: CredentialRequiredReason,
  httpStatus?: number,
): AgentToolResult<CredentialRequiredDetails> {
  const descriptor = getProvider(provider);
  const tag = buildCredentialRequiredTag({
    provider,
    reason,
    unlocks: descriptor.unlocks,
    fallback: descriptor.fallbackDescription,
    httpStatus,
  });
  // The second line is natural language describing what's missing. Users won't
  // see it directly — the model sees it and uses the information to synthesize
  // a gap note in its final answer. The tagged first line is the machine-
  // readable signal the `tool_result` interception handler keys off of.
  const narrative =
    reason === "missing"
      ? `${descriptor.displayName} was not fetched for this request because no API key is configured. It unlocks ${descriptor.unlocks.join(", ")}.`
      : `${descriptor.displayName} rejected the configured API key (HTTP ${httpStatus ?? "auth error"}). It may be expired or revoked.`;

  return {
    content: [{ type: "text", text: `${tag}\n\n${narrative}` }],
    details: {
      credentialRequired: {
        provider,
        reason,
        ...(httpStatus !== undefined ? { httpStatus } : {}),
      },
    },
  };
}

/**
 * Wrap a tool's provider-calling logic with a credential-check layer.
 *
 * Usage:
 * ```
 * async execute(_, args) {
 *   return withCredentialCheck("alpha_vantage", async () => {
 *     const apiKey = getConfig().alphaVantageApiKey!;
 *     const result = await wrapProvider("alphavantage", () => getFinancials(args.symbol, apiKey));
 *     // ... format success result ...
 *     return { content: [...], details: [...] };
 *   });
 * }
 * ```
 *
 * On missing credential (upfront): `fn` is NOT called. A tagged tool result
 * is returned directly.
 *
 * On `ProviderCredentialError` thrown during `fn`: the error is caught and a
 * tagged tool result is returned.
 *
 * Any other thrown value (plain Error, string, etc.) is re-thrown unchanged.
 */
export async function withCredentialCheck<T>(
  providerId: ProviderId,
  fn: () => Promise<AgentToolResult<T>>,
): Promise<AgentToolResult<T> | AgentToolResult<CredentialRequiredDetails>> {
  if (!hasCredential(providerId)) {
    return buildCredentialRequiredResult(providerId, "missing");
  }

  try {
    return await fn();
  } catch (error) {
    if (error instanceof ProviderCredentialError) {
      return buildCredentialRequiredResult(error.provider, error.reason, error.httpStatus);
    }
    throw error;
  }
}
