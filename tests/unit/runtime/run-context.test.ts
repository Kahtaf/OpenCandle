import { afterEach, describe, expect, it } from "vitest";
import { ProviderTracker } from "../../../src/runtime/provider-tracker.js";
import {
  clearRunContext,
  getProviderTracker,
  setRunContext,
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

  it("does not let an older owner clear a newer context", () => {
    const tracker1 = new ProviderTracker();
    const tracker2 = new ProviderTracker();
    const owner1 = setRunContext({ providerTracker: tracker1 });
    setRunContext({ providerTracker: tracker2 });

    clearRunContext(owner1);

    expect(getProviderTracker()).toBe(tracker2);
  });
});
