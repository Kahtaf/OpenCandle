import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("GUI Tailwind entrypoint", () => {
  it("uses the Tailwind v4 import form so spacing utilities are generated", () => {
    const css = readFileSync(new URL("../../../gui/web/src/styles.css", import.meta.url), "utf8");
    const rules = css
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    expect(rules[0]).toBe('@import "tailwindcss";');
    expect(css).not.toContain("@tailwind base");
    expect(css).not.toContain("@tailwind components");
    expect(css).not.toContain("@tailwind utilities");
  });
});
