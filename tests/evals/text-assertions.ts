// Shared negation- and echo-aware text predicates for deterministic eval
// assertions. Bare keyword regexes over a final answer produce false passes
// (a marker only mentioned to deny it, or a sentence that just restates the
// prompt) and false fails (a forbidden phrase that the answer explicitly
// rejects). Assertions should combine these predicates with structured trace
// evidence (tool args, tool results, ask_user transcript) whenever the trace
// already holds the fact.

/**
 * A negation that is directly attached to a marker, optionally through a small
 * set of quantifier/intensifier words ("no real risk", "not a verdict",
 * "without any downside"). An unrelated clause negation ("do not ignore the
 * downside") is not a denial of the marker.
 */
const ATTACHED_NEGATION =
  /\b(?:no|not|zero|without|never|nor|isn't|aren't|wasn't|weren't|doesn't|don't|won't|cannot|can't)(?:[\s-]+(?:any|real|clear|meaningful|significant|material|major|much|a|an|the|be|really|particularly|very))*[\s-]+$/i;

/**
 * Words that may sit between a rejecting cue and the forbidden phrase: function
 * words and request/recommendation verbs ("not a recommendation to buy a
 * covered call", "instead of converting this into a bull call spread"). Any
 * other word breaks the rejection, so "you can't beat a covered call", "no
 * doubt a bull call spread", and "not only buy a bull call" stay affirmative.
 */
const REJECTION_FILLER =
  "(?:a|an|the|this|that|these|those|any|to|into|for|with|as|be|it|you|we|i|me|us|your|our|need|needs|want|wants|recommend\\w*|suggest\\w*|advis\\w*|propos\\w*|use|using|buy|buying|sell|selling|write|writing|open|opening|do|doing|go|going|switch\\w*|turn\\w*|convert\\w*|share|sharing|provide|providing|give|giving|ask|asking|pick|picking|choose|choosing|trade|trading|enter|entering|simply|here)";

/**
 * A negation or contrast cue that rejects the phrase that follows it within
 * the same clause: "not a covered call", "rather than a bull call spread",
 * "you don't need to share a budget", "unlike a covered call". At most five
 * filler words may sit between the cue and the phrase.
 */
const REJECTING_CUE = new RegExp(
  `\\b(?:no|not|never|without|nor|isn't|aren't|wasn't|weren't|doesn't|don't|won't|cannot|can't|rather than|instead of|as opposed to|unlike)(?:[\\s-]+${REJECTION_FILLER}){0,5}[\\s-]+$`,
  "i",
);

/**
 * A rejection that follows the forbidden phrase in its clause: "a covered call
 * is not appropriate here", "a bull call spread won't protect your shares",
 * "a covered call would be the wrong tool". A trailing negation that does not
 * reject the strategy ("a covered call isn't expensive") does not count.
 */
const TRAILING_REJECTION =
  /^(?:\s+(?:spreads?|strateg(?:y|ies)|trades?|positions?|here|instead|on\s+[a-z]{1,5}|for\s+you))*\s+(?:(?:(?:is|are|would be|will be)\s+not|isn't|aren't|wouldn't be|won't be)\s+(?:really\s+|actually\s+)?(?:appropriate|suitable|recommended|advisable|right|the (?:right|best|correct)|a (?:good|fit|hedge|substitute|protective)|an? (?:option|alternative|answer)|what you|protection|protective)|(?:won't|wouldn't|will not|would not|doesn't|does not|can't|cannot)\s+(?:protect|hedge|limit)|(?:is|are|would be)\s+(?:the\s+)?(?:wrong|inappropriate|unsuitable|a mistake))\b/i;

/**
 * A predicate that denies the marker it follows in the same clause: "risk is
 * nonexistent", "position size is not a concern", "gap risk doesn't matter",
 * "hedging is unnecessary". The predicate must end the clause (optionally
 * through "here", "at all", "for you", ...), so "the risk is not a concern you
 * can ignore" and "the downside is not limited" stay affirmative.
 */
const TRAILING_DENIAL =
  /^[^.;!?,\n]{0,30}?\b(?:(?:is|are|was|were|seems?|remains?)\s+(?:not\s+(?:a|an)\s+(?:concern|issue|factor|problem|worry)|not\s+(?:relevant|needed|necessary|applicable)|nonexistent|non-existent|irrelevant|unnecessary|zero|nil)|(?:isn't|aren't|wasn't|weren't)\s+(?:(?:a|an)\s+(?:concern|issue|factor|problem|worry)|relevant|needed|necessary|applicable)|(?:doesn't|does not|don't|do not)\s+(?:matter|apply))(?:\s+(?:here|at all|tonight|today|now|(?:for|in|with)\s+(?:you|this|that|your|the)(?:\s+\w+)?))?\s*(?:[.;,!?\n]|$)/i;

const CLAUSE_BREAKS = ".;!?,\n";

export interface MarkerOptions {
  /**
   * Anchored pattern tested against the text starting at the marker. A match
   * means the marker is part of a compound that empties it ("risk-free",
   * "riskless"), so that occurrence does not count.
   */
  negatedCompound?: RegExp;
}

