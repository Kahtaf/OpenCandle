import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PromptContextBuilder } from "../../../src/prompts/context-builder.js";
import {
  getPolicyCard,
  POLICY_CARD_IDS,
  renderPolicyCardForPlanning,
} from "../../../src/prompts/policy-cards.js";
import {
  buildAssumptionsBlockFromRouter,
  buildCompareAssetsPrompt,
  buildDisclosureBlock,
  buildOptionsScreenerPrompt,
  buildPortfolioPrompt,
} from "../../../src/prompts/workflow-prompts.js";
import type { PlanningEnvelope } from "../../../src/routing/planning.js";
import type { ResolvedTurnContext } from "../../../src/routing/turn-context.js";
import type {
  CompareAssetsSlots,
  OptionsScreenerSlots,
  PortfolioSlots,
  SlotResolution,
} from "../../../src/routing/types.js";

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-13T12:00:00Z"));
});

afterAll(() => {
  vi.useRealTimers();
});

function portfolioResolution(
  overrides: Partial<PortfolioSlots> = {},
  sourceOverrides: Partial<Record<keyof PortfolioSlots, "user" | "preference" | "default">> = {},
): SlotResolution<PortfolioSlots> {
  const resolved: PortfolioSlots = {
    budget: 10_000,
    riskProfile: "balanced",
    timeHorizon: "1y_plus",
    assetScope: "diversified_etf_building_blocks",
    positionCount: 6,
    maxSinglePositionPct: 20,
    ...overrides,
  };
  const sources: Record<keyof PortfolioSlots, "user" | "preference" | "default"> = {
    budget: "user",
    riskProfile: "default",
    timeHorizon: "default",
    assetScope: "default",
    positionCount: "default",
    maxSinglePositionPct: "default",
    ...sourceOverrides,
  };
  const defaultsUsed = (Object.keys(sources) as (keyof PortfolioSlots)[]).filter(
    (key) => sources[key] === "default",
  );
  return { resolved, sources, defaultsUsed, missingRequired: [] };
}

function optionsResolution(
  overrides: Partial<OptionsScreenerSlots> = {},
  sourceOverrides: Partial<
    Record<keyof OptionsScreenerSlots, "user" | "preference" | "default">
  > = {},
): SlotResolution<OptionsScreenerSlots> {
  const resolved: OptionsScreenerSlots = {
    symbol: "MSFT",
    direction: "bullish",
    dteTarget: "25_to_45_days",
    objective: "balanced_leverage_and_probability",
    moneynessPreference: "atm_to_slightly_otm",
    liquidityMinimum: "high_open_interest_and_tight_spread",
    ...overrides,
  };
  const sources: Record<keyof OptionsScreenerSlots, "user" | "preference" | "default"> = {
    symbol: "user",
    direction: "user",
    dteTarget: "default",
    objective: "default",
    moneynessPreference: "default",
    liquidityMinimum: "default",
    ...sourceOverrides,
  };
  const defaultsUsed = (Object.keys(sources) as (keyof OptionsScreenerSlots)[]).filter(
    (key) => sources[key] === "default",
  );
  return { resolved, sources, defaultsUsed, missingRequired: [] };
}

function compareResolution(
  overrides: Partial<CompareAssetsSlots> = {},
  sourceOverrides: Partial<
    Record<keyof CompareAssetsSlots, "user" | "preference" | "default">
  > = {},
): SlotResolution<CompareAssetsSlots> {
  const resolved: CompareAssetsSlots = {
    symbols: ["VOO", "QQQ"],
    ...overrides,
  };
  const sources: Partial<Record<keyof CompareAssetsSlots, "user" | "preference" | "default">> = {
    symbols: "user",
    ...sourceOverrides,
  };
  return { resolved, sources, defaultsUsed: [], missingRequired: [] };
}

function planning(policyCardId: (typeof POLICY_CARD_IDS)[number]): PlanningEnvelope {
  const card = getPolicyCard(policyCardId);
  return {
    version: "planning-v1",
    taskFamily: card.taskFamily,
    commitmentMode: "framework",
    policyCardId,
    evidencePlanId: "placeholder_general_fallback",
    answerContractId: "general_fallback",
    structuredCheckIds: ["required_evidence_present"],
    capabilityGapIds: card.capabilityGapIds,
    behaviorMode: "replacement_active",
    workspacePlaceholderIds: [],
    artifactPlaceholderIds: [],
    diagnostics: [],
  };
}

