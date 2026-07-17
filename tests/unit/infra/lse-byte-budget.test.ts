import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getUsage,
  isOverSoftThreshold,
  markExhausted,
  recordBytes,
} from "../../../src/infra/lse-byte-budget.js";

const tempHomes: string[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-16T12:00:00.000Z"));
  const home = mkdtempSync(join(tmpdir(), "opencandle-lse-budget-"));
  tempHomes.push(home);
  vi.stubEnv("OPENCANDLE_HOME", home);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  for (const home of tempHomes.splice(0)) {
    rmSync(home, { recursive: true, force: true });
  }
});

describe("LSE byte budget", () => {
  it("accumulates recorded bytes and persists the current monthly usage", () => {
    recordBytes(1024);
    expect(
      JSON.parse(readFileSync(join(process.env.OPENCANDLE_HOME!, "lse-byte-budget.json"), "utf-8")),
    ).toEqual({ month: "2026-07", bytesUsed: 1024 });

    recordBytes(2048);

    const persisted = JSON.parse(
      readFileSync(join(process.env.OPENCANDLE_HOME!, "lse-byte-budget.json"), "utf-8"),
    );
    expect(persisted).toEqual({ month: "2026-07", bytesUsed: 3072 });
  });

  it("reads usage from a past month as zero for the current month", () => {
    writeFileSync(
      join(process.env.OPENCANDLE_HOME!, "lse-byte-budget.json"),
      JSON.stringify({ month: "2026-06", bytesUsed: 4096 }),
    );

    expect(getUsage()).toEqual({ month: "2026-07", bytesUsed: 0 });
  });

  it("crosses the soft threshold at exactly 80 percent of the monthly cap", () => {
    recordBytes(42_949_672_959);
    expect(isOverSoftThreshold()).toBe(false);

    recordBytes(1);
    expect(isOverSoftThreshold()).toBe(true);

    recordBytes(1);
    expect(isOverSoftThreshold()).toBe(true);
  });

  it("marks the current month as fully exhausted", () => {
    recordBytes(1024);
    markExhausted();

    expect(getUsage()).toEqual({ month: "2026-07", bytesUsed: 53_687_091_200 });
  });

  it("fails open for missing and corrupt budget files", () => {
    expect(getUsage()).toEqual({ month: "2026-07", bytesUsed: 0 });
    expect(isOverSoftThreshold()).toBe(false);

    writeFileSync(join(process.env.OPENCANDLE_HOME!, "lse-byte-budget.json"), "{invalid-json");

    expect(getUsage()).toEqual({ month: "2026-07", bytesUsed: 0 });
    expect(isOverSoftThreshold()).toBe(false);
  });

  it("ignores non-finite and negative byte counts", () => {
    recordBytes(512);
    recordBytes(Number.NaN);
    recordBytes(Number.POSITIVE_INFINITY);
    recordBytes(-1);

    expect(getUsage()).toEqual({ month: "2026-07", bytesUsed: 512 });
  });
});
