import {
  classifyMarketStatus,
  KNOWN_US_MARKET_HOLIDAYS,
  lastTradingDay,
  localDateTimeParts,
} from "../infra/market-calendar.js";
import type { ParsedTag } from "../onboarding/tool-tags.js";
import { parseToolTag } from "../onboarding/tool-tags.js";
import type { CapabilityGapId, EvidencePlanId, TaskFamily } from "../routing/planning.js";
import type { ProviderResult } from "./evidence.js";

export type PlanningEvidenceType =
  | "market_status"
  | "ticker_disambiguation"
  | "portfolio_exposure_map"
  | "tool_result"
  | "provider_gap";

export type PlanningProviderStatus =
  | "available"
  | "unavailable"
  | "credential_required"
  | "soft_degraded"
  | "skipped";

export interface EvidenceSource {
  toolName?: string;
  provider?: string;
}

export interface EntityScope {
  symbols?: string[];
  query?: string;
}

export interface RawTracePointer {
  traceId?: string;
  turnIndex?: number;
  toolCallIndex?: number;
  toolCallId?: string;
  toolName?: string;
  customEntryType?: string;
}

export interface EvidenceGap {
  kind: "provider_status" | "capability_gap" | "roadmap_placeholder";
  providerStatus?: Exclude<PlanningProviderStatus, "available">;
  provider?: string;
  capabilityGapId?: CapabilityGapId;
  reason: string;
  remediation?: string;
  silenced?: boolean;
  rawTag?: string;
}

export interface PlanningEvidenceRecord {
  id: string;
  evidenceType: PlanningEvidenceType;
  source: EvidenceSource;
  entityScope: EntityScope;
  observedAt: string;
  providerStatus: PlanningProviderStatus;
  normalizedFacts: Record<string, unknown>;
  rawTracePointer?: RawTracePointer;
  gaps: EvidenceGap[];
  caveats: string[];
}

export interface EvidencePlanDefinition {
  id: EvidencePlanId;
  taskFamilies: TaskFamily[];
  implemented: boolean;
  requiredEvidence: PlanningEvidenceType[];
  optionalEvidence: PlanningEvidenceType[];
  capabilityGapIds: CapabilityGapId[];
  roadmapPlaceholder?: string;
}

export interface MarketStatusInput {
  text: string;
  now?: Date;
  timezone?: string;
  traceId?: string;
}

export interface TickerDisambiguationInput {
  text: string;
  symbols?: string[];
  traceId?: string;
}

export interface PortfolioExposureMapInput {
  text: string;
  now?: Date;
  traceId?: string;
}

export interface PortfolioExposureSleeve {
  label: string;
  normalizedSleeve: string;
  percent: number;
}

export interface ToolCallEvidenceInput {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
  isError?: boolean;
}

export interface ToolTraceOptions {
  traceId?: string;
  turnIndex?: number;
  toolCallIndex?: number;
  toolCallId?: string;
}

export interface NormalizedProviderGap {
  providerStatus: Exclude<PlanningProviderStatus, "available">;
  provider: string;
  reason: string;
  remediation?: string;
  silenced?: boolean;
  rawTag: string;
}

