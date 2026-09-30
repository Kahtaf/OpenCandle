import { hasUnnegatedMarker } from "../text-assertions.js";

// Product-eval risk_framing contract: the answer names downside, uncertainty,
// invalidation, limitations, or tradeoffs. A single fixed keyword regex missed
// real risk framing such as "might be riskier" or a "Where it misleads" section
// whose forecasts "can be inaccurate", and it also accepted empty denials such
// as "there is no downside". This predicate accepts the canonical concept
// families below and rejects a marker whose only occurrence is directly
// negated ("no risk", "zero risk", "without any downside", "not risky") or is
// the negated compound "risk-free"/"riskless". Negation handling lives in the
// shared tests/evals/text-assertions.ts helper.
//
// Concept families (word-bounded, case-insensitive):
// - risk inflections: risk, risks, risky, riskier, riskiest, riskiness
// - downside(s), drawdown(s), loss/losses
// - uncertain, uncertainty/uncertainties
// - invalidate/invalidated/invalidates/invalidating/invalidation(s)
// - caveat(s), limitation(s), trade-off(s)/tradeoff(s)/trade off
// - explicit limitation framing: mislead/misleads/misled/misleading, inaccurate
const RISK_FRAMING_MARKER =
  /\b(?:risk(?:s|y|ier|iest|iness)?|downsides?|drawdowns?|loss(?:es)?|uncertain(?:ty|ties)?|invalidat(?:e|es|ed|ing|ion|ions)|caveats?|limitations?|trade[- ]?offs?|mislead(?:s|ing)?|misled|inaccurate)\b/gi;

// The only compound that empties the risk word itself.
const NEGATED_COMPOUND = /^risk(?:[- ]?free|less)\b/i;

export function hasRiskFraming(text: string): boolean {
  return hasUnnegatedMarker(text, RISK_FRAMING_MARKER, { negatedCompound: NEGATED_COMPOUND });
}
