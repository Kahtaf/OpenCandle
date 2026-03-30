export interface ExtractedPreference {
  key: string;
  value: string;
  confidence: "high" | "medium" | "low";
}

interface PatternRule {
  pattern: RegExp;
  key: string;
  value: string;
  confidence: "high" | "medium" | "low";
}

const PREFERENCE_PATTERNS: PatternRule[] = [
  // Asset scope
  {
    pattern: /\bprefer\s+etfs?\b/i,
    key: "asset_scope",
    value: "etf_focused",
    confidence: "high",
  },
  {
    pattern: /\betf[\s-]*(?:heavy|focused|only)\b/i,
    key: "asset_scope",
    value: "etf_focused",
    confidence: "high",
  },

  // Risk profile
  {
    pattern: /\b(?:i'?m|i\s+am)\s+conservative\b/i,
    key: "risk_profile",
    value: "conservative",
    confidence: "high",
  },
  {
    pattern: /\brisk\s*averse\b/i,
    key: "risk_profile",
    value: "conservative",
    confidence: "high",
  },
  {
    pattern: /\b(?:i'?m|i\s+am)\s+aggressive\b/i,
    key: "risk_profile",
    value: "aggressive",
    confidence: "high",
  },
  {
    pattern: /\baggressive\s+growth\b/i,
    key: "risk_profile",
    value: "aggressive",
    confidence: "high",
  },
  {
    pattern: /\b(?:i'?m|i\s+am)\s+(?:moderate|balanced)\b/i,
    key: "risk_profile",
    value: "balanced",
    confidence: "high",
  },

  // Time horizon
  {
    pattern: /\b(?:12\s*month|one\s*year|1\s*year)\s*horizon/i,
    key: "time_horizon",
    value: "1y_plus",
    confidence: "high",
  },
  {
    pattern: /\blong[\s-]*term\s+(?:invest|hold|horizon)/i,
    key: "time_horizon",
    value: "long",
    confidence: "medium",
  },
  {
    pattern: /\bshort[\s-]*term\s+(?:trad|invest|horizon)/i,
    key: "time_horizon",
    value: "short",
    confidence: "medium",
  },

  // Options liquidity
  {
    pattern: /\b(?:only|prefer)\s+(?:trade\s+)?liquid\s+options?\b/i,
    key: "options_liquidity",
    value: "high",
    confidence: "high",
  },
];

export function extractPreferences(input: string): ExtractedPreference[] {
  const preferences: ExtractedPreference[] = [];
  const seenKeys = new Set<string>();

  for (const rule of PREFERENCE_PATTERNS) {
    if (rule.pattern.test(input) && !seenKeys.has(rule.key)) {
      preferences.push({
        key: rule.key,
        value: rule.value,
        confidence: rule.confidence,
      });
      seenKeys.add(rule.key);
    }
  }

  return preferences;
}
