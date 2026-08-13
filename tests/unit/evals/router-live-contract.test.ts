import { describe, expect, it } from "vitest";
import type { RouterOutput } from "../../../src/routing/router-types.js";
import { stripNonContract } from "../../evals/router-live-contract.js";

function output(overrides: Partial<RouterOutput>): RouterOutput {
  return {
    routeKind: "workflow_dispatch",
    route: "workflow",
    workflow: "compare_assets",
    entities: { symbols: [] },
    slots: {},
    preference_updates: [],
    missing_required: [],
    tool_bundles: [],
    diagnostics: [],
    reasoning: "test",
    ...overrides,
  };
}

describe("router-live contract normalization", () => {
  it("preserves exact Alphabet share-class identity", () => {
    const normalized = stripNonContract(
      output({
        entities: { symbols: ["MSFT", "GOOG"] },
        slots: {
          symbols: { value: ["MSFT", "GOOG"], source: "user", confidence: "high" },
        },
      }),
    );

    expect(normalized).toMatchObject({
      entities: { symbols: ["MSFT", "GOOG"] },
      slots: { symbols: ["MSFT", "GOOG"] },
    });
  });

  it("does not deduplicate distinct Alphabet share classes", () => {
    const normalized = stripNonContract(
      output({
        entities: { symbols: ["MSFT", "GOOG", "GOOGL"] },
        slots: {
          symbols: {
            value: ["MSFT", "GOOG", "GOOGL"],
            source: "user",
            confidence: "high",
          },
        },
      }),
    );

    expect(normalized).toMatchObject({
      entities: { symbols: ["MSFT", "GOOG", "GOOGL"] },
      slots: { symbols: ["MSFT", "GOOG", "GOOGL"] },
    });
  });

  it("uses the canonical DTE slot instead of duplicate options horizon prose", () => {
    const normalized = stripNonContract(
      output({
        workflow: "options_screener",
        entities: { symbols: ["AMD"], timeHorizon: "1-2 weeks", dteHint: "1-2 weeks" },
        slots: {
          dte_target: { value: "7_to_14_days", source: "user", confidence: "high" },
        },
      }),
    );

    expect(normalized).toMatchObject({ entities: { symbols: ["AMD"] } });
    expect((normalized as { entities: object }).entities).not.toHaveProperty("timeHorizon");
  });

  it("ignores volunteered horizon prose and empty catalyst lists", () => {
    const normalized = stripNonContract(
      output({
        routeKind: "agent_task",
        route: "fallback",
        workflow: "general_finance_qa",
        entities: { symbols: ["QQQ", "SPY"], timeHorizon: "long", catalystSymbols: [] },
      }),
      { slotKeys: [], toolBundles: [] },
    );

    expect((normalized as { entities: object }).entities).not.toHaveProperty("timeHorizon");
    expect((normalized as { entities: object }).entities).not.toHaveProperty("catalystSymbols");
  });

  it("does not require duplicate time-horizon slots when canonical DTE is present", () => {
    const normalized = stripNonContract(
      output({
        workflow: "options_screener",
        entities: { symbols: ["AMD"] },
        slots: {
          dte_target: { value: "7_to_14_days", source: "user", confidence: "high" },
        },
      }),
      { slotKeys: ["time_horizon", "dte_target"], toolBundles: [] },
    );

    expect(normalized).toMatchObject({ slots: { dte_target: "7_to_14_days" } });
    expect((normalized as { slots: object }).slots).not.toHaveProperty("time_horizon");
  });

  it("keeps every expected tool bundle contractual while ignoring extras", () => {
    const normalized = stripNonContract(
      output({
        routeKind: "agent_task",
        route: "fallback",
        workflow: "general_finance_qa",
        entities: { symbols: ["SPY"], compareMetrics: ["interest_rates"] },
        tool_bundles: ["core_market", "macro"],
      }),
      {
        slotKeys: [],
        toolBundles: ["core_market", "macro", "sentiment", "sec", "clarification"],
      },
    );

    expect(normalized).toMatchObject({ tool_bundles: ["core_market", "macro"] });
  });

  it("retains sentiment and SEC bundles when the fixture expects them", () => {
    const normalized = stripNonContract(
      output({ tool_bundles: ["core_market", "sentiment", "sec", "options"] }),
      { slotKeys: [], toolBundles: ["core_market", "sentiment", "sec"] },
    );

    expect(normalized).toMatchObject({ tool_bundles: ["core_market", "sec", "sentiment"] });
  });
});
