const SLOT_TO_PREF_KEYS: Readonly<Record<string, readonly string[]>> = {
  riskProfile: ["risk_profile"],
  assetScope: ["asset_scope"],
  timeHorizon: ["time_horizon"],
  dteTarget: ["dte_target"],
  moneynessPreference: ["moneyness_preference"],
  liquidityMinimum: ["liquidity_minimum", "options_liquidity"],
};

export function preferenceKeysForOverriddenSlots(overriddenSlots?: string[]): Set<string> {
  const suppressedKeys = new Set<string>();
  for (const slot of overriddenSlots ?? []) {
    for (const key of SLOT_TO_PREF_KEYS[slot] ?? []) {
      suppressedKeys.add(key);
    }
  }
  return suppressedKeys;
}
