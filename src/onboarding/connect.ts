// Shared `runProviderConnect` function — the actual side-effectful flow that
// opens a browser, collects a pasted API key, validates it against the
// provider's API, persists it to `~/.opencandle/config.json`, and refreshes
// the cached Config so the next tool call sees the new credential.
//
// Called from two places:
//   1. The Pi `tool_result` extension handler when the user picks "Connect now"
//      in the just-in-time prompt (Task Group 10).
//   2. The `/connect` Pi command (Task Group 13).
//
// Validation (Task Group 8 final pass): before persisting, the pasted key is
// validated via `validateCredential`, which makes a single cheap request to
// the provider's canonical API and classifies the response. A hard
// auth failure (401/403 or a provider-specific error-in-200-body) is
// returned as `invalid_key` WITHOUT persisting the bad value. A transient
// failure (timeout, 5xx, network error) also fails closed: credentials are
// persisted only after the provider positively verifies them.

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  loadConfig,
  loadFileConfig,
  type OpenCandleFileConfig,
  saveFileConfig,
} from "../config.js";
import { openInBrowser } from "../infra/open-url.js";
import {
  type ApiKeyProviderId,
  getCredentialSource,
  getProvider,
  isApiKeyProvider,
  type ProviderId,
} from "./providers.js";
import { loadOnboardingState, markProviderCompleted, saveOnboardingState } from "./state.js";
import { validateCredential } from "./validation.js";

export type ConnectResult =
  | { status: "connected" }
  | { status: "cancelled" }
  | { status: "blocked_by_env" }
  | { status: "verification_failed"; reason: string }
  | { status: "invalid_key"; httpStatus?: number; message?: string };

function writeNested(
  obj: Record<string, unknown>,
  path: readonly string[],
  value: string,
): Record<string, unknown> {
  if (path.length === 0) return obj;
  const [head, ...rest] = path;
  const next = { ...obj };
  if (rest.length === 0) {
    next[head] = value;
  } else {
    const child =
      next[head] && typeof next[head] === "object" ? (next[head] as Record<string, unknown>) : {};
    next[head] = writeNested(child, rest, value);
  }
  return next;
}

/**
 * Persist an already-validated provider credential.
 *
 * Writes the key into `~/.opencandle/config.json` (preserving sibling fields),
 * refreshes the cached `Config` so the next tool call sees the new value, and
 * marks the provider as completed in the onboarding state.
 *
 * Shared by the TUI `/connect` flow (`runProviderConnect`) and the GUI
 * provider-setup form. Validation is the caller's responsibility — both
 * call sites run `validateCredential` before invoking this helper.
 */
export function persistProviderCredential(providerId: ApiKeyProviderId, key: string): void {
  const descriptor = getProvider(providerId);
  if (!isApiKeyProvider(descriptor)) {
    throw new Error(`Provider ${providerId} does not accept API keys`);
  }
  const existing = loadFileConfig() as unknown as Record<string, unknown>;
  const updated = writeNested(existing, descriptor.configPath, key) as OpenCandleFileConfig;
  saveFileConfig(updated);
  loadConfig();
  const state = loadOnboardingState();
  saveOnboardingState(markProviderCompleted(state, providerId));
}

/**
 * Run the connect flow for a single provider.
 *
 * Env-precedence short-circuit: if the provider's configured credential
 * already comes from an environment variable, the file-config write would
 * be invisible to the next tool call (env vars win in `resolveConfig`).
 * Notify the user explicitly and return `blocked_by_env` — do not open
 * the browser or collect a pasted value.
 */
export async function runProviderConnect(
  ctx: ExtensionContext,
  providerId: ProviderId,
): Promise<ConnectResult> {
  const descriptor = getProvider(providerId);
  if (!isApiKeyProvider(descriptor)) {
    ctx.ui.notify(
      `${descriptor.displayName} is not configured with an API key. Run opencandle doctor for setup status.`,
      "warning",
    );
    return { status: "cancelled" };
  }

  // Env-precedence check.
  if (getCredentialSource(providerId) === "env") {
    ctx.ui.notify(
      `${descriptor.displayName} is currently set via the ${descriptor.envVar} environment variable. ` +
        `To change it from here, unset that variable first and reopen /connect ${descriptor.aliases[0] ?? descriptor.id}. ` +
        `Otherwise, update ${descriptor.envVar} directly in your shell profile.`,
      "warning",
    );
    return { status: "blocked_by_env" };
  }

  // Open the signup URL in the user's browser. We ignore errors here — if
  // the browser can't be opened, the user can still paste a key they
  // already have, so we continue rather than bailing.
  await openInBrowser(descriptor.signupUrl).catch(() => {});
  ctx.ui.notify(`Opening ${descriptor.displayName} signup in your browser...`, "info");

  // Prompt for the key. Uses the provider's instructionsHint as the
  // placeholder text to remind the user what they're pasting.
  const pasted = await ctx.ui.input(
    `Paste your ${descriptor.displayName} API key`,
    descriptor.instructionsHint,
  );
  if (!pasted) {
    return { status: "cancelled" };
  }
  const trimmed = pasted.trim();
  if (trimmed.length === 0) {
    return { status: "cancelled" };
  }

  // Validate the key with the provider BEFORE persisting. Only a positive
  // provider response may modify the stored credential.
  ctx.ui.notify(`Verifying your ${descriptor.displayName} key...`, "info");
  const validation = await validateCredential(descriptor.id, trimmed);

  if (validation.status === "invalid") {
    const statusHint =
      validation.httpStatus !== undefined ? ` (HTTP ${validation.httpStatus})` : "";
    const messageHint = validation.message ? ` — ${validation.message}` : "";
    ctx.ui.notify(
      `${descriptor.displayName} rejected the key${statusHint}${messageHint}. ` +
        `Your existing configuration was not changed. Re-run /connect ${
          descriptor.aliases[0] ?? descriptor.id
        } to try a different key.`,
      "error",
    );
    return {
      status: "invalid_key",
      httpStatus: validation.httpStatus,
      message: validation.message,
    };
  }

  if (validation.status === "transient") {
    ctx.ui.notify(
      `Couldn't reach ${descriptor.displayName} to verify the key (${validation.reason}). ` +
        `The key was not saved. Try again when the provider is reachable.`,
      "error",
    );
    return { status: "verification_failed", reason: validation.reason };
  }

  persistProviderCredential(descriptor.id, trimmed);

  ctx.ui.notify(`${descriptor.displayName} connected. Your key has been saved.`, "info");

  return { status: "connected" };
}
