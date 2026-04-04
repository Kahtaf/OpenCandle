/**
 * Consumer smoke test — imports from the "opencandle/tool-kit" package subpath
 * (resolved through package.json exports → dist/tool-kit.js) to verify that
 * the published API surface is intact. This catches export map or build
 * artifact breakage that source-path imports would miss.
 *
 * Requires `npm run build` before running.
 */
import { describe, expect, it } from "vitest";

describe("opencandle/tool-kit package exports", () => {
  it("exports all public functions and classes via the package subpath", async () => {
    // Dynamic import through the package.json exports map, not a source path
    const mod = await import("opencandle/tool-kit");

    // Functions
    expect(typeof mod.registerTools).toBe("function");
    expect(typeof mod.createTool).toBe("function");
    expect(typeof mod.getAddonToolDescriptions).toBe("function");
    expect(typeof mod.httpGet).toBe("function");
    expect(typeof mod.agentToolToPiTool).toBe("function");

    // Singletons / instances
    expect(mod.cache).toBeDefined();
    expect(mod.rateLimiter).toBeDefined();

    // Classes
    expect(typeof mod.Cache).toBe("function");
    expect(typeof mod.RateLimiter).toBe("function");

    // Re-exported from Typebox
    expect(mod.Type).toBeDefined();
    expect(typeof mod.Type.Object).toBe("function");
    expect(typeof mod.Type.String).toBe("function");
  });
});
