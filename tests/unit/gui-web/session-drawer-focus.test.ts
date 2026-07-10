import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("SessionDrawer", () => {
  it("enables the Sheet autofocus path when the mobile history drawer opens", () => {
    const source = readFileSync(
      resolve("gui/web/src/features/sessions/SessionHistory.jsx"),
      "utf-8",
    );

    expect(source).toContain("<Sheet\n      open={open}\n      autoFocus");
  });
});
