import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("GUI server composition root", () => {
  it("keeps server.ts focused on process composition instead of route internals", () => {
    const source = readFileSync(resolve("gui/server/server.ts"), "utf-8");
    const lineCount = source.split("\n").length;

    expect(lineCount).toBeLessThanOrEqual(350);
  });
});
