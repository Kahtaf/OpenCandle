import { symbolPageHref } from "../../route-resolution.js";
import { formatExchangeLabel, formatInstrumentTypeLabel } from "./exchange-labels.js";

export function navigateToInstrumentCandidate(navigate, candidate) {
  if (!navigate || !candidate?.symbol) return;
  void navigate({ to: symbolPageHref(candidate.symbol) });
}

export function instrumentSuggestionOptionId(optionIdPrefix, index) {
  return `${optionIdPrefix || "instrument-suggestion"}-option-${index}`;
}

export function instrumentCandidateKey(candidate, index) {
  return [
    candidate?.provider || "provider",
    candidate?.symbol || "symbol",
    candidate?.exchange || "exchange",
    index,
  ].join(":");
}

export function formatInstrumentCandidateLabel(candidate) {
  return candidate?.name || candidate?.quoteType || candidate?.symbol || "";
}

export function formatInstrumentCandidateMeta(candidate) {
  return [formatExchangeLabel(candidate?.exchange), formatInstrumentTypeLabel(candidate?.quoteType)]
    .filter(Boolean)
    .join(" · ");
}

export function rankInstrumentCandidates(candidates, query) {
  const items = Array.isArray(candidates) ? candidates : [];
  if (looksLikeFxQuery(query)) return items;

  const primary = [];
  const fx = [];
  for (const candidate of items) {
    (isFxCandidate(candidate) ? fx : primary).push(candidate);
  }
  return [...primary, ...fx];
}

export function clampInstrumentActiveIndex(activeIndex, candidateCount) {
  if (candidateCount <= 0) return -1;
  if (activeIndex < 0) return -1;
  return Math.min(activeIndex, candidateCount - 1);
}

export function nextInstrumentActiveIndex(
  activeIndex,
  candidateCount,
  direction,
  { wrap = true } = {},
) {
  if (candidateCount <= 0) return -1;
  const current = clampInstrumentActiveIndex(activeIndex, candidateCount);
  if (direction === "next") {
    if (wrap) return (current + 1) % candidateCount;
    return Math.min(current + 1, candidateCount - 1);
  }
  if (wrap) return current <= 0 ? candidateCount - 1 : current - 1;
  return Math.max(current - 1, 0);
}

export function resolveInstrumentSearchState({
  state,
  query,
  enabled = true,
  minLength = 1,
  initialActiveIndex = 0,
}) {
  const trimmedQuery = String(query ?? "").trim();
  if (!enabled || trimmedQuery.length < minLength) {
    return { candidates: [], activeIndex: initialActiveIndex };
  }
  if (state?.query !== trimmedQuery) {
    return { candidates: [], activeIndex: initialActiveIndex };
  }
  return {
    candidates: Array.isArray(state.candidates) ? state.candidates : [],
    activeIndex: Number.isInteger(state.activeIndex) ? state.activeIndex : initialActiveIndex,
  };
}

function looksLikeFxQuery(query) {
  const normalized = String(query ?? "")
    .trim()
    .toUpperCase();
  return normalized.includes("/") || normalized.endsWith("=X") || /^[A-Z]{6}$/.test(normalized);
}

function isFxCandidate(candidate) {
  const quoteType = String(candidate?.quoteType ?? "").toUpperCase();
  const symbol = String(candidate?.symbol ?? "").toUpperCase();
  return (
    quoteType === "CURRENCY" || quoteType === "FX" || quoteType === "FOREX" || symbol.endsWith("=X")
  );
}
