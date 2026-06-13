import { describe, expect, it } from "vitest";
import {
  type InterceptInput,
  resolveCredentialRequired,
} from "../../../src/onboarding/credential-interceptor.js";
import type { OnboardingState } from "../../../src/onboarding/state.js";

const NOW = new Date("2026-04-12T12:00:00.000Z");

function input(overrides: Partial<InterceptInput>): InterceptInput {
  return {
    provider: "alpha_vantage",
    reason: "missing",
    state: { version: 2, providers: {} },
    sessionPromptedSet: new Set(),
    hardPromptFiredInWorkflow: false,
    now: NOW,
    ...overrides,
  };
}

describe("resolveCredentialRequired — missing entry cases", () => {
  it("prompts when no state entry exists and nothing was prompted this session", () => {
    const result = resolveCredentialRequired(input({}));
    expect(result.action).toBe("prompt");
  });

  it("skips when no state entry but provider was already prompted this session", () => {
    const result = resolveCredentialRequired(
      input({ sessionPromptedSet: new Set(["alpha_vantage"]) }),
    );
    expect(result.action).toBe("skip");
  });
});

describe("resolveCredentialRequired — never_ask", () => {
  it("skips silently regardless of session or stale status", () => {
    const state: OnboardingState = {
      version: 2,
      providers: {
        alpha_vantage: { status: "never_ask", lastPromptAt: "2026-04-01T00:00:00.000Z" },
      },
    };
    expect(resolveCredentialRequired(input({ state })).action).toBe("skip");
    expect(resolveCredentialRequired(input({ state, reason: "stale" })).action).toBe("skip");
  });

  it("the skipped placeholder carries silenced=true for never_ask", () => {
    const state: OnboardingState = {
      version: 2,
      providers: {
        alpha_vantage: { status: "never_ask", lastPromptAt: "2026-04-01T00:00:00.000Z" },
      },
    };
    const result = resolveCredentialRequired(input({ state }));
    expect(result.action).toBe("skip");
    if (result.action === "skip") {
      expect(result.silenced).toBe(true);
    }
  });
});

describe("resolveCredentialRequired — snoozed", () => {
  it("skips when snooze is still active", () => {
    const state: OnboardingState = {
      version: 2,
      providers: {
        alpha_vantage: {
          status: "snoozed",
          lastPromptAt: "2026-04-10T00:00:00.000Z",
          snoozeUntil: "2026-04-17T00:00:00.000Z",
        },
      },
    };
    expect(resolveCredentialRequired(input({ state })).action).toBe("skip");
  });

  it("prompts when snooze has expired and not yet prompted this session", () => {
    const state: OnboardingState = {
      version: 2,
      providers: {
        alpha_vantage: {
          status: "snoozed",
          lastPromptAt: "2026-04-01T00:00:00.000Z",
          snoozeUntil: "2026-04-08T00:00:00.000Z",
        },
      },
    };
    expect(resolveCredentialRequired(input({ state })).action).toBe("prompt");
  });

  it("still skips when snooze expired but already prompted this session", () => {
    const state: OnboardingState = {
      version: 2,
      providers: {
        alpha_vantage: {
          status: "snoozed",
          lastPromptAt: "2026-04-01T00:00:00.000Z",
          snoozeUntil: "2026-04-08T00:00:00.000Z",
        },
      },
    };
    expect(
      resolveCredentialRequired(input({ state, sessionPromptedSet: new Set(["alpha_vantage"]) }))
        .action,
    ).toBe("skip");
  });
});

describe("resolveCredentialRequired — completed + stale", () => {
  it("prompts when completed but reason is stale", () => {
    const state: OnboardingState = {
      version: 2,
      providers: {
        alpha_vantage: { status: "completed", lastPromptAt: "2026-04-01T00:00:00.000Z" },
      },
    };
    expect(resolveCredentialRequired(input({ state, reason: "stale" })).action).toBe("prompt");
  });

  it("skips when completed and reason is missing (defensive — shouldn't happen normally)", () => {
    const state: OnboardingState = {
      version: 2,
      providers: {
        alpha_vantage: { status: "completed", lastPromptAt: "2026-04-01T00:00:00.000Z" },
      },
    };
    expect(resolveCredentialRequired(input({ state, reason: "missing" })).action).toBe("skip");
  });
});

describe("resolveCredentialRequired — per-workflow cap", () => {
  it("skips when another hard provider has already prompted in this workflow", () => {
    const result = resolveCredentialRequired(
      input({
        provider: "fred",
        hardPromptFiredInWorkflow: true,
      }),
    );
    expect(result.action).toBe("skip");
  });

  it("allows the first hard prompt in a workflow to proceed", () => {
    const result = resolveCredentialRequired(
      input({
        provider: "fred",
        hardPromptFiredInWorkflow: false,
      }),
    );
    expect(result.action).toBe("prompt");
  });
});

describe("resolveCredentialRequired — skip placeholder metadata", () => {
  it("includes provider id and remediation in the skip action", () => {
    const result = resolveCredentialRequired(
      input({ sessionPromptedSet: new Set(["alpha_vantage"]) }),
    );
    expect(result.action).toBe("skip");
    if (result.action === "skip") {
      expect(result.provider).toBe("alpha_vantage");
      expect(result.remediation).toContain("/connect");
    }
  });
});