export const EVIDENCE_PLAN_REGISTRY: Record<EvidencePlanId, EvidencePlanDefinition> = {
  market_status: {
    id: "market_status",
    taskFamilies: ["current_event_explanation", "macro_allocation_review"],
    implemented: true,
    requiredEvidence: ["market_status"],
    optionalEvidence: ["tool_result"],
    capabilityGapIds: ["market_calendar"],
  },
  ticker_disambiguation: {
    id: "ticker_disambiguation",
    taskFamilies: ["ticker_disambiguation"],
    implemented: true,
    requiredEvidence: ["ticker_disambiguation"],
    optionalEvidence: ["tool_result"],
    capabilityGapIds: ["earnings_event_risk"],
  },
  placeholder_single_asset_decision: placeholderPlan(
    "placeholder_single_asset_decision",
    ["single_asset_decision"],
    [],
  ),
  placeholder_asset_compare: placeholderPlan(
    "placeholder_asset_compare",
    ["asset_compare"],
    ["etf_holdings_overlap"],
  ),
  placeholder_portfolio_build: placeholderPlan(
    "placeholder_portfolio_build",
    ["portfolio_build"],
    [],
  ),
  placeholder_portfolio_review: placeholderPlan(
    "placeholder_portfolio_review",
    ["portfolio_review"],
    [],
  ),
  placeholder_options_strategy: placeholderPlan(
    "placeholder_options_strategy",
    ["options_strategy"],
    [],
  ),
  placeholder_current_event_explanation: placeholderPlan(
    "placeholder_current_event_explanation",
    ["current_event_explanation"],
    ["market_calendar"],
  ),
  placeholder_sentiment_snapshot: placeholderPlan(
    "placeholder_sentiment_snapshot",
    ["sentiment_snapshot"],
    ["sentiment_sample_depth"],
  ),
  placeholder_filing_thesis_review: placeholderPlan(
    "placeholder_filing_thesis_review",
    ["filing_thesis_review"],
    [],
  ),
  placeholder_retail_finance_tradeoff: placeholderPlan(
    "placeholder_retail_finance_tradeoff",
    ["retail_finance_tradeoff"],
    ["brokerage_comparison", "cash_yield_products", "fund_tax_efficiency"],
  ),
  placeholder_concept_explainer: placeholderPlan(
    "placeholder_concept_explainer",
    ["concept_explainer"],
    [],
  ),
  placeholder_backtest_review: placeholderPlan(
    "placeholder_backtest_review",
    ["backtest_review"],
    [],
  ),
  placeholder_stateful_tracking_update: placeholderPlan(
    "placeholder_stateful_tracking_update",
    ["stateful_tracking_update"],
    [],
  ),
  placeholder_general_fallback: placeholderPlan(
    "placeholder_general_fallback",
    ["general_fallback"],
    [],
  ),
};

function placeholderPlan(
  id: EvidencePlanId,
  taskFamilies: TaskFamily[],
  capabilityGapIds: CapabilityGapId[],
): EvidencePlanDefinition {
  return {
    id,
    taskFamilies,
    implemented: false,
    requiredEvidence: [],
    optionalEvidence: ["tool_result"],
    capabilityGapIds,
    roadmapPlaceholder: "openspec/changes/prompt-to-policy-agent-planning/future-roadmap.md",
  };
}

export function buildMarketStatusEvidence(input: MarketStatusInput): PlanningEvidenceRecord {
  const timezone = input.timezone ?? "America/New_York";
  const now = input.now ?? new Date();
  const local = localDateTimeParts(now, timezone);
  const temporalReferences = temporalReferencesFor(input.text);
  const holidayName = KNOWN_US_MARKET_HOLIDAYS[local.date];
  const isWeekend = local.weekday === "Sat" || local.weekday === "Sun";
  const isMarketHoliday = holidayName !== undefined;
  const marketStatus = classifyMarketStatus(local, isWeekend, isMarketHoliday, temporalReferences);
  const lastTradingDate = marketStatus === "open" ? local.date : lastTradingDay(local.date);
  const gaps: EvidenceGap[] = [
    {
      kind: "capability_gap",
      capabilityGapId: "market_calendar",
      reason:
        "V1 uses deterministic weekday and known-holiday grounding, not a live exchange-calendar provider.",
    },
  ];

  return {
    id: "market_status:deterministic",
    evidenceType: "market_status",
    source: { toolName: "deterministic_market_status" },
    entityScope: { query: input.text },
    observedAt: now.toISOString(),
    providerStatus: "available",
    normalizedFacts: {
      timezone,
      localDate: local.date,
      localTime: local.time,
      weekday: local.weekday,
      temporalReferences,
      isWeekend,
      isMarketHoliday,
      holidayName,
      marketStatus,
      lastTradingDay: lastTradingDate,
      quoteAsOfCaveat: quoteAsOfCaveat(marketStatus),
    },
    rawTracePointer: input.traceId
      ? { traceId: input.traceId, toolName: "deterministic_market_status" }
      : undefined,
    gaps,
    caveats: [
      "Market status is deterministic V1 grounding and should be verified against an exchange calendar for edge cases.",
    ],
  };
}

