import { describe, expect, it } from "vitest";
import { getCacheWarmingDelayMs } from "../../../gui/hosted/runtime/pi-ai-browser.js";

describe("hosted Pi cache-warming compatibility", () => {
  it("exposes Pi's refresh policy with a safety margin before cache expiry", () => {
    expect(getCacheWarmingDelayMs(300_000)).toBe(270_000);
    expect(getCacheWarmingDelayMs(10_000)).toBeUndefined();
  });
});
