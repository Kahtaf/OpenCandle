import { describe, expect, it } from "vitest";
import { ProviderCredentialError } from "../../../src/providers/provider-credential-error.js";

describe("ProviderCredentialError", () => {
  it("carries provider id and reason", () => {
    const err = new ProviderCredentialError("alpha_vantage", "missing");
    expect(err.provider).toBe("alpha_vantage");
    expect(err.reason).toBe("missing");
    expect(err.httpStatus).toBeUndefined();
  });

  it("accepts an optional httpStatus for stale-credential cases", () => {
    const err = new ProviderCredentialError("finnhub", "stale", 401);
    expect(err.reason).toBe("stale");
    expect(err.httpStatus).toBe(401);
  });

  it("is instanceof Error so it propagates through normal catch sites", () => {
    const err = new ProviderCredentialError("fred", "missing");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ProviderCredentialError);
  });

  it("has a distinctive message format", () => {
    const err = new ProviderCredentialError("exa", "stale", 403);
    expect(err.message).toBe("credential_required:exa:stale");
  });

  it("has a name that matches the class (for typeof-name style checks)", () => {
    const err = new ProviderCredentialError("brave", "missing");
    expect(err.name).toBe("ProviderCredentialError");
  });
});
