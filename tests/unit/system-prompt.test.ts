import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../../src/system-prompt.js";

describe("system prompt — skipped-tag handling instruction", () => {
  it("includes explicit guidance for [OPENCANDLE_SKIPPED ...] tags", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("[OPENCANDLE_SKIPPED");
    expect(prompt).toContain("Data gaps");
  });

  it("tells the model to omit the remediation when silenced", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("(silenced)");
  });

  it("tells the model NOT to treat skipped results as errors", () => {
    const prompt = buildSystemPrompt();
    expect(prompt.toLowerCase()).toMatch(/do not.*apolog|do not.*treat it as an error/);
  });

  it("explains the [OPENCANDLE_CONNECTED ...] tag", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("[OPENCANDLE_CONNECTED");
    expect(prompt.toLowerCase()).toContain("re-run");
  });

  it("includes explicit guidance for [OPENCANDLE_SOFT_DEGRADED ...] tags", () => {
    // 11.x — soft-degraded tags should be handled the same way as skipped
    // tags (aggregated into a Data gaps section) so the final answer always
    // surfaces every provider fallback, not just hard-skip events.
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("[OPENCANDLE_SOFT_DEGRADED");
    // The instruction should cover soft-degraded tags alongside skipped tags
    // in the Data gaps aggregation rule.
    const lowered = prompt.toLowerCase();
    expect(lowered).toContain("soft_degraded");
    expect(lowered).toContain("data gaps");
  });

  it("appends memory context when provided", () => {
    const prompt = buildSystemPrompt("User likes value stocks");
    expect(prompt).toContain("User likes value stocks");
    expect(prompt).toContain("Persistent Memory Context");
  });
});
