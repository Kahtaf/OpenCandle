import { describe, expect, it } from "vitest";
import { parseDteTarget } from "../../../src/routing/defaults.js";

describe("parseDteTarget", () => {
  it("parses '25_to_45_days'", () => {
    expect(parseDteTarget("25_to_45_days")).toEqual({ minDays: 25, maxDays: 45 });
  });

  it("parses '7_to_14_days'", () => {
    expect(parseDteTarget("7_to_14_days")).toEqual({ minDays: 7, maxDays: 14 });
  });

  it("parses '180_plus_days'", () => {
    const result = parseDteTarget("180_plus_days");
    expect(result).toBeTruthy();
    expect(result?.minDays).toBe(180);
    expect(result?.maxDays).toBe(1095);
  });

  it("returns null for unrecognized format", () => {
    expect(parseDteTarget("unknown")).toBeNull();
  });
});