export function buildTickerDisambiguationEvidence(
  input: TickerDisambiguationInput,
): PlanningEvidenceRecord {
  const gaps: EvidenceGap[] = [
    {
      kind: "capability_gap",
      capabilityGapId: "earnings_event_risk",
      reason:
        "Ticker disambiguation can preserve symbol-verification gaps, but V1 does not add richer earnings-event data.",
    },
  ];

  return {
    id: "ticker_disambiguation:selected_slice",
    evidenceType: "ticker_disambiguation",
    source: { toolName: "planning_ticker_disambiguation" },
    entityScope: { symbols: [...(input.symbols ?? [])], query: input.text },
    observedAt: new Date(0).toISOString(),
    providerStatus: "available",
    normalizedFacts: {
      selectedMigrationSlice: "ticker_disambiguation",
      requestedSymbols: [...(input.symbols ?? [])],
      requiresSymbolVerification: true,
      legacyBehaviorRemainsActive: true,
    },
    rawTracePointer: input.traceId
      ? { traceId: input.traceId, toolName: "planning_ticker_disambiguation" }
      : undefined,
    gaps,
    caveats: input.symbols?.length
      ? []
      : [
          "No symbol was verified by this evidence plan; active tools remain responsible for lookup.",
        ],
  };
}

export function buildPortfolioExposureMapEvidence(
  input: PortfolioExposureMapInput,
): PlanningEvidenceRecord {
  const sleeves = extractPortfolioSleeves(input.text);
  const normalizedSleeves = new Set(sleeves.map((sleeve) => sleeve.normalizedSleeve));
  const hasBroadIndex =
    normalizedSleeves.has("broad_us_index") || normalizedSleeves.has("broad_equity");
  const hasSectorSleeve = sleeves.some((sleeve) => sleeve.normalizedSleeve.endsWith("_sector"));
  const broadIndexOverlapCaveat = hasBroadIndex && hasSectorSleeve;

  return {
    id: "portfolio_exposure_map:deterministic",
    evidenceType: "portfolio_exposure_map",
    source: { toolName: "deterministic_portfolio_exposure_map" },
    entityScope: { query: input.text },
    observedAt: (input.now ?? new Date()).toISOString(),
    providerStatus: "available",
    normalizedFacts: {
      directSleeves: sleeves,
      directExposureTotalPercent: roundPercent(
        sleeves.reduce((sum, sleeve) => sum + sleeve.percent, 0),
      ),
      broadIndexOverlapCaveat,
      exactHoldingsOverlapAvailable: false,
      targetBandGuidanceNeeded:
        /\b(?:rebalance|target\s+bands?|drift|overweight|underweight|concentration|diversif)/i.test(
          input.text,
        ),
    },
    rawTracePointer: input.traceId
      ? {
          traceId: input.traceId,
          toolName: "deterministic_portfolio_exposure_map",
        }
      : undefined,
    gaps: [
      {
        kind: "capability_gap",
        capabilityGapId: "etf_holdings_overlap",
        reason:
          "V1 records user-stated sleeves and overlap caveats but does not fetch exact ETF/index holdings or issuer weights.",
      },
    ],
    caveats: [
      "Exact ETF/index holdings overlap requires a provider-backed holdings source.",
      ...(broadIndexOverlapCaveat
        ? [
            "Broad index exposure may already include sector exposure; V1 does not estimate exact constituent weights.",
          ]
        : []),
    ],
  };
}

