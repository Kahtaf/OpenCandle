import { describe, expect, it } from "vitest";
import { formatLargeNumber } from "../../../src/tools/formatting.js";

describe("tool output formatting", () => {
  it("formats large financial values with stable magnitude suffixes", () => {
    expect(formatLargeNumber(1_250_000)).toBe("1.25M");
    expect(formatLargeNumber(2_500_000_000)).toBe("2.50B");
    expect(formatLargeNumber(3_750_000_000_000)).toBe("3.75T");
    expect(formatLargeNumber(1_234)).toBe((1_234).toLocaleString());
  });
});
