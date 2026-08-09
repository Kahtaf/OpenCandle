import { describe, expect, it, vi } from "vitest";
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

  it("closes internally opened databases after each operation", async () => {
    vi.resetModules();
    const close = vi.fn();
    const run = vi.fn().mockReturnValue({ changes: 0, lastInsertRowid: 0 });
    const all = vi.fn().mockReturnValue([]);
    const prepare = vi.fn().mockReturnValue({ all, run });

    vi.doMock("../../../src/memory/sqlite.js", () => ({
      initDefaultDatabase: () => ({ prepare, close }),
    }));

    const {
      clearDefault: dynamicClearDefault,
      getAllDefaults: dynamicGetAllDefaults,
      getDefaults: dynamicGetDefaults,
      setDefault: dynamicSetDefault,
    } = await import("../../../src/memory/tool-defaults.js");

    expect(dynamicGetDefaults("get_option_chain")).toEqual({});
    expect(dynamicGetAllDefaults()).toEqual(new Map());
    dynamicSetDefault("get_option_chain", "expiration", "next_monthly");
    dynamicClearDefault("get_option_chain", "expiration");

    expect(close).toHaveBeenCalledTimes(4);

    vi.doUnmock("../../../src/memory/sqlite.js");
    vi.resetModules();
  });
});
