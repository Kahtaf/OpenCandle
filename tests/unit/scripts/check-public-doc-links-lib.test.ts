import { describe, expect, it, vi } from "vitest";
import {
  checkUrlWithRetry,
  classifyLinkOutcome,
  isAcceptedStatus,
} from "../../../scripts/check-public-doc-links-lib.mjs";

describe("classifyLinkOutcome", () => {
  it("treats 2xx/3xx and accepted auth/rate-limit statuses as ok", () => {
    expect(classifyLinkOutcome({ status: 200 })).toBe("ok");
    expect(classifyLinkOutcome({ status: 301 })).toBe("ok");
    expect(classifyLinkOutcome({ status: 403 })).toBe("ok");
    expect(classifyLinkOutcome({ status: 429 })).toBe("ok");
  });

  it("treats real HTTP error statuses as broken", () => {
    expect(classifyLinkOutcome({ status: 404 })).toBe("broken");
    expect(classifyLinkOutcome({ status: 500 })).toBe("broken");
  });

  it("treats thrown network errors as unverified, not broken", () => {
    expect(classifyLinkOutcome({ error: new Error("fetch failed") })).toBe("unverified");
    expect(classifyLinkOutcome({})).toBe("unverified");
  });
});

describe("isAcceptedStatus", () => {
  it("accepts statuses that prove a protected or method-specific endpoint exists", () => {
    expect(isAcceptedStatus(401)).toBe(true);
    expect(isAcceptedStatus(403)).toBe(true);
    expect(isAcceptedStatus(405)).toBe(true);
    expect(isAcceptedStatus(429)).toBe(true);
    expect(isAcceptedStatus(404)).toBe(false);
  });
});

describe("checkUrlWithRetry", () => {
  it("returns ok on a HEAD 200 without retrying", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ status: 200 });
    const result = await checkUrlWithRetry({ url: "https://x.test", fetchImpl });
    expect(result.outcome).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith("https://x.test", "HEAD");
  });

  it("falls back to GET when HEAD is rejected with 405", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ status: 405 })
      .mockResolvedValueOnce({ status: 200 });
    const result = await checkUrlWithRetry({ url: "https://x.test", fetchImpl });
    expect(result.outcome).toBe("ok");
    expect(fetchImpl).toHaveBeenNthCalledWith(2, "https://x.test", "GET");
  });

  it("accepts a POST-only endpoint when both HEAD and GET return 405", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ status: 405 });
    const result = await checkUrlWithRetry({ url: "https://x.test/post-only", fetchImpl });
    expect(result).toEqual({ outcome: "ok", detail: "HTTP 405", status: 405 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("returns broken on a definitive 404 without retrying", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ status: 404 });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const result = await checkUrlWithRetry({ url: "https://x.test", fetchImpl, sleep });
    expect(result.outcome).toBe("broken");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries transient network errors and gives up as unverified", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("fetch failed"));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const result = await checkUrlWithRetry({
      url: "https://polymarket.com",
      fetchImpl,
      attempts: 3,
      sleep,
    });
    expect(result.outcome).toBe("unverified");
    expect(result.detail).toContain("fetch failed");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("recovers when a retry succeeds after a transient error", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValueOnce({ status: 200 });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const result = await checkUrlWithRetry({ url: "https://x.test", fetchImpl, sleep });
    expect(result.outcome).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });
});
