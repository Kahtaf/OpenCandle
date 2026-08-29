export function isStatefulTrackingRequest(input: string): boolean {
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
