import { describe, expect, it } from "vitest";
import {
  clearStoredRuntimeRecord,
  getModelSelection,
  parseStorageRecord,
  toSafeStoredMetadata,
  STORAGE_KEY,
  updateStoredDiagnostic,
  updateStoredSelection,
} from "../src/runtime-contract.js";

describe("browser runtime storage contract", () => {
  it("parses the spike's versioned storage record", () => {
    const record = parseStorageRecord(
      JSON.stringify({
        version: 1,
        provider: "google",
        modelId: "gemini-2.5-flash",
        modelKey: "sentinel-secret",
        lastQuestion: "Will rates fall?",
        lastResult: { evidenceCount: 2 },
      }),
    );

    expect(STORAGE_KEY).toBe("opencandle.browser-runtime-spike.v1");
    expect(record).toEqual({
      version: 1,
      provider: "google",
      modelId: "gemini-2.5-flash",
      modelKey: "sentinel-secret",
      lastQuestion: "Will rates fall?",
      lastResult: { evidenceCount: 2 },
    });
  });

  it("maps each allowlisted provider to its model and environment variable", () => {
    expect(getModelSelection("google")).toEqual({
      provider: "google",
      modelId: "gemini-2.5-flash",
      envVar: "GEMINI_API_KEY",
    });
    expect(getModelSelection("openai")).toEqual({
      provider: "openai",
      modelId: "gpt-5-mini",
      envVar: "OPENAI_API_KEY",
    });
    expect(getModelSelection("anthropic")).toEqual({
      provider: "anthropic",
      modelId: "claude-haiku-4-5",
      envVar: "ANTHROPIC_API_KEY",
    });
  });

  it("creates restored metadata without copying the raw key into view state", () => {
    const safe = toSafeStoredMetadata({
      version: 1,
      provider: "openai",
      modelId: "gpt-5-mini",
      modelKey: "do-not-render-this",
      lastQuestion: "Compare the outlook",
      lastResult: { evidenceCount: 1 },
    });

    expect(safe).toEqual({
      configuredLabel: "Saved on this device",
      provider: "openai",
      modelId: "gpt-5-mini",
      lastQuestion: "Compare the outlook",
      lastResult: { evidenceCount: 1 },
    });
    expect(JSON.stringify(safe)).not.toContain("do-not-render-this");
  });

  it("rejects malformed, stale-version, and mismatched model records", () => {
    expect(parseStorageRecord("{not-json")).toBeUndefined();
    expect(
      parseStorageRecord(
        JSON.stringify({
          version: 2,
          provider: "google",
          modelId: "gemini-2.5-flash",
          modelKey: "key",
        }),
      ),
    ).toBeUndefined();
    expect(
      parseStorageRecord(
        JSON.stringify({
          version: 1,
          provider: "google",
          modelId: "gpt-5-mini",
          modelKey: "key",
        }),
      ),
    ).toBeUndefined();
  });

  it("clears the spike record through the public storage action", () => {
    const removed: string[] = [];

    clearStoredRuntimeRecord({
      removeItem(key) {
        removed.push(key);
      },
    });

    expect(removed).toEqual([STORAGE_KEY]);
  });

  it("updates diagnostic state without modifying a saved credential", () => {
    const updated = updateStoredDiagnostic(
      {
        version: 1,
        provider: "openai",
        modelId: "gpt-5-mini",
        modelKey: "keep-this-secret",
      },
      "Will rates fall?",
      { evidenceCount: 2 },
    );

    expect(updated).toEqual({
      version: 1,
      provider: "openai",
      modelId: "gpt-5-mini",
      modelKey: "keep-this-secret",
      lastQuestion: "Will rates fall?",
      lastResult: { evidenceCount: 2 },
    });
  });

  it("persists a changed model choice without replacing the saved credential", () => {
    const updated = updateStoredSelection(
      {
        version: 1,
        provider: "openai",
        modelId: "gpt-5-mini",
        modelKey: "keep-this-secret",
        credentialProvider: "openai",
      },
      "anthropic",
    );

    expect(updated).toEqual({
      version: 1,
      provider: "anthropic",
      modelId: "claude-haiku-4-5",
      modelKey: "keep-this-secret",
      credentialProvider: "openai",
    });
  });
});
