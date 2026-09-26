import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCompetitorSkipMetadata,
  parseCompetitorSkipMetadata,
  selectCompetitiveReportCache,
  writeCompetitorSkipMetadata,
} from "../../evals/competitive-completion.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "oc-competitor-metadata-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

describe("competitive report cache selection", () => {
  it("empties the cache only when OPENCANDLE_COMPETITIVE_NO_CACHE=1", () => {
    const load = vi.fn(() => [{ path: "cached.json", report: {} }]);

    expect(selectCompetitiveReportCache({}, load)).toHaveLength(1);
    expect(
      selectCompetitiveReportCache({ OPENCANDLE_COMPETITIVE_NO_CACHE: "0" }, load),
    ).toHaveLength(1);
    expect(selectCompetitiveReportCache({ OPENCANDLE_COMPETITIVE_NO_CACHE: "1" }, load)).toEqual(
      [],
    );
    // Ordinary discovery still invokes the real loader.
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe("competitor skip metadata", () => {
  it("round-trips only bounded id/reason fields through the real writer and parser", () => {
    const completionPath = join(makeTempDir(), "competitive-frozen.completion.json");
    const path = writeCompetitorSkipMetadata(completionPath, "competitive:frozen", [
      { id: "gemini", reason: "no credentials", answer: "SECRET ANSWER", label: "Gemini" },
    ]);

    const raw = JSON.parse(readFileSync(path, "utf-8"));
    expect(raw).toEqual({
      version: 1,
      suite: "competitive:frozen",
      skipped: [{ id: "gemini", reason: "no credentials" }],
    });
    expect(JSON.stringify(raw)).not.toContain("SECRET ANSWER");
    expect(parseCompetitorSkipMetadata(raw, "competitive:frozen")).toEqual([
      { id: "gemini", reason: "no credentials" },
    ]);
    // A suite mismatch is rejected, never silently accepted.
    expect(parseCompetitorSkipMetadata(raw, "cases")).toBeNull();
  });

  it("rejects malformed metadata instead of softening it into a generic reason", () => {
    const base = { version: 1, suite: "competitive:frozen" };
    expect(parseCompetitorSkipMetadata("not an object", "competitive:frozen")).toBeNull();
    expect(
      parseCompetitorSkipMetadata({ ...base, version: 2, skipped: [] }, "competitive:frozen"),
    ).toBeNull();
    expect(
      parseCompetitorSkipMetadata({ ...base, skipped: [{}] }, "competitive:frozen"),
    ).toBeNull();
    expect(
      parseCompetitorSkipMetadata({ ...base, skipped: [{ id: "gemini" }] }, "competitive:frozen"),
    ).toBeNull();
    expect(
      parseCompetitorSkipMetadata(
        { ...base, skipped: [{ id: "gemini", reason: 123 }] },
        "competitive:frozen",
      ),
    ).toBeNull();
    expect(
      parseCompetitorSkipMetadata(
        { ...base, skipped: [{ id: "unsafe id!", reason: "why" }] },
        "competitive:frozen",
      ),
    ).toBeNull();
    // A bounded but unknown competitor id is still safe to carry.
    expect(
      parseCompetitorSkipMetadata(
        { ...base, skipped: [{ id: "new-agent.v2", reason: "not installed" }] },
        "competitive:frozen",
      ),
    ).toEqual([{ id: "new-agent.v2", reason: "not installed" }]);
  });

  it("makes the writer strict about missing ids and reasons", () => {
    expect(() => buildCompetitorSkipMetadata("competitive:frozen", [{ id: undefined }])).toThrow(
      /no id/i,
    );
    expect(() => buildCompetitorSkipMetadata("competitive:frozen", [{ id: "gemini" }])).toThrow(
      /no reason/i,
    );
    expect(() =>
      buildCompetitorSkipMetadata("competitive:frozen", [{ id: "bad id!", reason: "why" }]),
    ).toThrow(/unsafe id/i);
  });

  it("bounds long reasons to a single line", () => {
    const metadata = buildCompetitorSkipMetadata("competitive:frozen", [
      { id: "codex", reason: `long ${"x".repeat(1200)}\nsecond line` },
    ]);

    expect(metadata.skipped[0].reason.length).toBeLessThanOrEqual(900);
    expect(metadata.skipped[0].reason).not.toContain("\n");
  });
});
