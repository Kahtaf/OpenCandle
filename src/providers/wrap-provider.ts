import { runWithStaleMetadata } from "../infra/cache.js";
import type { ProviderResult } from "../runtime/evidence.js";
import { getProviderTracker } from "../runtime/run-context.js";
import { InvalidSymbolError } from "./errors.js";
import { ExternalToolError, ExternalToolNotInstalled } from "./external-tool-error.js";
import { ProviderCredentialError } from "./provider-credential-error.js";

/**
 * Wrap a provider function call so that thrown exceptions are caught
 * and returned as a structured `ProviderResultUnavailable`.
 *
 * `ProviderCredentialError` is the one exception: it is re-thrown
 * unchanged so the tool layer can catch it and emit a tagged
 * `[OPENCANDLE_CREDENTIAL_REQUIRED ...]` tool-result content block
 * (see `src/onboarding/tool-tags.ts`). Swallowing credential errors
 * into `unavailable` would hide the just-in-time setup offer from
 * the `tool_result` interception handler.
 *
 * When a run context is active, checks circuit breaker state before
 * calling and records failures after.
 *
 * After a successful provider call, propagates stale cache metadata recorded
 * in the current provider call's async scope.
 */
export async function wrapProvider<T>(
  providerId: string,
  fn: () => Promise<T>,
): Promise<ProviderResult<T>> {
  const tracker = getProviderTracker();

  if (tracker?.isCircuitOpen(providerId)) {
    return {
      status: "unavailable",
      reason: "provider_circuit_open",
      provider: providerId,
    };
  }

  try {
    const { value: data, cache } = await runWithStaleMetadata(fn);
    const timestamp = cache ? new Date(cache.cachedAt).toISOString() : new Date().toISOString();
    return {
      status: "ok",
      data,
      timestamp,
      provider: providerId,
      cached: cache?.status === "cached" ? true : undefined,
      stale: cache?.status === "stale" ? true : undefined,
    };
  } catch (error) {
    // Credential errors are re-thrown so the tool-layer `withCredentialCheck`
    // helper can convert them into LLM-visible tagged content. Do NOT record
    // these as tracker failures — they are a user-config problem, not a
    // provider reliability problem.
    if (error instanceof ProviderCredentialError) {
      throw error;
    }
    if (isExternalToolSetupError(error)) {
      return {
        status: "unavailable",
        reason: error.message,
        provider: providerId,
      };
    }
    if (error instanceof InvalidSymbolError) {
      return {
        status: "unavailable",
        reason: error.message,
        provider: providerId,
      };
    }
    tracker?.recordFailure(providerId);
    const reason = error instanceof Error ? error.message : "unknown_error";
    return {
      status: "unavailable",
      reason,
      provider: providerId,
    };
  }
}

function isExternalToolSetupError(
  error: unknown,
): error is ExternalToolError | ExternalToolNotInstalled {
  if (error instanceof ExternalToolNotInstalled) return true;
  if (!(error instanceof ExternalToolError)) return false;

  const code = error.code?.toLowerCase() ?? "";
  const message = error.message.toLowerCase();
  return (
    code.includes("auth") ||
    code.includes("session") ||
    code.includes("unauthorized") ||
    code.includes("expired") ||
    message.includes("no twitter cookies") ||
    message.includes("no twitter session") ||
    message.includes("no reddit cookies") ||
    message.includes("session missing") ||
    message.includes("not authenticated") ||
    message.includes("no cookies") ||
    message.includes("rdt login") ||
    message.includes("401") ||
    message.includes("unauthorized") ||
    message.includes("expired")
  );
}
