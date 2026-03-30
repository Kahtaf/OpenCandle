import type { ClassificationResult, WorkflowType, ExtractedEntities } from "./types.js";
import { extractEntities } from "./entity-extractor.js";

interface Rule {
  workflow: WorkflowType;
  test: (input: string, entities: ExtractedEntities) => boolean;
  confidence: number;
}

const ANALYSIS_PATTERNS = [
  /^\s*analyze\s+\$?([A-Za-z]{1,5})\s*$/i,
  /^\s*full\s+analysis\s+(?:of\s+)?\$?([A-Za-z]{1,5})\s*$/i,
  /^\s*deep\s+dive\s+(?:on\s+)?\$?([A-Za-z]{1,5})\s*$/i,
];

const RULES: Rule[] = [
  // Exact-match analysis patterns (highest priority)
  {
    workflow: "single_asset_analysis",
    confidence: 1.0,
    test: (input) => ANALYSIS_PATTERNS.some((p) => p.test(input)),
  },
  {
    workflow: "single_asset_analysis",
    confidence: 0.85,
    test: (input, entities) => {
      const lower = input.toLowerCase();
      return (
        entities.symbols.length === 1 &&
        (/\bis\s+\S+\s+(?:attractive|undervalued|overvalued|cheap|expensive)/i.test(lower) ||
          /\bshould\s+i\s+buy\s+\$?[a-z]{1,5}\b/i.test(lower) ||
          /\bwhat\s+do\s+you\s+think\s+(?:of|about)\s+\$?[a-z]{1,5}\b/i.test(lower))
      );
    },
  },
  // Options: symbol + option keyword
  {
    workflow: "options_screener",
    confidence: 0.95,
    test: (input, entities) => {
      const lower = input.toLowerCase();
      const hasOptionKeywords =
        /\bcalls?\b/.test(lower) ||
        /\bputs?\b/.test(lower) ||
        /\boption(?:s)?\s*chain\b/.test(lower) ||
        /\boptions?\b/.test(lower);
      return hasOptionKeywords && entities.symbols.length >= 1;
    },
  },
  // Compare: keyword + 2+ symbols (uppercase)
  {
    workflow: "compare_assets",
    confidence: 0.95,
    test: (input, entities) => {
      const lower = input.toLowerCase();
      const hasCompareKeywords =
        /\bcompare\b/.test(lower) ||
        /\bvs\.?\b/.test(lower) ||
        /\bversus\b/.test(lower) ||
        /\bwhich\s+is\s+better\b/.test(lower);
      return hasCompareKeywords && entities.symbols.length >= 2;
    },
  },
  // Compare: keyword + lowercase tickers ("Compare aapl and msft")
  {
    workflow: "compare_assets",
    confidence: 0.85,
    test: (input) => {
      const lower = input.toLowerCase();
      return /\bcompare\s+[a-z]{1,5}(?:\s*,?\s*(?:and\s+)?[a-z]{1,5})+/.test(lower);
    },
  },
  // Compare: 2+ uppercase symbols without explicit keyword
  {
    workflow: "compare_assets",
    confidence: 0.8,
    test: (_input, entities) => entities.symbols.length >= 2,
  },
  // Watchlist/tracking: must come before portfolio_builder to catch "show my portfolio"
  {
    workflow: "watchlist_or_tracking",
    confidence: 0.95,
    test: (input) => {
      const lower = input.toLowerCase();
      return (
        /\bwatchlist\b/.test(lower) ||
        /\bprediction/i.test(lower) ||
        /\bshow\s+my\s+portfolio\b/.test(lower) ||
        /\bmy\s+portfolio\b/.test(lower) ||
        /\btrack\b/.test(lower)
      );
    },
  },
  // Portfolio: budget + invest keyword
  {
    workflow: "portfolio_builder",
    confidence: 0.9,
    test: (input, entities) => {
      const lower = input.toLowerCase();
      return (
        entities.budget !== undefined &&
        (/\binvest\b/.test(lower) ||
          /\bportfolio\b/.test(lower) ||
          /\ballocat/i.test(lower) ||
          /\bposition/i.test(lower) ||
          /\bbuy\b/.test(lower))
      );
    },
  },
  // Portfolio: keyword-only (no budget required)
  {
    workflow: "portfolio_builder",
    confidence: 0.8,
    test: (input) => {
      const lower = input.toLowerCase();
      return (
        /\bportfolio\b/.test(lower) ||
        /\bwhat\s+should\s+i\s+(?:invest|buy)\b/.test(lower) ||
        /\bbuild\s+(?:me\s+)?a?\s*(?:diversified\s+)?.*portfolio\b/.test(lower) ||
        (/\binvest\s+in\b/.test(lower) && /\bwhat\b/.test(lower))
      );
    },
  },
  // General finance Q&A
  {
    workflow: "general_finance_qa",
    confidence: 0.85,
    test: (input) => {
      const lower = input.toLowerCase();
      return (
        /^what\s+(?:is|are|does|do)\b/.test(lower) ||
        /^how\s+(?:does|do|is|are)\b/.test(lower) ||
        /^explain\b/.test(lower) ||
        /^define\b/.test(lower) ||
        /\bwhat\s+does\s+\S+\s+mean\b/.test(lower)
      );
    },
  },
];

export function classifyIntent(input: string): ClassificationResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return {
      workflow: "unclassified",
      confidence: 0,
      tier: "rule",
      entities: { symbols: [] },
    };
  }

  const entities = extractEntities(trimmed);

  for (const rule of RULES) {
    if (rule.test(trimmed, entities)) {
      return {
        workflow: rule.workflow,
        confidence: rule.confidence,
        tier: "rule",
        entities,
      };
    }
  }

  return {
    workflow: "unclassified",
    confidence: 0,
    tier: "rule",
    entities,
  };
}
