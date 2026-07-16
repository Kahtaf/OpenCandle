import { describe, expect, it } from "vitest";
import { SERIES_COLORS } from "../../../gui/web/src/lib/series-colors.js";

describe("SERIES_COLORS", () => {
  it("exports the shared categorical palette in its fixed order", () => {
    expect(SERIES_COLORS).toEqual([
      "oklch(0.62 0.1 250)",
      "oklch(0.66 0.09 175)",
      "oklch(0.7 0.1 65)",
      "oklch(0.64 0.1 330)",
      "oklch(0.66 0.09 145)",
      "oklch(0.62 0.1 35)",
    ]);
  });
});
