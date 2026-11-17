import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetConfigCache } from "../../../src/config.js";
import {
  getUsage,
  isOverSoftThreshold,
  markExhausted,
  recordBytes,
  syncLseUsage,
} from "../../../src/infra/lse-byte-budget.js";

const tempHomes: string[] = [];

beforeEach(() => {
  resetConfigCache();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-16T12:00:00.000Z"));
  const home = mkdtempSync(join(tmpdir(), "opencandle-lse-budget-"));
  tempHomes.push(home);
  vi.stubEnv("OPENCANDLE_HOME", home);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  resetConfigCache();
  for (const home of tempHomes.splice(0)) {
    rmSync(home, { recursive: true, force: true });
  }
});

describe("LSE byte budget", () => {
  it("accumulates recorded bytes and persists the current weekly usage", () => {
    recordBytes(1024);
    expect(
      JSON.parse(readFileSync(join(process.env.OPENCANDLE_HOME!, "lse-v3-usage.json"), "utf-8")),
    ).toMatchObject({ weekStart: "2026-07-13", allowanceBytes: 13_421_772_800, bytesUsed: 1024 });

    recordBytes(2048);

    const persisted = JSON.parse(
      readFileSync(join(process.env.OPENCANDLE_HOME!, "lse-v3-usage.json"), "utf-8"),
    );
    expect(persisted).toMatchObject({
      weekStart: "2026-07-13",
      allowanceBytes: 13_421_772_800,
      bytesUsed: 3072,
    });
  });

  it("reads usage from a past week as zero for the current week", () => {
    writeFileSync(
      join(process.env.OPENCANDLE_HOME!, "lse-v3-usage.json"),
      JSON.stringify({ weekStart: "2026-07-06", bytesUsed: 4096 }),
    );

    expect(getUsage()).toMatchObject({
      weekStart: "2026-07-13",
      allowanceBytes: 13_421_772_800,
      bytesUsed: 0,
    });
  });

  it("crosses the soft threshold at exactly 80 percent of the weekly cap", () => {
    recordBytes(10_737_418_239);
    expect(isOverSoftThreshold()).toBe(false);

    recordBytes(1);
    expect(isOverSoftThreshold()).toBe(true);

    recordBytes(1);
    expect(isOverSoftThreshold()).toBe(true);
  });

  it("blocks the current week without changing measured byte usage", () => {
    recordBytes(1024);
    markExhausted();

    expect(getUsage()).toMatchObject({
      weekStart: "2026-07-13",
      allowanceBytes: 13_421_772_800,
      bytesUsed: 1024,
      blockReason: "allowance-exhausted",
    });
  });

  it("resets on Monday UTC, even within the same month", () => {
    markExhausted();
    vi.setSystemTime(new Date("2026-07-20T00:00:00Z"));
    expect(isOverSoftThreshold()).toBe(false);
    expect(getUsage().bytesUsed).toBe(0);
  });

  it("ignores the legacy monthly exhaustion file", () => {
    writeFileSync(
      join(process.env.OPENCANDLE_HOME!, "lse-byte-budget.json"),
      JSON.stringify({ month: "2026-07", bytesUsed: 53_687_091_200 }),
    );
    expect(isOverSoftThreshold()).toBe(false);
  });

  it("uses server allowances for paid keys instead of imposing a free-tier cap", () => {
    syncLseUsage(
      { allowance_bytes: -1, used_bytes: 100_000_000_000 },
      { per_day: -1, used_today: 0, resets_in_seconds: 100 },
    );
    expect(isOverSoftThreshold()).toBe(false);
  });

  it("blocks on daily row exhaustion only until the server reset", () => {
    syncLseUsage(
      { allowance_bytes: 13_421_772_800, used_bytes: 100 },
      { per_day: 12_500_000, used_today: 12_500_000, resets_in_seconds: 100 },
    );
    expect(isOverSoftThreshold()).toBe(true);
    expect(getUsage().blockReason).toBe("rows-exhausted");
    vi.advanceTimersByTime(100_001);
    expect(isOverSoftThreshold()).toBe(false);
    expect(getUsage().bytesUsed).toBe(100);
  });

  it("does not apply one credential's exhaustion to a replacement key", () => {
    markExhausted();
    vi.stubEnv("LSE_API_KEY", "new-key");
    resetConfigCache();
    expect(isOverSoftThreshold()).toBe(false);
  });

  it("honors an allowance retry reset before Monday without inventing byte usage", () => {
    recordBytes(1024);
    markExhausted("allowance-exhausted", 60);
    expect(isOverSoftThreshold()).toBe(true);
    vi.advanceTimersByTime(60_001);
    expect(isOverSoftThreshold()).toBe(false);
    expect(getUsage().bytesUsed).toBe(1024);
  });

  it("fails open for missing and corrupt budget files", () => {
    expect(getUsage()).toMatchObject({
      weekStart: "2026-07-13",
      allowanceBytes: 13_421_772_800,
      bytesUsed: 0,
    });
    expect(isOverSoftThreshold()).toBe(false);

    writeFileSync(join(process.env.OPENCANDLE_HOME!, "lse-v3-usage.json"), "{invalid-json");

    expect(getUsage()).toMatchObject({
      weekStart: "2026-07-13",
      allowanceBytes: 13_421_772_800,
      bytesUsed: 0,
    });
    expect(isOverSoftThreshold()).toBe(false);
  });

  it("ignores non-finite and negative byte counts", () => {
    recordBytes(512);
    recordBytes(Number.NaN);
    recordBytes(Number.POSITIVE_INFINITY);
    recordBytes(-1);

    expect(getUsage()).toMatchObject({
      weekStart: "2026-07-13",
      allowanceBytes: 13_421_772_800,
      bytesUsed: 512,
    });
  });
});