function turnContext(overrides: Partial<ResolvedTurnContext>): ResolvedTurnContext {
  return {
    userInput: "analyze AAPL",
    priorTurns: [],
    routeKind: "agent_task",
    legacyRoute: "fallback",
    workflow: "general_finance_qa",
    entities: { symbols: ["AAPL"] },
    slots: {},
    missingRequired: [],
    toolBundles: ["core_market"],
    activeToolNames: ["get_stock_quote", "search_ticker"],
    memoryQueryPlan: {
      routeKind: "agent_task",
      workflow: "general_finance_qa",
      categories: ["investor_profile", "workflow_history"],
      symbols: ["AAPL"],
      slotKeys: [],
    },
    memoryProvenance: [],
    promptPlaybook: "agent_task",
    diagnostics: [],
    ...overrides,
  };
}

describe("prompt output snapshots", () => {
  it("pins workflow prompt builders with representative inputs", () => {
    expect({
      disclosure: buildDisclosureBlock(
        { symbols: "VOO, QQQ", timeHorizon: "12mo", metrics: "overlap" },
        { symbols: "user", timeHorizon: "default", metrics: "user" },
        ["provider-backed holdings overlap required"],
      ),
      assumptionsFromRouter: buildAssumptionsBlockFromRouter(
        {
          budget: { value: 10_000, source: "user" },
          riskProfile: { value: "balanced", source: "default" },
        },
        ["max single position 20%"],
      ),
      portfolioEtf: buildPortfolioPrompt(portfolioResolution()),
      portfolioStocks: buildPortfolioPrompt(
        portfolioResolution({ assetScope: "large_cap_equities" }, { assetScope: "user" }),
      ),
      optionsBalanced: buildOptionsScreenerPrompt(optionsResolution()),
      optionsCoveredCall: buildOptionsScreenerPrompt(
        optionsResolution(
          {
            symbol: "NVDA",
            optionStrategy: "covered_call",
            costBasis: 95,
            shareQuantity: 100,
            catalystSymbols: ["AMD"],
            maxPremium: 500,
          },
          {
            symbol: "user",
            optionStrategy: "user",
            costBasis: "user",
            shareQuantity: "user",
            catalystSymbols: "user",
            maxPremium: "user",
          },
        ),
      ),
      compareBasic: buildCompareAssetsPrompt(compareResolution()),
      compareOverlap: buildCompareAssetsPrompt(
        compareResolution(
          { symbols: ["VOO", "QQQ", "SCHD"], metrics: ["overlap"], timeHorizon: "5y" },
          { metrics: "user", timeHorizon: "user" },
        ),
      ),
    }).toMatchSnapshot();
  });

  it("pins every policy card's direct and planning-rendered output", () => {
    const cards = POLICY_CARD_IDS.map((id) => ({
      id,
      card: getPolicyCard(id),
      rendered: renderPolicyCardForPlanning(planning(id)),
    }));

    expect(cards).toMatchSnapshot();
  });

  it("pins representative context-builder assemblies", () => {
    const contexts = {
      workflowDispatch: new PromptContextBuilder()
        .populateFromOptions({
          resolvedTurnContext: turnContext({
            userInput: "Compare VOO and SCHD for long-term income",
            routeKind: "workflow_dispatch",
            legacyRoute: "workflow",
            workflow: "compare_assets",
            entities: { symbols: ["VOO", "SCHD"], compareMetrics: ["overlap"] },
            toolBundles: ["core_market", "macro", "sentiment"],
            activeToolNames: ["get_stock_quote", "compare_companies", "analyze_correlation"],
            planning: planning("asset_compare"),
          }),
          memoryContext: "risk_profile: balanced",
        })
        .build(),
      clarification: new PromptContextBuilder()
        .populateFromOptions({
          resolvedTurnContext: turnContext({
            routeKind: "clarification",
            missingRequired: ["symbol"],
            toolBundles: ["clarification"],
            activeToolNames: ["ask_user"],
          }),
        })
        .build(),
      passThrough: new PromptContextBuilder()
        .populateFromOptions({
          resolvedTurnContext: turnContext({
            userInput: "Rewrite this sentence",
            routeKind: "pass_through",
            workflow: undefined,
            entities: { symbols: [] },
            toolBundles: [],
            activeToolNames: [],
          }),
        })
        .build(),
    };

    expect(contexts).toMatchSnapshot();
  });
});
