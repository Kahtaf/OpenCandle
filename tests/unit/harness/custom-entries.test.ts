/**
 * Verifies the opencandle-* custom-entry drain used by the harness before
 * writing trace.json.
 *
 * To keep this test focused and LLM-free, we pre-seed a real
 * SessionManager.inMemory() with representative custom entries — matching what
 * the opencandle extension writes at runtime — then assert the resulting array
 * shape and ordering.
 */

import { SessionManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { drainOpenCandleCustomEntries } from "../../harness/opencandle-runner.js";

describe("harness opencandle-* custom-entry drain", () => {
  it("captures opencandle-* entries with the documented shape", () => {
    const sm = SessionManager.inMemory();
    // Minimal user/assistant messages so the session isn't empty.
    sm.appendMessage({ role: "user", content: "hi" });
    sm.appendMessage({ role: "assistant", content: [{ type: "text", text: "hello" }] });

    sm.appendCustomEntry("opencandle-router", { output: { intent: "general_qa" } });
    sm.appendCustomEntry("opencandle-disclaimer", { text: "Not financial advice." });

    const entries = drainOpenCandleCustomEntries(sm);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      customType: "opencandle-router",
      data: { output: { intent: "general_qa" } },
    });
    expect(typeof entries[0].timestamp).toBe("string");
    expect(entries[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(entries[1]).toMatchObject({
      customType: "opencandle-disclaimer",
      data: { text: "Not financial advice." },
    });
  });

  it("excludes non-opencandle custom entries (wildcard scoped to prefix)", () => {
    const sm = SessionManager.inMemory();
    sm.appendCustomEntry("opencandle-workflow", { workflow: "portfolio_builder" });
    sm.appendCustomEntry("some-other-extension", { payload: "should be dropped" });
    sm.appendCustomEntry("opencandle-turn-gap", { annotation: "cred-soft-fallback" });

    const entries = drainOpenCandleCustomEntries(sm);
    const customTypes = entries.map((e) => e.customType);

    expect(customTypes).toEqual(["opencandle-workflow", "opencandle-turn-gap"]);
    expect(customTypes).not.toContain("some-other-extension");
  });

  it("preserves append order", () => {
    const sm = SessionManager.inMemory();
    sm.appendCustomEntry("opencandle-workflow", { step: 1 });
    sm.appendCustomEntry("opencandle-disclaimer", { step: 2 });
    sm.appendCustomEntry("opencandle-workflow", { step: 3 });
    sm.appendCustomEntry("opencandle-disclaimer", { step: 4 });

    const entries = drainOpenCandleCustomEntries(sm);

    expect(entries.map((e) => (e.data as { step: number }).step)).toEqual([1, 2, 3, 4]);
  });

  it("covers the currently-emitted opencandle-* types", () => {
    // Acts as a regression anchor: if the extension adds a new opencandle-*
    // customType the wildcard still captures it without a harness edit
    // (design Decision 6 "Wildcard covers future entry types").
    const sm = SessionManager.inMemory();
    const knownTypes = [
      "opencandle-router",
      "opencandle-router-error",
      "opencandle-router-prefs-dropped",
      "opencandle-disclaimer",
      "opencandle-turn-gap",
      "opencandle-workflow",
      "opencandle-analyst-step",
      "opencandle-future-hypothetical", // wildcard should still catch unknown future types
    ];
    for (const t of knownTypes) {
      sm.appendCustomEntry(t, { marker: t });
    }

    const entries = drainOpenCandleCustomEntries(sm);
    expect(entries.map((e) => e.customType)).toEqual(knownTypes);
  });

  it("preserves structured analyst-step entries for trace evidence", () => {
    const sm = SessionManager.inMemory();
    sm.appendCustomEntry("opencandle-analyst-step", {
      stage: "analyst_valuation",
      role: "valuation",
      signal: "BUY",
      conviction: 8,
      parsed: true,
      evidenceCount: 1,
      evidence: [
        {
          tool: "get_stock_quote",
          resultDigest: { preview: '{"symbol":"NVDA"}', totalLength: 17 },
        },
      ],
    });

    const [entry] = drainOpenCandleCustomEntries(sm);

    expect(entry).toMatchObject({
      customType: "opencandle-analyst-step",
      data: {
        stage: "analyst_valuation",
        role: "valuation",
        signal: "BUY",
        conviction: 8,
        parsed: true,
        evidenceCount: 1,
        evidence: [
          {
            tool: "get_stock_quote",
            resultDigest: { preview: '{"symbol":"NVDA"}', totalLength: 17 },
          },
        ],
      },
    });
  });

  it("returns an empty array when no opencandle-* entries are present", () => {
    const sm = SessionManager.inMemory();
    sm.appendMessage({ role: "user", content: "hi" });
    sm.appendCustomEntry("unrelated-ext", { foo: 1 });

    expect(drainOpenCandleCustomEntries(sm)).toEqual([]);
  });

  // Spec scenarios from
  // openspec/changes/router-context-and-observability/specs/test-harness-observability/spec.md
  describe("spec scenarios", () => {
    it("'Router entry appears in trace.json' — data.output is preserved verbatim", () => {
      const sm = SessionManager.inMemory();
      const routerOutput = {
        intent: "portfolio_builder",
        confidence: 0.92,
        entities: { symbols: ["SPY", "QQQ"], budget: 10_000 },
      };
      sm.appendCustomEntry("opencandle-router", { output: routerOutput });

      const [entry] = drainOpenCandleCustomEntries(sm);
      expect(entry.customType).toBe("opencandle-router");
      expect((entry.data as { output: unknown }).output).toEqual(routerOutput);
    });

    it("'Workflow dispatch entries appear in trace.json' — payload shape preserved", () => {
      const sm = SessionManager.inMemory();
      sm.appendCustomEntry("opencandle-workflow", {
        workflow: "portfolio_builder",
        entities: { budget: 10_000 },
        resolved: { budget: 10_000, risk_profile: "moderate" },
      });

      const [entry] = drainOpenCandleCustomEntries(sm);
      expect(entry.customType).toBe("opencandle-workflow");
      expect(entry.data).toEqual({
        workflow: "portfolio_builder",
        entities: { budget: 10_000 },
        resolved: { budget: 10_000, risk_profile: "moderate" },
      });
    });

    it("'Disclaimer entries appear once per final assistant turn' — multi-turn accumulates", () => {
      const sm = SessionManager.inMemory();
      // Simulate a multi-step workflow: two final assistant turns, each with
      // its own disclaimer append.
      sm.appendCustomEntry("opencandle-workflow", { workflow: "compare_assets" });
      sm.appendCustomEntry("opencandle-disclaimer", { text: "turn 1" });
      sm.appendCustomEntry("opencandle-disclaimer", { text: "turn 2" });

      const disclaimers = drainOpenCandleCustomEntries(sm).filter(
        (e) => e.customType === "opencandle-disclaimer",
      );
      expect(disclaimers).toHaveLength(2);
    });

    it("'Turn-gap entries appear when soft-degradation accumulates' — annotation preserved", () => {
      const sm = SessionManager.inMemory();
      sm.appendCustomEntry("opencandle-turn-gap", {
        annotation: { provider: "alpha_vantage", reason: "soft-fallback" },
      });

      const [entry] = drainOpenCandleCustomEntries(sm);
      expect(entry.customType).toBe("opencandle-turn-gap");
      expect(entry.data).toEqual({
        annotation: { provider: "alpha_vantage", reason: "soft-fallback" },
      });
    });

    it("'Non-opencandle custom entries excluded' — third-party extensions are ignored", () => {
      const sm = SessionManager.inMemory();
      sm.appendCustomEntry("third-party-analytics", { event: "click" });
      sm.appendCustomEntry("foo-bar-baz", { foo: 1 });
      sm.appendCustomEntry("open-candle", { spaced: "wrong prefix" });
      sm.appendCustomEntry("opencandleX", { close: "but no hyphen" });

      expect(drainOpenCandleCustomEntries(sm)).toEqual([]);
    });
  });
});
