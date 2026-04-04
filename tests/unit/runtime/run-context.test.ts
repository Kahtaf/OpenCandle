import { describe, it, expect, afterEach } from "vitest";
import { ProviderTracker } from "../../../src/runtime/provider-tracker.js";
import {
  setRunContext,
  clearRunContext,
  getProviderTracker,
} from "../../../src/runtime/run-context.js";

afterEach(() => {
  clearRunContext();
});

describe("run-context", () => {
  it("returns undefined when no context is active", () => {
    expect(getProviderTracker()).toBeUndefined();
  });

  it("returns the tracker after setRunContext", () => {
    const tracker = new ProviderTracker();
    setRunContext({ providerTracker: tracker });
    expect(getProviderTracker()).toBe(tracker);
  });

  it("returns undefined after clearRunContext", () => {
    const tracker = new ProviderTracker();
    setRunContext({ providerTracker: tracker });
    clearRunContext();
    expect(getProviderTracker()).toBeUndefined();
  });

  it("replaces previous context on new setRunContext", () => {
    const tracker1 = new ProviderTracker();
    const tracker2 = new ProviderTracker();
    setRunContext({ providerTracker: tracker1 });
    setRunContext({ providerTracker: tracker2 });
    expect(getProviderTracker()).toBe(tracker2);
  });
});
