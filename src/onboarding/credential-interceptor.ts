// Pure decision function for handling `[OPENCANDLE_CREDENTIAL_REQUIRED ...]`
// tool results. This module has NO Pi dependencies so it can be tested in
// isolation — the Pi extension `tool_result` handler is a thin wrapper that
// calls this function, inspects the returned `InterceptAction`, and drives
// the appropriate side effects (promptUser, state mutation, tool rerun).
//
// Decision table — see design.md Decision 3 for the canonical version.

import type { ProviderId } from "./providers.js";
import { getProvider } from "./providers.js";
import type { OnboardingState } from "./state.js";
import type { CredentialRequiredReason } from "./tool-tags.js";

export interface InterceptInput {
  /** The provider id parsed from the tagged tool-result content. */
  provider: ProviderId;
  /** Why the credential was flagged as required. */
  reason: CredentialRequiredReason;
  /** Current persistent onboarding state (providers map, welcome flag). */
  state: OnboardingState;
  /** Providers already prompted at least once in this session (across workflows). */
  sessionPromptedSet: ReadonlySet<ProviderId>;
  /**
   * Whether a hard-tier provider has already fired a prompt earlier in the
   * current workflow invocation. When true, subsequent hard-provider prompts
   * in the same workflow SHALL be silenced per the "at most one prompt per
   * workflow" requirement in `conversational-provider-setup.spec.md`.
   */
  hardPromptFiredInWorkflow: boolean;
  /** Injected clock for deterministic snooze-expiry tests. */
  now: Date;
}

/** Outcome of the interception decision. */
export type InterceptAction =
  | {
      action: "prompt";
      provider: ProviderId;
      reason: CredentialRequiredReason;
    }
  | {
      action: "skip";
      provider: ProviderId;
      remediation: string;
      /** True when the skip is due to explicit never_ask — downstream gap-note
       *  synthesis should suppress the `/connect` remediation in that case. */
      silenced: boolean;
    };

function buildRemediation(providerId: ProviderId): string {
  const descriptor = getProvider(providerId);
  // Prefer the first alias as the friendly target; fall back to the id.
  const alias = descriptor.aliases[0] ?? providerId;
  return `run /connect ${alias} to unlock`;
}

function skip(providerId: ProviderId, silenced: boolean): InterceptAction {
  return {
    action: "skip",
    provider: providerId,
    remediation: buildRemediation(providerId),
    silenced,
  };
}

/**
 * Pure decision function — given an `InterceptInput`, return either a
 * `prompt` action (the extension handler should pause and call `promptUser`)
 * or a `skip` action (the handler should replace the tool result with a
 * `[OPENCANDLE_SKIPPED ...]` placeholder).
 *
 * No side effects. No Pi imports. Trivially unit-testable.
 */
export function resolveCredentialRequired(input: InterceptInput): InterceptAction {
  const { provider, reason, state, sessionPromptedSet, hardPromptFiredInWorkflow, now } = input;

  const descriptor = getProvider(provider);
  const entry = state.providers[provider];

  // 1. Never-ask: always skip, marked silenced so the gap-note copy drops the
  //    `/connect` remediation.
  if (entry?.status === "never_ask") {
    return skip(provider, true);
  }

  // 2. Completed + missing (defensive — shouldn't normally happen because the
  //    tool layer only emits `missing` when `hasCredential` returns false, and
  //    a completed state implies the credential was persisted).
  if (entry?.status === "completed" && reason === "missing") {
    return skip(provider, false);
  }

  // 3. Session-level dedup: a previous prompt this session already settled
  //    the user's answer for this provider. Don't re-ask until next session.
  if (sessionPromptedSet.has(provider)) {
    return skip(provider, false);
  }

  // 4. Per-workflow cap: at most one hard-provider prompt per workflow run.
  if (hardPromptFiredInWorkflow && descriptor.tier === "hard") {
    return skip(provider, false);
  }

  // 5. Active snooze: skip without decrementing the session set (the user
  //    will see the prompt again if they try a workflow after snoozeUntil).
  if (entry?.status === "snoozed") {
    const until = Date.parse(entry.snoozeUntil);
    if (!Number.isNaN(until) && now.getTime() < until) {
      return skip(provider, false);
    }
    // snoozed but expired → fall through to prompt.
  }

  // 6. Completed + stale: re-prompt. This is the ONE stale-credential path
  //    this change ships — the full failure-as-invitation story is deferred.
  if (entry?.status === "completed" && reason === "stale") {
    return { action: "prompt", provider, reason };
  }

  // 7. Default: prompt.
  return { action: "prompt", provider, reason };
}
