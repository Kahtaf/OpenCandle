import { describe, expect, it } from "vitest";
import {
  privateApiCookieHeader,
  isLoopbackAddress,
  isTrustedPrivateApiRequest,
} from "../../../gui/server/private-api-access.js";

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

  it("allows remote requests carrying the server-issued GUI cookie", () => {
    const cookie = privateApiCookieHeader("secret-token");
    expect(isTrustedPrivateApiRequest("100.64.0.8", {
      cookie,
      host: "oc-tailnet:14567",
    }, "secret-token")).toBe(true);
  });

  it("rejects remote spoofed headers and raw private API reads without the GUI cookie", () => {
    expect(isTrustedPrivateApiRequest("100.64.0.8", {
      "sec-fetch-site": "same-origin",
      host: "oc-tailnet:14567",
    }, "secret-token")).toBe(false);
    expect(isTrustedPrivateApiRequest("100.64.0.8", {
      origin: "http://oc-tailnet:14567",
      host: "oc-tailnet:14567",
    }, "secret-token")).toBe(false);
    expect(isTrustedPrivateApiRequest("100.64.0.8", {
      host: "oc-tailnet:14567",
    }, "secret-token")).toBe(false);
  });
});
