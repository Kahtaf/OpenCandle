import { describe, expect, it } from "vitest";
import { isLoopbackAddress, isTrustedPrivateApiRequest } from "../../../gui/server/private-api-access.js";

describe("private GUI API access", () => {
  it("allows loopback callers", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("127.12.0.5")).toBe(true);
    expect(isLoopbackAddress("::1")).toBe(true);
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
  });

  it("rejects LAN and Tailscale-style remote callers", () => {
    expect(isLoopbackAddress("192.168.1.10")).toBe(false);
    expect(isLoopbackAddress("100.64.0.8")).toBe(false);
    expect(isLoopbackAddress("fd7a:115c:a1e0::1")).toBe(false);
    expect(isLoopbackAddress(undefined)).toBe(false);
  });

  it("allows remote same-origin browser API fetches", () => {
    expect(isTrustedPrivateApiRequest("100.64.0.8", {
      "sec-fetch-site": "same-origin",
      host: "oc-tailnet:14567",
    })).toBe(true);
    expect(isTrustedPrivateApiRequest("100.64.0.8", {
      origin: "http://oc-tailnet:14567",
      host: "oc-tailnet:14567",
    })).toBe(true);
  });

  it("rejects remote cross-site or raw private API reads", () => {
    expect(isTrustedPrivateApiRequest("100.64.0.8", {
      "sec-fetch-site": "cross-site",
      host: "oc-tailnet:14567",
    })).toBe(false);
    expect(isTrustedPrivateApiRequest("100.64.0.8", {
      origin: "http://evil.example",
      host: "oc-tailnet:14567",
    })).toBe(false);
    expect(isTrustedPrivateApiRequest("100.64.0.8", {
      host: "oc-tailnet:14567",
    })).toBe(false);
  });
});