export function captureEvidenceFromToolCall(
  toolCall: ToolCallEvidenceInput,
  options: ToolTraceOptions = {},
): PlanningEvidenceRecord {
  const text = toolResultText(toolCall.result);
  const providerGap = text ? normalizeProviderGapFromToolText(text) : undefined;
  const providerStatus =
    providerGap?.providerStatus ?? (toolCall.isError ? "unavailable" : "available");
  const gaps = providerGap ? [providerGapToEvidenceGap(providerGap)] : [];
  if (toolCall.isError && !providerGap) {
    gaps.push({
      kind: "provider_status",
      providerStatus: "unavailable",
      reason: "Tool call returned an error.",
    });
  }

  return {
    id: `tool_result:${toolCall.name}`,
    evidenceType: providerGap ? "provider_gap" : "tool_result",
    source: {
      toolName: toolCall.name,
      provider: providerGap?.provider,
    },
    entityScope: symbolsFromArgs(toolCall.args),
    observedAt: new Date(0).toISOString(),
    providerStatus,
    normalizedFacts: {
      toolName: toolCall.name,
      args: { ...toolCall.args },
      isError: toolCall.isError === true,
      providerStatus,
    },
    rawTracePointer: {
      ...options,
      toolName: toolCall.name,
    },
    gaps,
    caveats: [],
  };
}

export function normalizeProviderGapFromToolText(text: string): NormalizedProviderGap | undefined {
  const parsed = parseToolTag(text);
  if (!parsed || parsed.kind === "connected") return undefined;

  return {
    providerStatus: providerStatusFromTag(parsed),
    provider: parsed.provider,
    reason: reasonFromTag(parsed),
    remediation: remediationFromTag(parsed),
    silenced: parsed.kind === "skipped" ? parsed.silenced : undefined,
    rawTag: text,
  };
}

export function providerResultToPlanningEvidence<T>(
  label: string,
  result: ProviderResult<T>,
  rawTracePointer?: RawTracePointer,
): PlanningEvidenceRecord {
  if (result.status === "ok") {
    return {
      id: `provider_result:${label}`,
      evidenceType: "tool_result",
      source: {},
      entityScope: {},
      observedAt: result.timestamp,
      providerStatus: "available",
      normalizedFacts: { label, data: result.data, stale: result.stale === true },
      rawTracePointer,
      gaps: [],
      caveats: result.stale ? ["Provider result came from stale cache."] : [],
    };
  }

  return {
    id: `provider_result:${label}`,
    evidenceType: "provider_gap",
    source: { provider: result.provider },
    entityScope: {},
    observedAt: new Date(0).toISOString(),
    providerStatus: "unavailable",
    normalizedFacts: { label },
    rawTracePointer,
    gaps: [
      {
        kind: "provider_status",
        providerStatus: "unavailable",
        provider: result.provider,
        reason: result.reason,
      },
    ],
    caveats: [],
  };
}

function providerGapToEvidenceGap(gap: NormalizedProviderGap): EvidenceGap {
  return {
    kind: "provider_status",
    providerStatus: gap.providerStatus,
    provider: gap.provider,
    reason: gap.reason,
    remediation: gap.remediation,
    silenced: gap.silenced,
    rawTag: gap.rawTag,
  };
}

function providerStatusFromTag(
  tag: Exclude<ParsedTag, { kind: "connected" }>,
): Exclude<PlanningProviderStatus, "available"> {
  if (tag.kind === "credential_required") return "credential_required";
  if (tag.kind === "soft_degraded") return "soft_degraded";
  return "skipped";
}

function reasonFromTag(tag: Exclude<ParsedTag, { kind: "connected" }>): string {
  if (tag.kind === "credential_required") {
    return tag.reason === "stale" ? "credential_stale" : "credential_missing";
  }
  if (tag.kind === "soft_degraded") {
    return `soft_degraded_to_${tag.fallback}`;
  }
  return tag.reason;
}

