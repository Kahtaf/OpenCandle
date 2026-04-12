// Typed error thrown by providers when they detect a missing or stale credential.
//
// Providers remain pure fetchers that throw on failure — this class is the
// structured hand-off to the tool layer, where `withCredentialCheck` catches
// the error and emits a tagged tool-result content string.
//
// Keep this module dependency-free (aside from the ProviderId type) so it can
// be imported from anywhere without pulling in config loading or registry
// side effects.

import type { ProviderId } from "../onboarding/providers.js";

export class ProviderCredentialError extends Error {
  readonly name = "ProviderCredentialError";

  constructor(
    readonly provider: ProviderId,
    readonly reason: "missing" | "stale",
    readonly httpStatus?: number,
  ) {
    super(`credential_required:${provider}:${reason}`);
  }
}
