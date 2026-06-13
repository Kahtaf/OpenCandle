import { describe, expect, it } from "vitest";
import {
  isLoopbackAddress,
  isTrustedPrivateApiRequest,
  privateApiCookieHeader,
} from "../../../gui/server/private-api-access.js";

describe("private GUI API access", () => {
  it("identifies loopback addresses", () => {
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

  it("requires the server-issued GUI cookie even for loopback callers", () => {
    const cookie = privateApiCookieHeader("secret-token");
    expect(
      isTrustedPrivateApiRequest(
        {
          cookie,
          host: "127.0.0.1:14567",
        },
        "secret-token",
        "127.0.0.1",
      ),
    ).toBe(true);
    expect(
      isTrustedPrivateApiRequest(
        {
          cookie,
          host: "127.0.0.1:14567",
        },
        "secret-token",
        "::ffff:127.0.0.1",
      ),
    ).toBe(true);
    expect(
      isTrustedPrivateApiRequest(
        {
          host: "127.0.0.1:14567",
        },
        "secret-token",
        "127.0.0.1",
      ),
    ).toBe(false);
  });

  it("requires loopback callers by default even with the server-issued GUI cookie", () => {
    const cookie = privateApiCookieHeader("secret-token");
    expect(
      isTrustedPrivateApiRequest(
        {
          cookie,
          host: "oc-tailnet:14567",
        },
        "secret-token",
        "192.168.1.50",
      ),
    ).toBe(false);
    expect(
      isTrustedPrivateApiRequest(
        {
          cookie,
          host: "oc-tailnet:14567",
        },
        "secret-token",
        undefined,
      ),
    ).toBe(false);
  });

  it("allows remote callers only with the explicit remote private API opt-in", () => {
    const cookie = privateApiCookieHeader("secret-token");
    expect(
      isTrustedPrivateApiRequest(
        {
          cookie,
          host: "oc-tailnet:14567",
        },
        "secret-token",
        "192.168.1.50",
        { allowRemote: true },
      ),
    ).toBe(true);
    expect(
      isTrustedPrivateApiRequest(
        {
          host: "oc-tailnet:14567",
        },
        "secret-token",
        "192.168.1.50",
        { allowRemote: true },
      ),
    ).toBe(false);
  });

  it("rejects remote spoofed headers and raw private API reads without the GUI cookie", () => {
    expect(
      isTrustedPrivateApiRequest(
        {
          "sec-fetch-site": "same-origin",
          host: "oc-tailnet:14567",
        },
        "secret-token",
        "192.168.1.50",
        { allowRemote: true },
      ),
    ).toBe(false);
    expect(
      isTrustedPrivateApiRequest(
        {
          origin: "http://oc-tailnet:14567",
          host: "oc-tailnet:14567",
        },
        "secret-token",
        "192.168.1.50",
        { allowRemote: true },
      ),
    ).toBe(false);
    expect(
      isTrustedPrivateApiRequest(
        {
          host: "oc-tailnet:14567",
        },
        "secret-token",
        "192.168.1.50",
        { allowRemote: true },
      ),
    ).toBe(false);
  });

  it("rejects cookie-bearing cross-site browser requests", () => {
    const cookie = privateApiCookieHeader("secret-token");
    expect(
      isTrustedPrivateApiRequest(
        {
          cookie,
          "sec-fetch-site": "cross-site",
          host: "127.0.0.1:14567",
        },
        "secret-token",
        "127.0.0.1",
      ),
    ).toBe(false);
    expect(
      isTrustedPrivateApiRequest(
        {
          cookie,
          origin: "http://evil.example",
          host: "127.0.0.1:14567",
        },
        "secret-token",
        "127.0.0.1",
      ),
    ).toBe(false);
  });

  it("treats malformed private API cookies as absent", () => {
    expect(
      isTrustedPrivateApiRequest(
        {
          cookie: "opencandle_gui_session=%",
          host: "oc-tailnet:14567",
        },
        "secret-token",
        "192.168.1.50",
        { allowRemote: true },
      ),
    ).toBe(false);
  });
});
