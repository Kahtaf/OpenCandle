import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as configModule from "../../../src/config.js";
import { withCredentialCheck } from "../../../src/onboarding/tool-helpers.js";
import { parseToolTag } from "../../../src/onboarding/tool-tags.js";
import { ProviderCredentialError } from "../../../src/providers/provider-credential-error.js";

const EMPTY_CONFIG = {
  alphaVantageApiKey: undefined,
  fredApiKey: undefined,
  braveApiKey: undefined,
  exaApiKey: undefined,
  finnhubApiKey: undefined,
  sentiment: undefined,
};

function mockConfig(overrides: Partial<typeof EMPTY_CONFIG> = {}) {
  vi.mocked(configModule.getConfig).mockReturnValue({
    ...EMPTY_CONFIG,
    ...overrides,
  } as any);
}

beforeEach(() => {
  vi.spyOn(configModule, "getConfig").mockReturnValue(EMPTY_CONFIG as any);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("withCredentialCheck — upfront missing check", () => {
  it("returns a tagged tool result when credential is missing (no call to fn)", async () => {
    const fn = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "should not be called" }],
      details: {},
    });

    const result = await withCredentialCheck("alpha_vantage", fn);

    expect(fn).not.toHaveBeenCalled();
    expect(result.content).toBeDefined();
    const text = (result.content[0] as { text: string }).text;
    const parsed = parseToolTag(text);
    expect(parsed?.kind).toBe("credential_required");
    if (parsed?.kind === "credential_required") {
      expect(parsed.provider).toBe("alpha_vantage");
      expect(parsed.reason).toBe("missing");
    }
  });

  it("passes through the fn result when the credential is present", async () => {
    mockConfig({ finnhubApiKey: "test-key" });
    const fn = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "success" }],
      details: { success: true },
    });

    const result = await withCredentialCheck("finnhub", fn);

    expect(fn).toHaveBeenCalledTimes(1);
    expect((result.content[0] as { text: string }).text).toBe("success");
    expect((result.details as { success: boolean }).success).toBe(true);
  });
});

describe("withCredentialCheck — catches ProviderCredentialError from fn", () => {
  it("catches missing-reason error thrown by fn and emits tagged content", async () => {
    mockConfig({ fredApiKey: "stale-key" }); // upfront check passes
    const fn = vi.fn().mockRejectedValue(new ProviderCredentialError("fred", "missing"));

    const result = await withCredentialCheck("fred", fn);

    const parsed = parseToolTag((result.content[0] as { text: string }).text);
    expect(parsed?.kind).toBe("credential_required");
    if (parsed?.kind === "credential_required") {
      expect(parsed.provider).toBe("fred");
      expect(parsed.reason).toBe("missing");
    }
  });

  it("catches stale-reason error and preserves httpStatus in the tag", async () => {
    mockConfig({ finnhubApiKey: "stale-key" });
    const fn = vi.fn().mockRejectedValue(new ProviderCredentialError("finnhub", "stale", 401));

    const result = await withCredentialCheck("finnhub", fn);

    const parsed = parseToolTag((result.content[0] as { text: string }).text);
    expect(parsed?.kind).toBe("credential_required");
    if (parsed?.kind === "credential_required") {
      expect(parsed.reason).toBe("stale");
      expect(parsed.httpStatus).toBe(401);
    }
  });

  it("stores structured metadata in details for UI/tests", async () => {
    const fn = vi.fn(); // won't be called
    const result = await withCredentialCheck("alpha_vantage", fn);

    const details = result.details as {
      credentialRequired: { provider: string; reason: string };
    };
    expect(details.credentialRequired).toBeDefined();
    expect(details.credentialRequired.provider).toBe("alpha_vantage");
    expect(details.credentialRequired.reason).toBe("missing");
  });
});

describe("withCredentialCheck — does NOT catch non-credential errors", () => {
  it("re-throws plain Error unchanged", async () => {
    mockConfig({ braveApiKey: "ok-key" });
    const fn = vi.fn().mockRejectedValue(new Error("network timeout"));

    await expect(withCredentialCheck("brave", fn)).rejects.toThrow("network timeout");
  });

  it("re-throws thrown strings unchanged", async () => {
    mockConfig({ exaApiKey: "ok-key" });
    const fn = vi.fn().mockRejectedValue("oh no");

    await expect(withCredentialCheck("exa", fn)).rejects.toBe("oh no");
  });
});
