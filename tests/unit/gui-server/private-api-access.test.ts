import { describe, expect, it } from "vitest";
import { isLoopbackAddress } from "../../../gui/server/private-api-access.js";

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
});
