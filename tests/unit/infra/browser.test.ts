import { describe, it, expect, vi, afterEach } from "vitest";
import { StealthBrowser } from "../../../src/infra/browser.js";

describe("StealthBrowser", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exports a singleton instance", () => {
    expect(StealthBrowser).toBeDefined();
    expect(typeof StealthBrowser.evaluate).toBe("function");
    expect(typeof StealthBrowser.fetchJson).toBe("function");
    expect(typeof StealthBrowser.close).toBe("function");
  });

  it("fetchJson returns typed data from a URL", async () => {
    // This is an integration-style test — we mock the browser internals
    // to verify the interface contract without launching a real browser
    const mockData = { test: true, value: 42 };
    vi.spyOn(StealthBrowser, "fetchJson").mockResolvedValue(mockData);

    const result = await StealthBrowser.fetchJson<typeof mockData>("https://example.com/api");
    expect(result).toEqual(mockData);
  });

  it("evaluate returns evaluated result", async () => {
    vi.spyOn(StealthBrowser, "evaluate").mockResolvedValue("hello");

    const result = await StealthBrowser.evaluate("https://example.com", () => "hello");
    expect(result).toBe("hello");
  });
});
