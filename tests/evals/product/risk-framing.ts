// Product-eval risk_framing contract: the answer names downside, uncertainty,
// invalidation, limitations, or tradeoffs. A single fixed keyword regex missed
// real risk framing such as "might be riskier" or a "Where it misleads" section
// whose forecasts "can be inaccurate", and it also accepted empty denials such
// as "there is no downside". This predicate accepts the canonical concept
// families below and rejects a marker whose only occurrence is directly
// negated ("no risk", "zero risk", "without any downside", "not risky") or is
// the negated compound "risk-free"/"riskless".
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

// A negation counts only when directly attached to the marker, optionally
// through a small set of quantifier/intensifier words. An unrelated clause
// negation ("do not ignore the downside") is not a denial of the risk.
const ATTACHED_NEGATION =
  /\b(?:no|not|zero|without|never|nor|isn't|aren't|wasn't|weren't|doesn't|don't|won't|cannot|can't)(?:[\s-]+(?:any|real|meaningful|significant|material|major|much|a|an|the|be|really|particularly|very))*[\s-]+$/i;

export function hasRiskFraming(text: string): boolean {
  for (const match of text.matchAll(RISK_FRAMING_MARKER)) {
    const index = match.index;
    if (index === undefined) continue;
    if (NEGATED_COMPOUND.test(text.slice(index))) continue;
    if (ATTACHED_NEGATION.test(text.slice(clauseStart(text, index), index))) continue;
    return true;
  }
  return false;
}

function clauseStart(text: string, index: number): number {
  for (let i = index - 1; i >= 0; i -= 1) {
    if (".;!?,\n".includes(text[i])) return i + 1;
  }
  return 0;
}
