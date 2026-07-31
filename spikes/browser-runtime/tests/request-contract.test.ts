import { describe, expect, it } from "vitest";
import {
  createBridgeDocument,
  createBridgePolicy,
  parseProbeRequest,
  parseTrustedHostOrigin,
  serializeProbeError,
} from "../runtime/request-contract.js";

describe("runtime probe request contract", () => {
  it("fails closed unless the configured host is an exact HTTP(S) origin", () => {
    expect(parseTrustedHostOrigin("https://research.example")).toBe("https://research.example");
    expect(parseTrustedHostOrigin("http://127.0.0.1:4175")).toBe("http://127.0.0.1:4175");
    expect(() => parseTrustedHostOrigin(undefined)).toThrow(
      "OPENCANDLE_SPIKE_HOST_ORIGIN must be an exact HTTP(S) origin",
    );
    expect(() => parseTrustedHostOrigin("https://research.example/path")).toThrow(
      "OPENCANDLE_SPIKE_HOST_ORIGIN must be an exact HTTP(S) origin",
    );
    expect(() => parseTrustedHostOrigin("javascript:alert(1)")).toThrow(
      "OPENCANDLE_SPIKE_HOST_ORIGIN must be an exact HTTP(S) origin",
    );
  });

  it("builds a nonce-protected bridge that pins RPC to the configured host origin", () => {
    const origin = "https://research.example";
    const nonce = "test_nonce-123";
    const document = createBridgeDocument(origin, nonce);
    const policy = createBridgePolicy(origin, nonce);

    expect(policy).toBe(
      "default-src 'none'; script-src 'nonce-test_nonce-123'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors https://research.example",
    );
    expect(document).toContain(`nonce="${nonce}"`);
    expect(document).toContain(`event.origin !== trustedHostOrigin`);
    expect(document).toContain(`event.source !== parent`);
    expect(document).toContain(`parent.postMessage`);
    expect(document).toContain(`trustedHostOrigin`);
    expect(document).toContain(`operation !== "health" && operation !== "probe"`);
    expect(document).not.toContain('"*"');
    expect(document).not.toContain("unsafe-inline");
  });

  it("rejects blank questions", () => {
    expect(() =>
      parseProbeRequest(
        {
          question: "   ",
          provider: "google",
          modelId: "gemini-2.5-flash",
          runModel: false,
        },
        {},
      ),
    ).toThrow("Question must not be blank");
  });

  it("allowlists provider and model pairs", () => {
    expect(() =>
      parseProbeRequest(
        {
          question: "Will rates fall?",
          provider: "unknown",
          modelId: "arbitrary-model",
          runModel: false,
        },
        {},
      ),
    ).toThrow("Unsupported provider or model");
    expect(() =>
      parseProbeRequest(
        {
          question: "Will rates fall?",
          provider: "google",
          modelId: "gpt-5-mini",
          runModel: false,
        },
        {},
      ),
    ).toThrow("Unsupported provider or model");
  });

  it("allows a keyless provider-only request", () => {
    expect(
      parseProbeRequest(
        {
          question: "  Will rates fall?  ",
          provider: "google",
          modelId: "gemini-2.5-flash",
          runModel: false,
        },
        {},
      ),
    ).toEqual({
      question: "Will rates fall?",
      provider: "google",
      modelId: "gemini-2.5-flash",
      runModel: false,
    });
  });

  it("requires a nonblank selected-provider key for model requests", () => {
    const request = {
      question: "Will rates fall?",
      provider: "openai",
      modelId: "gpt-5-mini",
      runModel: true,
    };

    expect(() => parseProbeRequest(request, {})).toThrow(
      "Model probe requires a configured model key",
    );
    expect(() => parseProbeRequest(request, { OPENAI_API_KEY: "   " })).toThrow(
      "Model probe requires a configured model key",
    );
    expect(parseProbeRequest(request, { OPENAI_API_KEY: "sentinel-secret" })).toEqual(request);
  });

  it("redacts model keys from serialized errors", () => {
    const key = "sentinel-secret-value";
    const serialized = serializeProbeError(new Error(`Provider rejected ${key}`), [key]);

    expect(serialized).toEqual({ error: "Provider rejected [redacted]" });
    expect(JSON.stringify(serialized)).not.toContain(key);
  });

  it("rejects oversized questions before provider work", () => {
    expect(() =>
      parseProbeRequest(
        {
          question: "x".repeat(501),
          provider: "anthropic",
          modelId: "claude-haiku-4-5",
          runModel: false,
        },
        {},
      ),
    ).toThrow("Question must be 500 characters or fewer");
  });
});
