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
 * A negation or contrast cue that rejects the phrase that follows it within
 * the same clause: "not a covered call", "rather than a bull call spread",
 * "you don't need to share a budget", "unlike a covered call". At most three
 * words may sit between the cue and the phrase.
 */
const REJECTING_CUE =
  /\b(?:no|not|never|without|nor|isn't|aren't|wasn't|weren't|doesn't|don't|won't|cannot|can't|rather than|instead of|as opposed to|unlike)(?:[\s-]+[\w'$-]+){0,3}[\s-]+$/i;

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

function* occurrences(text: string, pattern: RegExp): Generator<number> {
  for (const match of text.matchAll(globalPattern(pattern))) {
    if (match.index !== undefined) yield match.index;
  }
}

/**
 * True when at least one occurrence of `marker` is affirmative: not directly
 * negated inside its own clause and not part of a caller-declared negated
 * compound.
 */
export function hasUnnegatedMarker(
  text: string,
  marker: RegExp,
  options: MarkerOptions = {},
): boolean {
  for (const index of occurrences(text, marker)) {
    if (options.negatedCompound?.test(text.slice(index))) continue;
    if (ATTACHED_NEGATION.test(text.slice(clauseStart(text, index), index))) continue;
    return true;
  }
  return false;
}

/**
 * True when at least one occurrence of a forbidden `pattern` is affirmed: not
 * rejected by a negation or contrast cue in the same clause ("not a covered
 * call", "rather than a bull call", "you don't need to share a budget").
 */
export function affirmsForbidden(text: string, pattern: RegExp): boolean {
  for (const index of occurrences(text, pattern)) {
    if (REJECTING_CUE.test(text.slice(clauseStart(text, index), index))) continue;
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

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+(?:'[a-z]+)?/g) ?? [];
}

function ngrams(tokens: string[], size: number): Set<string> {
  const grams = new Set<string>();
  for (let i = 0; i + size <= tokens.length; i += 1) {
    grams.add(tokens.slice(i, i + size).join(" "));
  }
  return grams;
}

/**
 * Drop sentences that only restate the user's request: an explicit restatement
 * lead-in ("You asked whether...", "Your question is...") or a run of at least
 * six consecutive words copied from the prompt. What remains is the answer's
 * own content, so a framework check cannot pass on an echoed prompt.
 */
export function withoutPromptEcho(text: string, prompt: string): string {
  const promptGrams = ngrams(words(prompt), ECHO_NGRAM);
  const sentences = splitSentences(text);
  const kept = sentences.filter((sentence) => {
    if (ECHO_LEAD.test(sentence)) return false;
    if (promptGrams.size === 0) return true;
    for (const gram of ngrams(words(sentence), ECHO_NGRAM)) {
      if (promptGrams.has(gram)) return false;
    }
    return true;
  });
  return kept.length === sentences.length ? text : kept.join("\n");
}
