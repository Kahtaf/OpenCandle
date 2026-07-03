import { extractEntities } from "./entity-extractor.js";
import type { ClassificationResult, ExtractedEntities, WorkflowType } from "./types.js";

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
          /\bwhat\s+do\s+you\s+think\s+(?:of|about)\s+\$?[a-z]{1,5}\b/i.test(lower) ||
          /\bbull\s+(?:and|or)\s+bear\s+case\b/i.test(lower))
      );
    },
  },
  // Portfolio risk for existing holdings must route before multi-symbol compare.
  {
    workflow: "watchlist_or_tracking",
    confidence: 0.9,
    test: (input, entities) => {
      const lower = input.toLowerCase();
      return (
        entities.symbols.length >= 1 &&
        (/\bi\s+own\b/.test(lower) || /\bmy\s+holdings\b/.test(lower)) &&
        (/\bportfolio\s+risk\b/.test(lower) ||
          /\bbiggest\s+risk\b/.test(lower) ||
          /\bconcentration\b/.test(lower))
      );
    },
  },
  // News / event queries — symbol or topic + news keywords
  // Must come before compare_assets to prevent "NVDA and AI chip exports" from
  // matching as a 2-symbol comparison.
  {
    workflow: "general_finance_qa",
    confidence: 0.9,
    test: (input) => {
      const lower = input.toLowerCase();
      const hasNewsKeyword =
        /\bnews\b/.test(lower) ||
        /\blatest\b/.test(lower) ||
        /\brecent\b/.test(lower) ||
        /\bhappening\b/.test(lower) ||
        /\bannouncement/.test(lower) ||
        /\binvestigation\b/.test(lower) ||
        /\bregulat/.test(lower) ||
        /\blawsuit\b/.test(lower) ||
        /\btariff/.test(lower) ||
        /\bexport/.test(lower) ||
        /\bupdate\b/.test(lower);
      return hasNewsKeyword;
    },
  },
  // Tool-backed finance tasks that are not a structured multi-step workflow.
  {
    workflow: "general_finance_qa",
    confidence: 0.9,
    test: (input, entities) => {
      const lower = input.toLowerCase();
      const hasOptionKeywords = hasOptionKeywordsInText(lower);
      const hasCompareKeywords =
        /\bcompare\b/.test(lower) ||
        /\bvs\.?\b/.test(lower) ||
        /\bversus\b/.test(lower) ||
        /\bwhich\s+is\s+better\b/.test(lower);

      if (hasOptionKeywords && entities.symbols.length >= 1) return false;
      if (hasCompareKeywords && entities.symbols.length >= 2) return false;

      return (
        /\bbacktest\b/.test(lower) || /\bsentiment\b/.test(lower) || /\brate\s+cuts?\b/.test(lower)
      );
    },
  },
  // Broad market / sector / macro research that should receive the general
  // analyst fallback rather than disappearing into an unclassified turn.
  {
    workflow: "general_finance_qa",
    confidence: 0.85,
    test: (input) => {
      const lower = input.toLowerCase();
      const hasResearchVerb =
        /\banaly[sz]e\b/.test(lower) ||
        /\bevaluat(?:e|ion)\b/.test(lower) ||
        /\breview\b/.test(lower) ||
        /\bdiscuss\b/.test(lower) ||
        /\bpredict\b/.test(lower) ||
        /\bassess\b/.test(lower) ||
        /^what\b/.test(lower);
      const hasBroadFinanceTopic =
        /\bmarket\s+structure\b/.test(lower) ||
        /\b(?:sector|industry)\b/.test(lower) ||
        /\bmacro\s+risks?\b/.test(lower) ||
        /\bmonetary\s+policy\b/.test(lower) ||
        /\bemerging\s+markets?\b/.test(lower) ||
        /\bcapital\s+flows?\b/.test(lower) ||
        /\bcurrency\s+fluctuations?\b/.test(lower) ||
        /\binflation\b/.test(lower);
      return hasResearchVerb && hasBroadFinanceTopic;
    },
  },
  // Existing allocation / portfolio review. This is not portfolio construction
  // and should not require a budget.
  {
    workflow: "general_finance_qa",
    confidence: 0.85,
    test: (input) => isPortfolioEvaluationRequest(input),
  },
  // Options: symbol + option keyword
  {
    workflow: "options_screener",
    confidence: 0.95,
    test: (input, entities) => {
      const lower = input.toLowerCase();
      return hasOptionKeywordsInText(lower) && entities.symbols.length >= 1;
    },
  },
  // Stateful portfolio/watchlist/alert mutations must not be mistaken for
  // compare or portfolio-construction workflows just because a cost basis,
  // target, or currency token is present.
  {
    workflow: "watchlist_or_tracking",
    confidence: 0.95,
    test: (input) => isStatefulTrackingRequest(input),
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
    test: (input, entities) => {
      const lower = input.toLowerCase();
      return (
        entities.symbols.length >= 2 &&
        /\bcompare\s+[a-z]{1,5}\b(?:\s*,?\s*(?:and\s+)?[a-z]{1,5}\b)+/.test(lower)
      );
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

/**
 * @deprecated Use the LLM router (`route`) for new classification paths; keep this only for rules-mode fallback and deterministic safety nets.
 */
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

function isPortfolioEvaluationRequest(input: string): boolean {
  const lower = input.toLowerCase();
  const hasEvaluationIntent =
    /\b(?:evaluat(?:e|ion)|review|assess|analy[sz]e|prospects?|risks?|risky|opportunities?|mitigat(?:e|ion)|adjust(?:ment)?|change|rebalance|diversify|concentration|overweight|underweight|expos(?:ed|ure)|target\s+bands?|drift|worried|crash|protect|protection|missing\s+out\s+on\s+growth)\b/.test(
      lower,
    );
  const hasExplicitPortfolioSubject =
    /\b(?:portfolio|allocation|asset\s+allocation|60\/40|holdings?|positions?)\b/.test(lower);
  const hasOwnedAssetMix =
    /\b(?:my|current|have|holding|hold|own|invested|positions?|\d+(?:\.\d+)?%)\b/.test(lower) &&
    /\b(?:equity|fixed\s+income|bonds?|cash|stocks?|etfs?|funds?)\b/.test(lower);
  const hasConstructionIntent =
    /\b(?:build|create|construct|put\s+together|invest|allocate)\b/.test(lower) &&
    /\$\s*\d|\b\d+(?:\.\d+)?\s*k\b|\bbudget\b|\bcapital\b/.test(lower);
  return (
    hasEvaluationIntent &&
    (hasExplicitPortfolioSubject || hasOwnedAssetMix) &&
    !hasConstructionIntent
  );
}

function hasOptionKeywordsInText(lower: string): boolean {
  return (
    /\bcalls?\b(?!\s+out\b)/.test(lower) ||
    /\bputs?\b/.test(lower) ||
    /\boption(?:s)?\s*chain\b/.test(lower) ||
    /\boptions?\b/.test(lower)
  );
}

function isStatefulTrackingRequest(input: string): boolean {
  const lower = input.toLowerCase();
  const hasPortfolioConstructionIntent =
    /\b(?:build|create|construct|put\s+together)\b/.test(lower) &&
    /\bportfolio\b/.test(lower) &&
    /\$\s*\d|\b\d+(?:\.\d+)?\s*k\b|\bbudget\b|\bcapital\b/.test(lower);
  const hasStateVerb =
    /\b(?:add|remove|update|record|track|create|configure|check|show|list|view|cancel)\b/.test(
      lower,
    );
  const hasStateObject =
    /\b(?:watchlist|portfolio|holding|holdings|position|positions|alert|alerts|daily\s+report|watchlist\s+report|report\s+history)\b/.test(
      lower,
    );
  const hasPortfolioLotShape =
    /\b(?:add|record|track)\b/.test(lower) &&
    /\b\d+(?:\.\d+)?\s+shares?\b/.test(lower) &&
    /\b(?:portfolio|holding|holdings|position|positions)\b/.test(lower);
  if (hasPortfolioConstructionIntent) return false;
  return (hasStateVerb && hasStateObject) || hasPortfolioLotShape;
}

const FINANCE_SIGNAL_TERMS = [
  "stock",
  "stocks",
  "shares",
  "ticker",
  "tickers",
  "etf",
  "etfs",
  "ipo",
  "earnings",
  "dividend",
  "dividends",
  "valuation",
  "stock market",
  "invest",
  "investing",
  "investment",
  "portfolio",
  "watchlist",
  "bond",
  "bonds",
  "bond yield",
  "treasury",
  "the fed",
  "inflation",
  "interest rates",
  "crypto",
  "bitcoin",
  "ethereum",
  "options chain",
  "covered call",
  "puts",
  "bullish",
  "bearish",
  "hedge",
  "price target",
  "cost basis",
  "nasdaq",
  "s&p",
];

const FINANCE_SIGNAL_PATTERN = new RegExp(
  `\\b(?:${FINANCE_SIGNAL_TERMS.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
  "i",
);

/**
 * Deterministic finance-vocabulary check for rules-mode fallback turns whose
 * intent did not match a workflow and whose entities carry no symbols (for
 * example theme prompts about private companies or sectors).
 */
export function hasFinanceSignals(input: string): boolean {
  return FINANCE_SIGNAL_PATTERN.test(input);
}
