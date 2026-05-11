import { describe, expect, it } from "vitest";
import { initDatabase } from "../../../src/memory/sqlite.js";
import {
  clearDefault,
  getAllDefaults,
  getDefaults,
  setDefault,
} from "../../../src/memory/tool-defaults.js";

describe("tool defaults storage", () => {
  it("stores, reads, and clears per-tool defaults", () => {
    const db = initDatabase(":memory:");

    setDefault("get_option_chain", "expiration", "next_monthly", db);
    setDefault("get_option_chain", "filters.min_iv", 0.25, db);

    expect(getDefaults("get_option_chain", db)).toEqual({
      expiration: "next_monthly",
      filters: { min_iv: 0.25 },
    });
    expect(getAllDefaults(db).get("get_option_chain")).toEqual({
      expiration: "next_monthly",
      filters: { min_iv: 0.25 },
    });

    clearDefault("get_option_chain", "expiration", db);

    expect(getDefaults("get_option_chain", db)).toEqual({
      filters: { min_iv: 0.25 },
    });
  });
});
