import { formatInstrumentTypeLabel } from "../instruments/exchange-labels.js";

// The symbol page composes itself from an explicit per-asset-type descriptor
// rather than reading meaning out of the ticker string. A descriptor declares
// which sections exist, which stats the hero strip shows, what those stats are
// called for that asset type, and what the page says about data it cannot have.
// A section absent from a descriptor is omitted entirely; nothing renders as an
// empty shell.

export const ASSET_TYPES = ["stock", "etf", "crypto", "fx", "index", "commodity", "unknown"];

const EQUITY_STATS = ["week", "month", "ytd", "year", "fromHigh52w", "dayRange", "volume"];
const NO_VOLUME_STATS = EQUITY_STATS.filter((stat) => stat !== "volume");

const BASE_STAT_LABELS = {
  week: "5D",
  month: "1M",
  ytd: "YTD",
  year: "1Y",
  fromHigh52w: "From 52-week high",
  dayRange: "Day range",
  volume: "Volume",
};

// Saved context belongs to every instrument, so position, alerts and watchlist
// membership stay in every descriptor including `unknown`.
const SAVED_CONTEXT_SECTIONS = ["position", "alerts", "watchlist"];
const MARKET_SECTIONS = ["hero", "chart", "keyLevels", "trend"];

function descriptor({
  type,
  typeLabel,
  stats,
  statLabels = {},
  sections,
  availabilityNote = null,
  continuousTrading = false,
  sessionLabel = null,
}) {
  return Object.freeze({
    type,
    typeLabel,
    stats: Object.freeze(stats),
    statLabels: Object.freeze({ ...BASE_STAT_LABELS, ...statLabels }),
    sections: Object.freeze(sections),
    availabilityNote,
    continuousTrading,
    sessionLabel,
  });
}

const DESCRIPTORS = {
  stock: descriptor({
    type: "stock",
    typeLabel: "Stock",
    stats: EQUITY_STATS,
    sections: [...MARKET_SECTIONS, "keyStats", "about", ...SAVED_CONTEXT_SECTIONS, "analyze"],
  }),
  etf: descriptor({
    type: "etf",
    typeLabel: "ETF",
    stats: EQUITY_STATS,
    sections: [...MARKET_SECTIONS, "keyStats", "about", ...SAVED_CONTEXT_SECTIONS, "analyze"],
  }),
  crypto: descriptor({
    type: "crypto",
    typeLabel: "Crypto",
    stats: EQUITY_STATS,
    statLabels: { week: "1W", dayRange: "24h range" },
    sections: [...MARKET_SECTIONS, ...SAVED_CONTEXT_SECTIONS, "analyze"],
    availabilityNote: "Fundamental stats are not available for crypto assets.",
    continuousTrading: true,
    sessionLabel: "Trades 24/7",
  }),
  fx: descriptor({
    type: "fx",
    typeLabel: "FX",
    stats: NO_VOLUME_STATS,
    sections: [...MARKET_SECTIONS, ...SAVED_CONTEXT_SECTIONS, "analyze"],
    availabilityNote: "Fundamental stats are not available for currency pairs.",
  }),
  index: descriptor({
    type: "index",
    typeLabel: "Index",
    stats: NO_VOLUME_STATS,
    sections: [...MARKET_SECTIONS, ...SAVED_CONTEXT_SECTIONS, "analyze"],
    availabilityNote: "Fundamental stats are not available for market indices.",
  }),
  commodity: descriptor({
    type: "commodity",
    typeLabel: "Commodity",
    stats: EQUITY_STATS,
    sections: [...MARKET_SECTIONS, ...SAVED_CONTEXT_SECTIONS, "analyze"],
    availabilityNote: "Fundamental stats are not available for commodity futures.",
  }),
  unknown: descriptor({
    type: "unknown",
    typeLabel: "Instrument",
    stats: [],
    sections: ["hero", "chart", ...SAVED_CONTEXT_SECTIONS],
    availabilityNote: "Further detail is not available for this instrument.",
  }),
};

// Provider quote types and the saved instrument records use different words for
// the same instrument, so both vocabularies normalize here. A word that is not
// listed resolves to `unknown` instead of being forced into a nearby type.
const TYPE_ALIASES = new Map([
  ["equity", "stock"],
  ["equities", "stock"],
  ["stock", "stock"],
  ["stocks", "stock"],
  ["etf", "etf"],
  // A mutual fund shares the fund page composition; its own name still reaches
  // the page through the resolved type label.
  ["mutualfund", "etf"],
  ["fund", "etf"],
  ["crypto", "crypto"],
  ["cryptocurrency", "crypto"],
  ["currency", "fx"],
  ["fx", "fx"],
  ["forex", "fx"],
  ["index", "index"],
  ["indices", "index"],
  ["future", "commodity"],
  ["futures", "commodity"],
  ["commodity", "commodity"],
]);

function normalizeTypeWord(value) {
  const word = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!word) return null;
  return TYPE_ALIASES.get(word) ?? null;
}

/**
 * @param {{ quoteType?: string, assetType?: string }} [metadata]
 * @returns {string} one of `ASSET_TYPES`
 */
export function resolveAssetType(metadata = {}) {
  return (
    normalizeTypeWord(metadata?.quoteType) ?? normalizeTypeWord(metadata?.assetType) ?? "unknown"
  );
}

/** @returns {(typeof DESCRIPTORS)[keyof typeof DESCRIPTORS]} */
export function assetDescriptor(type) {
  return DESCRIPTORS[String(type ?? "").toLowerCase()] ?? DESCRIPTORS.unknown;
}

export function descriptorHasSection(descriptorValue, section) {
  return Boolean(descriptorValue?.sections?.includes(section));
}

/**
 * Resolve the page descriptor from the instrument metadata both surfaces
 * already receive: the exact search candidate for the symbol, the saved
 * instrument record, and the company profile. Nothing here reads the ticker
 * string, so currency pairs, indices and non-USD crypto pairs cannot be
 * misclassified by their punctuation.
 *
 * @param {{ symbol?: string, searchCandidates?: Array<object>, instrument?: object,
 *   overview?: object }} [input]
 */
export function resolveAssetDescriptor(input = {}) {
  const symbol = String(input?.symbol ?? "")
    .trim()
    .toUpperCase();
  const candidate = symbol
    ? (input?.searchCandidates ?? []).find(
        (entry) => String(entry?.symbol ?? "").toUpperCase() === symbol,
      )
    : null;

  // The shared candidate `assetType` collapses currency pairs and futures into
  // `equity`, so the provider quote type is the one that decides here.
  const candidateType = normalizeTypeWord(candidate?.quoteType);
  if (candidateType) {
    return {
      ...assetDescriptor(candidateType),
      typeLabel:
        formatInstrumentTypeLabel(candidate.quoteType) || assetDescriptor(candidateType).typeLabel,
    };
  }

  const savedType = normalizeTypeWord(input?.instrument?.assetType);
  if (savedType) return assetDescriptor(savedType);

  // A company profile is only returned for operating companies, so a populated
  // sector or industry is positive evidence of an equity rather than a guess
  // from the symbol.
  const overview = input?.overview;
  if (
    overview?.status === "ok" &&
    (String(overview.sector ?? "").trim() || String(overview.industry ?? "").trim())
  ) {
    return assetDescriptor("stock");
  }

  return assetDescriptor("unknown");
}