/** Start index of the clause containing `index` (after the last , ; . ! ? or newline). */
export function clauseStart(text: string, index: number): number {
  for (let i = index - 1; i >= 0; i -= 1) {
    if (CLAUSE_BREAKS.includes(text[i])) {
      // A period between two digits is a decimal point, not a clause break.
      if (text[i] === "." && /\d/.test(text[i - 1] ?? "") && /\d/.test(text[i + 1] ?? "")) {
        continue;
      }
      return i + 1;
    }
  }
  return 0;
}

function globalPattern(pattern: RegExp): RegExp {
  return pattern.global ? pattern : new RegExp(pattern.source, `${pattern.flags}g`);
}

function* occurrences(text: string, pattern: RegExp): Generator<{ index: number; end: number }> {
  for (const match of text.matchAll(globalPattern(pattern))) {
    if (match.index !== undefined) yield { index: match.index, end: match.index + match[0].length };
  }
}

/**
 * True when at least one occurrence of `marker` is affirmative: not directly
 * negated inside its own clause, not denied by the predicate that follows it
 * ("risk is nonexistent"), and not part of a caller-declared negated compound.
 */
export function hasUnnegatedMarker(
  text: string,
  marker: RegExp,
  options: MarkerOptions = {},
): boolean {
  for (const { index, end } of occurrences(text, marker)) {
    if (options.negatedCompound?.test(text.slice(index))) continue;
    if (ATTACHED_NEGATION.test(text.slice(clauseStart(text, index), index))) continue;
    if (TRAILING_DENIAL.test(text.slice(end))) continue;
    return true;
  }
  return false;
}

/**
 * True when at least one occurrence of a forbidden `pattern` is affirmed: not
 * rejected by a negation or contrast cue in the same clause ("not a covered
 * call", "rather than a bull call", "you don't need to share a budget") or by
 * a rejection right after it ("a covered call is not appropriate here").
 */
export function affirmsForbidden(text: string, pattern: RegExp): boolean {
  for (const { index, end } of occurrences(text, pattern)) {
    if (REJECTING_CUE.test(text.slice(clauseStart(text, index), index))) continue;
    if (TRAILING_REJECTION.test(text.slice(end))) continue;
    return true;
  }
  return false;
}

/** Sentence or line units; decimals such as "2.15" never split. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

const ECHO_LEAD =
  /^[\W_]*(?:you(?:'re| are)? ask(?:ed|ing)|your question\b|the question is\b|you want to know\b|you(?:'d| would) like to know\b)/i;
const ECHO_NGRAM = 6;

function ngrams(tokens: string[], size: number): Set<string> {
  const grams = new Set<string>();
  for (let i = 0; i + size <= tokens.length; i += 1) {
    grams.add(tokens.slice(i, i + size).join(" "));
  }
  return grams;
}

const WORD = /[a-z0-9]+(?:'[a-z]+)?/gi;

function words(text: string): string[] {
  return text.toLowerCase().match(WORD) ?? [];
}

/**
 * Remove every run of at least six consecutive words copied from the prompt,
 * keeping the rest of the sentence ("Because you hold 300 shares of ZZZZ and
 * earnings are tonight, this is an oversized position" keeps "this is an
 * oversized position"). Returns an empty string when nothing but echo and
 * punctuation remains.
 */
function stripEchoedRuns(sentence: string, promptGrams: Set<string>): string {
  const tokens = [...sentence.matchAll(WORD)].map((match) => ({
    word: match[0].toLowerCase(),
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
  const covered = new Array<boolean>(tokens.length).fill(false);
  for (let i = 0; i + ECHO_NGRAM <= tokens.length; i += 1) {
    const gram = tokens
      .slice(i, i + ECHO_NGRAM)
      .map((token) => token.word)
      .join(" ");
    if (promptGrams.has(gram)) covered.fill(true, i, i + ECHO_NGRAM);
  }
  if (!covered.includes(true)) return sentence;
  let result = "";
  let cursor = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    if (!covered[i] || (i > 0 && covered[i - 1])) continue;
    let last = i;
    while (last + 1 < tokens.length && covered[last + 1]) last += 1;
    result += sentence.slice(cursor, tokens[i].start);
    cursor = tokens[last].end;
  }
  result += sentence.slice(cursor);
  return /[a-z0-9]/i.test(result) ? result.trim() : "";
}

/**
 * Remove prompt restatement: a sentence with an explicit restatement lead-in
 * ("You asked whether...", "Your question is...") is dropped, and any run of at
 * least six consecutive words copied from the prompt is cut out of its
 * sentence while the sentence's own clauses stay. What remains is the answer's
 * own content, so a framework check cannot pass on an echoed prompt.
 */
export function withoutPromptEcho(text: string, prompt: string): string {
  const promptGrams = ngrams(words(prompt), ECHO_NGRAM);
  const sentences = splitSentences(text);
  let changed = false;
  const kept: string[] = [];
  for (const sentence of sentences) {
    if (ECHO_LEAD.test(sentence)) {
      changed = true;
      continue;
    }
    const content = promptGrams.size === 0 ? sentence : stripEchoedRuns(sentence, promptGrams);
    if (content !== sentence) changed = true;
    if (content) kept.push(content);
  }
  return changed ? kept.join("\n") : text;
}
