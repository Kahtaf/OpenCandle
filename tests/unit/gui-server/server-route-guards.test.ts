import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("GUI server route guards", () => {
  it("requires trusted GUI requests before starting chat runs", () => {
    const source = readFileSync(resolve("gui/server/server.ts"), "utf-8");
    const routeStart = source.indexOf('url.pathname === "/api/chat/run"');
    const handlerStart = source.indexOf("await handleSseChatRun(req, res);", routeStart);
    const routeBlock = source.slice(routeStart, handlerStart);

    expect(routeStart).toBeGreaterThan(-1);
    expect(handlerStart).toBeGreaterThan(routeStart);
    expect(routeBlock).toContain('allowTrustedGuiRequest(req, res, "Chat run API")');
  });
});