function remediationFromTag(tag: Exclude<ParsedTag, { kind: "connected" }>): string | undefined {
  if (tag.kind === "soft_degraded") return tag.remediation;
  if (tag.kind === "skipped") return tag.remediation;
  return "run /connect";
}

function toolResultText(result: unknown): string | undefined {
  if (typeof result === "string") return result;
  if (!isRecord(result)) return undefined;
  const content = result.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (isRecord(item) && typeof item.text === "string") return item.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return undefined;
}

function symbolsFromArgs(args: Record<string, unknown>): EntityScope {
  const symbol = args.symbol;
  const symbols = args.symbols;
  if (typeof symbol === "string") return { symbols: [symbol] };
  if (Array.isArray(symbols) && symbols.every((item) => typeof item === "string")) {
    return { symbols: [...symbols] };
  }
  return {};
}

function extractPortfolioSleeves(text: string): PortfolioExposureSleeve[] {
  const matches: PortfolioExposureSleeve[] = [];
  const pattern =
    /(\d+(?:\.\d+)?)\s*%\s*(?:in|to|of|toward|towards|allocated\s+to)?\s*([^,;.\n?]+)/gi;
  for (const match of text.matchAll(pattern)) {
    const percent = Number(match[1]);
    if (!Number.isFinite(percent)) continue;
    const label = cleanSleeveLabel(match[2] ?? "");
    if (!label) continue;
    matches.push({
      label,
      normalizedSleeve: normalizePortfolioSleeve(label),
      percent: roundPercent(percent),
    });
  }
  return matches;
}

function cleanSleeveLabel(label: string): string {
  return label
    .replace(/^(?:and|plus|with)\s+/i, "")
    .replace(/\b(?:should|can|could|would|do|does|rebalance|diversify|target|bands?).*$/i, "")
    .trim();
}

function normalizePortfolioSleeve(label: string): string {
  const lower = label.toLowerCase();
  if (/\b(?:s&p\s*500|sp\s*500|index|voo|spy|ivv)\b/.test(lower)) return "broad_us_index";
  if (/\b(?:tech|technology|software|semis?|semiconductors?)\b/.test(lower))
    return "technology_sector";
  if (/\b(?:bond|bonds|fixed\s+income|treasur(?:y|ies))\b/.test(lower)) return "bonds";
  if (/\b(?:cash|savings?|money\s*market|t[-\s]?bills?)\b/.test(lower)) return "cash";
  if (/\b(?:international|ex[-\s]?us|foreign|global)\b/.test(lower)) return "international_equity";
  if (/\b(?:stock|stocks|equity|equities)\b/.test(lower)) return "broad_equity";
  return (
    lower
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48) || "unknown_sleeve"
  );
}

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

function temporalReferencesFor(text: string): string[] {
  const lower = text.toLowerCase();
  const refs: string[] = [];
  if (/\btoday\b/.test(lower)) refs.push("today");
  if (/\bright now\b/.test(lower)) refs.push("right_now");
  if (/\bthis morning\b/.test(lower)) refs.push("this_morning");
  if (/\bafter close\b|\bafter the close\b/.test(lower)) refs.push("after_close");
  if (/\bmarket(?: is|'s)? closed\b|\bmarket-closed\b/.test(lower)) refs.push("market_closed");
  if (/\bweekend\b/.test(lower)) refs.push("weekend");
  if (/\bholiday\b/.test(lower)) refs.push("holiday");
  return refs;
}

function quoteAsOfCaveat(marketStatus: string): string {
  if (marketStatus === "open")
    return "Quote evidence may be intraday or delayed depending on provider.";
  if (marketStatus === "pre_market")
    return "Quote evidence may reflect the previous regular session until premarket data is fetched.";
  return "Quote evidence should distinguish the current calendar date from the most recent trading session.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
