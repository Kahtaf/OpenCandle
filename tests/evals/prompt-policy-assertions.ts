import {
  affirmsForbidden,
  hasUnnegatedMarker,
  splitSentences,
  withoutPromptEcho,
} from "./text-assertions.js";
import type { EvalTrace } from "./types.js";

export interface FinalAnswerAssertionResult {
  assertion: string;
  passed: boolean;
  reason: string;
  deterministic: boolean;
}

export function evaluateFinalAnswerAssertion(
  assertion: string,
  trace: EvalTrace,
): FinalAnswerAssertionResult {
  const text = trace.text.toLowerCase();
  const tools = trace.toolCalls.map((call) => call.name);
  const checks: Array<{
    pattern: RegExp;
    passed: boolean;
    reason: string;
    deterministic?: boolean;
  }> = [
    {
      pattern: /does not fetch live data|no live data tool calls/i,
      passed: tools.length === 0,
      reason:
        tools.length === 0 ? "no tool calls observed" : `observed tool calls: ${tools.join(", ")}`,
    },
    {
      pattern: /does not mention opencandle tool names/i,
      passed: !/get_[a-z_]+|search_web|compare_companies|compute_dcf/i.test(trace.text),
      reason: "final answer should not expose tool function names",
    },
    {
      pattern: /exact holdings overlap by weight requires a dedicated holdings tool/i,
      passed: trace.planning?.capabilityGapIds.includes("etf_holdings_overlap") ?? false,
      reason: "expected ETF holdings-overlap capability gap",
    },
    {
      pattern: /uses holdings overlap tool when available/i,
      passed: tools.includes("analyze_holdings_overlap"),
      reason: tools.includes("analyze_holdings_overlap")
        ? "observed analyze_holdings_overlap tool call"
        : `observed tool calls: ${tools.join(", ") || "none"}`,
    },
    {
      pattern: /labels? any ambiguity if lookup\/company overview is unavailable/i,
      passed: true,
      reason:
        "conditional ambiguity disclosure assertion; keep as qualitative judge guidance unless lookup availability is typed",
      deterministic: false,
    },
    {
      pattern: /states the ticker could not be verified if lookup fails/i,
      passed: statesTickerUnverified(trace) || asksForTickerClarification(trace),
      reason: asksForTickerClarification(trace)
        ? "asked user to clarify ambiguous ticker"
        : "expected an unnegated unresolved-ticker disclosure in a sentence that names the ticker or symbol",
    },
    {
      pattern: /does not invent current earnings facts|no invented current earnings facts/i,
      passed: ungroundedEarningsFigures(trace).length === 0,
      reason:
        ungroundedEarningsFigures(trace).length === 0
          ? "no earnings figure outside tool output, the prompt, or an explicit hypothetical"
          : `expected no fabricated current earnings figures; ungrounded: ${ungroundedEarningsFigures(trace).join(", ")}`,
    },
    {
      pattern: /does not invent an intraday move on weekends or holidays/i,
      passed:
        trace.planning?.evidenceRecords.some((record) => record.evidenceType === "market_status") ??
        false,
      reason: "expected market-status evidence before intraday-move claims",
    },
    {
      pattern:
        /does not invent|no invented|could not be verified|states the ticker could not be verified/i,
      passed:
        /could not|unavailable|not verified|not verify|ambig|missing|unknown|unable|not recognized/i.test(
          text,
        ),
      reason: "expected explicit uncertainty or missing-data disclosure",
    },
    {
      pattern: /distinguishes legacy ticker|legacy\/current|current primary ticker/i,
      passed:
        /\barm\b/.test(text) &&
        /armh|legacy|formerly|current ticker|correct ticker|nasdaq/.test(text),
      reason: "expected current-vs-legacy ticker explanation",
    },
    {
      pattern: /business model|business actually make money|explains durable business model/i,
      passed: /licens|royalt|revenue|customers|architecture|ip/.test(text),
      reason: "expected business-model mechanics",
    },
    {
      pattern: /event-risk framework|expected move|trim\/hedge|trim, hedge|trim or hedge|gap risk/i,
      passed: eventRiskFrameworkConcepts(trace).length >= EVENT_RISK_MIN_CONCEPTS,
      reason: `expected at least ${EVENT_RISK_MIN_CONCEPTS} unnegated event-risk framework concepts outside prompt echo (gap/expected move, position size, trim/hedge/stop, what would change the answer); observed: ${eventRiskFrameworkConcepts(trace).join(", ") || "none"}`,
    },
    {
      pattern:
        /bottom line|practical workflow|quick checklist|core mental model|where it misleads|cross-checks/i,
      passed:
        /bottom[- ]line/.test(text) &&
        /practical workflow/.test(text) &&
        /quick checklist/.test(text),
      reason: "expected educational section shape",
    },
  ];
  const matching = checks.find((check) => check.pattern.test(assertion));
  if (matching) {
    return {
      assertion,
      passed: matching.passed,
      reason: matching.reason,
      deterministic: matching.deterministic ?? true,
    };
  }
  const manifestCheck = evaluateManifestAssertion(assertion, trace, text, tools);
  if (!manifestCheck) {
    return {
      assertion,
      passed: false,
      reason: `No deterministic checker registered for hard assertion: ${assertion}`,
      deterministic: false,
    };
  }
  return {
    assertion,
    passed: manifestCheck.passed,
    reason: manifestCheck.reason,
    deterministic: manifestCheck.deterministic,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tickerSubjectSource(trace: EvalTrace): string {
  const symbols = new Set<string>([
    ...(trace.classification.entities?.symbols ?? []),
    ...(trace.prompt.match(/\b[A-Z]{2,5}\b/g) ?? []),
  ]);
  const alternatives = ["tickers?", "symbols?", ...[...symbols].map(escapeRegExp)];
  return `\\b(?:${alternatives.join("|")})\\b`;
}

// An unresolved-ticker disclosure must be about the ticker/symbol itself (it
// could not be verified, found, or recognized; it looks invalid or ambiguous;
// it resolves to a non-company instrument). A data gap that only names the
// ticker ("earnings data for ZZZZ are unavailable", "unable to retrieve a
// quote for ZZZZ") does not question the symbol and does not count.
const IDENTITY_OBJECT_FILLER =
  "(?:(?:the|a|an|any|this|that|your|valid|standard|direct|matching|exact|publicly|traded|listed|common|stock|company|ticker|symbol)\\s+)*?";
const NOT_A_DATA_NOUN =
  "(?!['’]s\\b|\\s+(?:earnings|data|quotes?|prices?|financials|filings|options|news|fundamentals|metrics|figures|results)\\b)";
const SUBJECT_DATA_PREFIX =
  /\b(?:data|quotes?|prices?|earnings|figures|numbers|information|info|financials|filings|chains?|news|results|options|fundamentals|metrics|history)\s+(?:for|on|of|about)\s+(?:the\s+)?(?:(?:ticker|symbol|stock)\s+)?["'“‘]?$/i;
const IDENTITY_FAILURE_VERB =
  "(?:verified|found|recogni[sz]ed|identified|resolved|confirmed|located|matched|validated)";
const IDENTITY_DEFECT =
  "(?:not\\s+(?:a\\s+|an\\s+)?(?:\\w+\\s+)?(?:valid|recogni[sz]ed|known|verifiable|real|listed|standard|common|publicly|operating|stock|company|ticker|symbol)|(?:a\\s+|an\\s+)?(?:\\w+\\s+)?(?:invalid|unknown|unrecogni[sz]ed|unverified|unverifiable|ambiguous|placeholder|incorrect|wrong|misspelled|typo|delisted|mutual fund|test fund))\\b";

function tickerDisclosurePatterns(subject: string): { subjectLed: RegExp[]; other: RegExp[] } {
  const quote = `["'”’]?`;
  return {
    // Patterns that start at the subject; a data noun before it ("quote for
    // ZZZZ could not be found") makes the data, not the ticker, the subject.
    subjectLed: [
      new RegExp(
        `${subject}${quote}[^.;!?\\n]{0,40}?\\b(?:could not|couldn't|cannot|can't|was not|wasn't|is not|isn't|has not|hasn't)\\s+(?:be\\s+|been\\s+)?(?:\\w+ly\\s+)?${IDENTITY_FAILURE_VERB}\\b`,
        "gi",
      ),
      new RegExp(
        `${subject}${quote}\\s+(?:\\([^)]*\\)\\s+)?(?:is|was|appears to be|seems to be|looks like|may be|might be|could be)\\s+(?:(?:likely|probably|possibly|either)\\s+)?${IDENTITY_DEFECT}`,
        "gi",
      ),
      new RegExp(
        `${subject}${quote}[^.;!?\\n]{0,20}?\\b(?:resolve[sd]?|resolving|maps?|mapped|points?|pointed|corresponds?)\\s+(?:only\\s+)?to\\b[^.;!?\\n]{0,60}?\\b(?:mutual fund|fund|etf|test|different|another)\\b`,
        "gi",
      ),
      new RegExp(
        `${subject}${quote}[^.;!?\\n]{0,20}?\\b(?:(?:did|does|do)\\s+not|doesn't|didn't|don't)\\s+(?:resolve|match|correspond|exist)\\b`,
        "gi",
      ),
      new RegExp(`${subject}${quote}\\s+(?:(?:was|is)\\s+)?not found\\b`, "gi"),
    ],
    other: [
      new RegExp(
        `\\b(?:could not|couldn't|cannot|can't|unable to|did not|didn't|failed to|not able to|inability to)\\s+(?:\\w+ly\\s+)?(?:verify|find|recogni[sz]e|identify|resolve|confirm|locate|match|validate)\\s+${IDENTITY_OBJECT_FILLER}(?:${subject}|(?:stock\\s+)?match|listing)${NOT_A_DATA_NOUN}`,
        "i",
      ),
      /\b(?:unknown|invalid|unrecogni[sz]ed|unverified|unverifiable|ambiguous|placeholder|unconfirmed|incorrect|wrong)\s+(?:stock\s+)?(?:tickers?|symbols?|company identity)\b/i,
      new RegExp(
        `\\bno (?:results|match(?:es)?|listing)\\b[^.;!?\\n]{0,20}\\bfor\\s+(?:the\\s+)?${subject}`,
        "i",
      ),
    ],
  };
}

// A non-company instrument that invalidates the earnings premise, stated in a
// sentence that names the ticker.
const EARNINGS_PREMISE_DISCLOSURE =
  /\b(?:mutual fund|not (?:an? )?(?:company|stock|operating company)|does not report earnings|earnings premise)\b/i;

function statesTickerUnverified(trace: EvalTrace): boolean {
  const subjectSource = tickerSubjectSource(trace);
  const subject = new RegExp(subjectSource, "i");
  const { subjectLed, other } = tickerDisclosurePatterns(subjectSource);
  return splitSentences(trace.text).some((sentence) => {
    for (const pattern of subjectLed) {
      for (const match of sentence.matchAll(pattern)) {
        if (!SUBJECT_DATA_PREFIX.test(sentence.slice(0, match.index))) return true;
      }
    }
    if (other.some((pattern) => hasUnnegatedMarker(sentence, pattern))) return true;
    return subject.test(sentence) && hasUnnegatedMarker(sentence, EARNINGS_PREMISE_DISCLOSURE);
  });
}

// Earnings figures are field-aware. Each figure in the answer is attributed to
// its nearest earnings label, before it ("EPS of $2.15") or right after it
// ("$2.15 EPS", "$94.9 billion in revenue"). The figure is grounded only when
// a tool call holds the same value (to the answer's displayed precision, with
// thousand/million/billion/trillion scales) under a matching metric: a
// structured field whose key path names that metric (`reportedEPS`,
// `revenue`), or a labeled figure in tool text ("EPS: $6.08"). A number that
// merely appears somewhere in a tool payload (a quote price of 300) grounds
// nothing. A prompt number grounds a figure only with the same unit word
// ("300 shares" grounds "your 300 shares", not "$300 million"). Years and
// calendar dates ("fiscal 2026", "October 30") are not figures. A
// hypothetical ("if", "e.g.", "suppose") exempts only its own clause: a
// contrast ("but", "while", "however") or semicolon starts a new clause that
// is checked again. A disclosure word elsewhere never excuses a figure.
const EARNINGS_METRIC =
  /\b(?:eps|earnings per share|revenues?|sales|guidance|beat|miss|reported|consensus|actual|earnings\s+(?:of|came in|come in|were|was|totaled|rose|fell|grew|reached|hit))\b/gi;
const EVIDENCE_METRIC =
  /\b(?:eps|earnings per share|revenues?|sales|guidance|outlook|forecast|beat|miss|reported|consensus|actual|est(?:imated?|imates)?|surprise(?: percent)?|earnings)\b/gi;
const EARNINGS_FIGURE_WINDOW = 40;
const LABEL_AFTER_FIGURE_WINDOW = 20;
// Words that may join a figure to the label after it ("$2.15 EPS", "$94.9
// billion in revenue", "$1.20 per share of adjusted earnings"); a conjunction
// or comma ("$2.15 and revenue") means the label belongs to the next figure.
const LABEL_AFTER_FILLER =
  /^(?:\s+(?:in|of|for|per|a|share|worth|total|diluted|adjusted|non-gaap|gaap|quarterly|annual|consensus|estimated|expected|projected|net))*\s*$/i;
const HYPOTHETICAL_CUE =
  /\b(?:if|e\.g\.|for example|for instance|suppose|supposing|hypothetical\w*|assum\w*|illustrat\w*)(?![\w])/i;
const HYPOTHETICAL_SCOPE_BREAK = /;|,?\s+\b(?:but|however|whereas|although|though|yet|while)\b/i;
const FIGURE = /(?<![\w.])(\$)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?![\d])/g;
const FIGURE_SCALE = /^\s?(thousand|million|billion|trillion|mn|mm|bn|tn|k|m|b|t)(?![a-z])/i;
const FIGURE_PERCENT = /^\s?(?:%|percent\b)/i;
const FIGURE_UNIT = /^[\s-]*(%|[a-z]+)/i;
const ORDINAL_SUFFIX = /^(?:st|nd|rd|th)\b/i;
const MONTH_BEFORE =
  /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+$/i;
const DATE_OR_TIME =
  /\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?|\b\d{1,2}:\d{2}(?::\d{2})?\b/g;
const SCALES: Record<string, number> = {
  thousand: 1e3,
  k: 1e3,
  million: 1e6,
  mn: 1e6,
  mm: 1e6,
  m: 1e6,
  billion: 1e9,
  bn: 1e9,
  b: 1e9,
  trillion: 1e12,
  tn: 1e12,
  t: 1e12,
};

type MetricFamily = "eps" | "revenue" | "guidance" | "earnings";

const METRIC_FIELD: Record<MetricFamily, RegExp> = {
  eps: /\beps\b|\bearnings per share\b/,
  revenue: /\brevenues?\b|\bsales\b/,
  guidance: /\bguidance\b|\boutlook\b|\bforecast\b/,
  earnings:
    /\b(?:eps|earnings|revenues?|sales|est|estimated?|estimates|consensus|actual|reported|surprise|guidance|outlook|forecast|beat|miss|income)\b/,
};

function metricFamily(label: string): MetricFamily {
  const lower = label.toLowerCase();
  if (METRIC_FIELD.eps.test(lower)) return "eps";
  if (METRIC_FIELD.revenue.test(lower)) return "revenue";
  if (/\bguidance\b/.test(lower)) return "guidance";
  return "earnings";
}

interface Figure {
  start: number;
  end: number;
  value: number;
  scale: number | undefined;
  percent: boolean;
  decimals: number;
  display: string;
  unit: string;
}

function figuresIn(text: string): Figure[] {
  const figures: Figure[] = [];
  for (const match of text.matchAll(FIGURE)) {
    const start = match.index ?? 0;
    const [whole, dollar, integer, fraction] = match;
    let end = start + whole.length;
    const rest = text.slice(end);
    const before = text.slice(0, start);
    const scaleMatch = FIGURE_SCALE.exec(rest);
    const percentMatch = FIGURE_PERCENT.exec(rest);
    if (!dollar && !fraction && !scaleMatch && !percentMatch) {
      const bare = Number(integer.replace(/,/g, ""));
      // A year ("fiscal 2026") or calendar day ("October 30", "the 30th").
      if (/^\d{4}$/.test(integer) && bare >= 1900 && bare <= 2100) continue;
      if (MONTH_BEFORE.test(before) || ORDINAL_SUFFIX.test(rest)) continue;
    }
    if (scaleMatch) end += scaleMatch[0].length;
    else if (percentMatch) end += percentMatch[0].length;
    const value = Number(`${integer.replace(/,/g, "")}${fraction ? `.${fraction}` : ""}`);
    if (!Number.isFinite(value)) continue;
    figures.push({
      start,
      end,
      value,
      scale: scaleMatch ? SCALES[scaleMatch[1].toLowerCase()] : undefined,
      percent: percentMatch !== null,
      decimals: fraction?.length ?? 0,
      display: String(value),
      unit: (FIGURE_UNIT.exec(rest)?.[1] ?? "").toLowerCase().replace(/s$/, ""),
    });
  }
  return figures;
}

type FigureBasis = "estimate" | "reported" | undefined;

interface LabeledFigure {
  label: string;
  figure: Figure;
  basis: FigureBasis;
}

// Whether a figure is an estimate ("consensus EPS is 2.15", "analysts
// estimate $2.15 EPS") or a reported result ("EPS came in at $2.15"): the
// qualifier nearest the figure, read from the text since the previous figure
// and the label that follows it.
const ESTIMATE_QUALIFIER =
  /\b(?:consensus|estimate[sd]?|est|expected|expect|expects|expectations?|forecast(?:ed|s)?|projected|anticipated|street)\b/gi;
const REPORTED_QUALIFIER =
  /\b(?:reported|actual|actually|came in|come in|posted|delivered|printed)\b/gi;

function lastQualifier(text: string): FigureBasis {
  const last = (pattern: RegExp) =>
    Math.max(-1, ...[...text.matchAll(pattern)].map((match) => match.index ?? -1));
  const estimate = last(ESTIMATE_QUALIFIER);
  const reported = last(REPORTED_QUALIFIER);
  if (estimate < 0 && reported < 0) return undefined;
  return estimate > reported ? "estimate" : "reported";
}

function fieldBasis(field: string): FigureBasis {
  return lastQualifier(field);
}

function isSpecific(label: string): boolean {
  return metricFamily(label) !== "earnings";
}

// Attributes each figure to its nearest label: the closest one ending within
// the window before it in the same clause, or one starting just after it with
// no other figure between. A specific metric (EPS, revenue, guidance) wins
// over a generic one (beat, reported, consensus).
function labeledFigures(segment: string, labels: RegExp): LabeledFigure[] {
  const found = [...segment.matchAll(labels)].map((match) => ({
    label: match[0],
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
  const results: LabeledFigure[] = [];
  let previousEnd = 0;
  for (const figure of figuresIn(segment)) {
    const before = segment.slice(Math.max(previousEnd, figure.start - 60), figure.start);
    previousEnd = figure.end;
    const candidates: Array<{ label: string; gap: number; after: string }> = [];
    for (const label of found) {
      if (label.end <= figure.start) {
        const gap = figure.start - label.end;
        if (gap <= EARNINGS_FIGURE_WINDOW && clauseEnd(segment, label.end) >= figure.start) {
          candidates.push({ label: label.label, gap, after: "" });
        }
      } else if (label.start >= figure.end) {
        const between = segment.slice(figure.end, label.start);
        if (between.length <= LABEL_AFTER_FIGURE_WINDOW && LABEL_AFTER_FILLER.test(between)) {
          candidates.push({
            label: label.label,
            gap: between.length,
            after: segment.slice(figure.end, label.end),
          });
        }
      }
    }
    candidates.sort(
      (a, b) => Number(isSpecific(b.label)) - Number(isSpecific(a.label)) || a.gap - b.gap,
    );
    const chosen = candidates[0];
    if (chosen) {
      results.push({
        label: chosen.label,
        figure,
        basis: lastQualifier(before) ?? lastQualifier(chosen.after),
      });
    }
  }
  return results;
}

interface Evidence {
  field: string;
  value: number;
  scaled: boolean;
}

function keyWords(key: string): string {
  return key
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .toLowerCase();
}

function collectEvidence(node: unknown, path: string, out: Evidence[]): void {
  if (typeof node === "number") {
    if (Number.isFinite(node)) out.push({ field: path, value: node, scaled: true });
    return;
  }
  if (typeof node === "string") {
    const text = node.replace(DATE_OR_TIME, " ");
    // A string field inherits its key path ("revenueEstimate": "480 million").
    for (const figure of figuresIn(text)) {
      out.push({
        field: path,
        value: figure.value * (figure.scale ?? 1),
        scaled: figure.scale !== undefined,
      });
    }
    // Free text ("EPS: $6.08") grounds a figure under its own label.
    for (const line of text.split("\n")) {
      for (const { label, figure } of labeledFigures(line, EVIDENCE_METRIC)) {
        out.push({
          field: label.toLowerCase(),
          value: figure.value * (figure.scale ?? 1),
          scaled: figure.scale !== undefined,
        });
      }
    }
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectEvidence(item, path, out);
    return;
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      collectEvidence(value, `${path} ${keyWords(key)}`.trim(), out);
    }
  }
}

interface GroundedFigures {
  evidence: Evidence[];
  promptFigures: Set<string>;
}

function groundedFigures(trace: EvalTrace): GroundedFigures {
  const evidence: Evidence[] = [];
  for (const call of trace.toolCalls) {
    collectEvidence(call.args ?? {}, "", evidence);
    collectEvidence(call.result ?? null, "", evidence);
  }
  const promptFigures = new Set(
    figuresIn(trace.prompt).map((figure) => `${figure.display}|${figure.unit}`),
  );
  return { evidence, promptFigures };
}

// Candidate absolute values for an answer figure: its stated scale, or any
// scale when none is stated; a percent may be stored as a fraction.
function figureMatches(figure: Figure, evidence: Evidence): boolean {
  const scales = figure.scale !== undefined ? [figure.scale] : [1, 1e3, 1e6, 1e9, 1e12];
  const halfUnit = 0.5 * 10 ** -figure.decimals;
  for (const scale of evidence.scaled || figure.scale === undefined ? scales : [1]) {
    const target = figure.value * scale;
    const tolerance = halfUnit * scale + Math.abs(target) * 1e-9;
    if (Math.abs(evidence.value - target) <= tolerance) return true;
    if (figure.percent && Math.abs(evidence.value * 100 - target) <= tolerance) return true;
  }
  return false;
}

// An estimate is grounded only by an estimate/consensus field, and a reported
// figure never by one, so a reported EPS of 2.15 cannot ground "consensus EPS
// is 2.15". Guidance is forward-looking by nature and is not split.
function basisCompatible(family: MetricFamily, basis: FigureBasis, field: string): boolean {
  if (family === "guidance" || basis === undefined) return true;
  const evidenceBasis = fieldBasis(field);
  return basis === "estimate" ? evidenceBasis === "estimate" : evidenceBasis !== "estimate";
}

function isGrounded({ label, figure, basis }: LabeledFigure, grounded: GroundedFigures): boolean {
  if (grounded.promptFigures.has(`${figure.display}|${figure.unit}`)) return true;
  const family = metricFamily(label);
  const field = METRIC_FIELD[family];
  return grounded.evidence.some(
    (evidence) =>
      field.test(evidence.field) &&
      basisCompatible(family, basis, evidence.field) &&
      figureMatches(figure, evidence),
  );
}

function clauseEnd(text: string, from: number): number {
  for (let i = from; i < text.length; i += 1) {
    if (";!?\n".includes(text[i])) return i;
    if (text[i] === "." && !(/\d/.test(text[i - 1] ?? "") && /\d/.test(text[i + 1] ?? ""))) {
      return i;
    }
  }
  return text.length;
}

function ungroundedEarningsFigures(trace: EvalTrace): string[] {
  const grounded = groundedFigures(trace);
  const ungrounded: string[] = [];
  for (const sentence of splitSentences(trace.text)) {
    for (const segment of sentence.split(HYPOTHETICAL_SCOPE_BREAK)) {
      if (!segment || HYPOTHETICAL_CUE.test(segment)) continue;
      for (const labeled of labeledFigures(segment, EARNINGS_METRIC)) {
        if (!isGrounded(labeled, grounded)) {
          ungrounded.push(`${labeled.label} ${labeled.figure.display}`);
        }
      }
    }
  }
  return ungrounded;
}

// Event-risk framework concept families, evaluated on the answer's own
// content (prompt echo removed) and only when not directly negated.
const EVENT_RISK_MIN_CONCEPTS = 3;
const EVENT_RISK_CONCEPTS: Array<{ name: string; marker: RegExp }> = [
  {
    name: "gap risk or expected move",
    marker:
      /\bgap(?:s|ped|ping)?\b|\b(?:expected|implied) (?:earnings )?(?:move|volatility|vol)\b|\bimplied\s+(?:price\s+)?(?:swing|range)\b|\b(?:iv|volatility) crush\b|\bstraddle\b|\b(?:overnight|post-earnings|earnings[- ]day|after-hours) (?:move|moves|drop|jump|swing|reaction|price (?:move|movement))\b|\bbinary (?:event|outcome)\b/i,
  },
  {
    name: "position size",
    marker:
      /\bposition[- ]siz\w*|\bsiz(?:e|ing)\b[^.;!?\n]{0,30}\b(?:position|stake|exposure)\b|\b(?:position|stake|exposure|holding)\b[^.;!?\n]{0,30}\b(?:siz(?:e|ing)|too (?:large|big|small))\b|\b(?:how (?:big|large)|oversized|undersized|right-sized|too (?:large|big))\b[^.;!?\n]{0,20}\b(?:position|stake|holding)\b|\b(?:share|percent(?:age)?|portion|fraction|%) of (?:your )?(?:total )?(?:portfolio|net worth|capital|investable assets)\b|\bportfolio (?:weight|concentration)\b|\bconcentrat\w*|\b(?:more|less|too much) exposure than\b|\bsingle[- ](?:stock|name|position) (?:limit|cap|weight)\b|\b(?:dollar )?value of (?:your |the )?(?:\d[\d,]* )?(?:shares|position|stake|holding)\b|\b(?:dollar )?loss you (?:can|could) (?:accept|tolerate|absorb|afford)\b|\bhow much (?:you can|you could|you're willing to) (?:afford to )?lose\b/i,
  },
  {
    name: "trim/hedge/stop",
    marker:
      /\btrim\w*|\bhedg\w*|\bstop[- ]?loss\w*|\bstop (?:order|level)\b|\bset a stop\b|\bprotective puts?\b|\bcollars?\b|\breduc\w* (?:your |the )?(?:position|exposure|stake)\b/i,
  },
  {
    name: "what would change the answer",
    marker:
      /\bwould (?:change|flip|alter|shift)\b|\bchange (?:the|my|this|your|our) (?:answer|view|call|recommendation|decision|read)\b|\binvalidat\w*|\bwhat would make\b|\bfacts? that would\b|\bhinges? on\b|\bdepends? on\b|\b(?:if|once|when) you (?:tell|share|give|provide|send|confirm|verify|know|have)\b|\b(?:once|until|after) (?:the|we|i|you)\b[^.;!?\n]{0,40}\b(?:confirm|verif|known|available|fetch)\w*/i,
  },
];

function eventRiskFrameworkConcepts(trace: EvalTrace): string[] {
  const content = withoutPromptEcho(trace.text, trace.prompt);
  return EVENT_RISK_CONCEPTS.filter(({ marker }) => hasUnnegatedMarker(content, marker)).map(
    ({ name }) => name,
  );
}

const OPTION_CHAIN_TOOL = "get_option_chain";

// The owned underlying: an unnegated text mention, or structured evidence that
// the option chain was fetched for that symbol. Either way, the answer must not
// affirmatively recommend an option on another ticker from the request ("buy
// the NVDA put"): a fetched chain shows available evidence, not the underlying
// the answer settled on.
function usesOwnedUnderlying(
  symbol: string,
  trace: EvalTrace,
): { passed: boolean; reason: string; deterministic: boolean } {
  const upper = symbol.toUpperCase();
  const fetchedChain = trace.toolCalls.some(
    (call) =>
      call.name === OPTION_CHAIN_TOOL && String(call.args?.symbol ?? "").toUpperCase() === upper,
  );
  const mentioned = hasUnnegatedMarker(
    trace.text,
    new RegExp(`(?<![\\w$.])${escapeRegExp(symbol)}(?![\\w])`, "i"),
  );
  const committed = withoutConditionalClauses(trace.text);
  const conflicting = otherRequestSymbols(trace, upper).filter((other) =>
    affirmsForbidden(committed, optionOnSymbol(other)),
  );
  return {
    passed: conflicting.length === 0 && (fetchedChain || mentioned),
    reason:
      conflicting.length > 0
        ? `final answer recommends an option on ${conflicting.join(", ")} instead of ${upper}`
        : fetchedChain
          ? `observed ${OPTION_CHAIN_TOOL} for ${upper}`
          : mentioned
            ? `final answer names ${upper} as the underlying`
            : `expected ${OPTION_CHAIN_TOOL} args or an unnegated final-answer mention of ${upper}`,
    deterministic: true,
  };
}

// Drops conditional clauses ("If you meant a call on NVDA, tell me"), which
// offer an alternative rather than recommend it.
const CONDITIONAL_CLAUSE = /^\s*(?:if|unless|suppose|supposing|in case|should you)\b/i;

function withoutConditionalClauses(text: string): string {
  return splitSentences(text)
    .map((sentence) =>
      sentence
        .split(/(?<=[,;])/)
        .filter((clause) => !CONDITIONAL_CLAUSE.test(clause))
        .join(""),
    )
    .join("\n");
}

function otherRequestSymbols(trace: EvalTrace, owned: string): string[] {
  const symbols = new Set<string>([
    ...(trace.classification.entities?.symbols ?? []).map((symbol) => symbol.toUpperCase()),
    ...(trace.prompt.match(/\b[A-Z]{2,5}\b/g) ?? []),
  ]);
  symbols.delete(owned);
  return [...symbols];
}

// An option bound to a ticker: "NVDA put", "NVDA 150 put", "NVDA Oct 150
// call", or "puts on NVDA". Only expiry and strike tokens may sit between, so
// "NVDA earnings could hurt your call" is not an NVDA call.
const EXPIRY_WORD =
  "(?:[Jj]an(?:uary)?|[Ff]eb(?:ruary)?|[Mm]ar(?:ch)?|[Aa]pr(?:il)?|[Mm]ay|[Jj]une?|[Jj]uly?|[Aa]ug(?:ust)?|[Ss]ep(?:t(?:ember)?)?|[Oo]ct(?:ober)?|[Nn]ov(?:ember)?|[Dd]ec(?:ember)?|[Ww]eekly|[Mm]onthly)\\.?";
function optionOnSymbol(symbol: string): RegExp {
  const ticker = escapeRegExp(symbol);
  // Case-sensitive, so the ticker never matches an ordinary word ("how many
  // puts" is not a MANY put).
  const option = "(?:[Pp]uts?|[Cc]alls?|[Oo]ptions?|[Cc]ontracts?|[Cc]ollars?|[Ss]preads?)";
  return new RegExp(
    `(?<![\\w$.])${ticker}(?:\\s+(?:${EXPIRY_WORD}|\\$?\\d+(?:\\.\\d+)?(?:-strike)?|strike))*\\s+${option}\\b|\\b${option}\\s+(?:on|for)\\s+${ticker}(?![\\w])`,
  );
}

const SMALL_NUMBER_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];

// An owned share quantity stated with its share unit (not a "$200 strike"), or
// the matching number of put contracts at 100 shares per contract.
function preservesShareQuantity(text: string, shares: number): boolean {
  const normalized = stripMarkdownEmphasis(text);
  const sharePattern = new RegExp(
    `(?<![\\d.$,])${shares}(?![\\d.,])\\s*[- ]?\\s*(?:[a-z]{1,5}\\s+)?(?:shares?|sh\\b)`,
    "i",
  );
  if (sharePattern.test(normalized)) return true;
  if (shares % 100 !== 0) return false;
  const contracts = shares / 100;
  return hasHedgePutQuantity(normalized, String(contracts), SMALL_NUMBER_WORDS[contracts] ?? "");
}

function asksForTickerClarification(trace: EvalTrace): boolean {
  return trace.askUserTranscript.some(
    ({ question }) =>
      /\b(?:ticker|symbol|company)\b/i.test(question) &&
      /\b(?:which|clarify|confirm|correct|intended|mean)\b/i.test(question),
  );
}

// Only puts, put options/contracts, or plain contracts count as the hedge unit.
// An intervening adjective ("4 call contracts") or generic "options" must not.
const HEDGE_PUT_UNIT = "(?:puts?|put\\s+(?:option\\s+)?contracts?|put\\s+options?|contracts?)";
const HEDGE_OWNED_SHARES =
  /(?<![\d.])450(?![\d.])\s*[- ]?\s*(?:shares?|sh\b)|\bfour\s+hundred(?:\s+and)?\s+fifty\s+shares?\b/;
const HEDGE_RESIDUAL_QUALIFIER =
  /\b(?:residual|remainder|remaining|leftover|unhedged|uncovered|unprotected|not hedged|not covered)\b/;
// Actual excess/overhedge semantics only: bare rounding/fractional language is
// not an explanation of the 50 shares of excess exposure.
const HEDGE_EXCESS_QUALIFIER =
  /\b(?:excess|extra|surplus|additional|over-?hedg\w*|over-?expos\w*|over-?cover\w*|beyond|above your|more\s+(?:shares?|than|exposure|protection))\b/;
// Downside-protection floor mechanics: the literal floor word, or an explicit
// bounded equivalent on the combined stock-plus-put position (protected from
// falling below, protection begins at/below, caps losses at, strike minus
// premium), or a put's strike-level sell right. Deliberately not a blanket
// "protection"/"risk" match and not a generic sell/stop level: the put right
// branch and the strike-level branch each require the strike itself, so a
// stop-loss or price target phrased as "the level at which you sell" does not
// count.
const HEDGE_FLOOR_MECHANICS =
  /\b(?:hedge|effective|downside)?\s*floor\b|\bprotected from (?:falling|dropping|declining|slipping) below\b|\bprotection (?:begins|starts|kicks in)(?: only)? (?:at|below|around|once)\b|\bdownside protection (?:begins|starts|level|at|below|once)\b|\bcaps? (?:your )?(?:losses|downside|risk|exposure) (?:at|below|around)\b|\b(?:strike|price)\s*(?:minus|[-–])\s*(?:the\s+)?premium\b|\bputs?\b[^.\n]{0,80}\bright to sell\b[^.\n]{0,40}\bstrike\b|\bstrike\b[^.\n]{0,40}\blevel at which\b[^.\n]{0,60}\b(?:sell|exit|offload)\b/i;

// Explicit protective-put hazard concepts. The literal "risk" stays accepted,
// but an answer may instead state the concrete hazard: the put-leg premium that
// can be lost, unprotected/remaining shares, time or premium decay, or theta
// eroding the option's time value. A bare "tradeoff"/"consider" heading, a
// generic "downside protection begins at the strike" floor sentence, an
// unrelated word such as "fall season", or the protection-only floor sentences
// "the put caps your losses at the strike" and "limits your maximum loss at the
// strike" does not count. Loss language is deliberately bounded to the
// premium/put/option leg, so naming a capped or limited stock loss is not
// mistaken for a hazard.
const HEDGE_DOWNSIDE_HAZARD =
  /\brisks?\b|\b(?:unprotected|unhedged|uncovered)\b|\b(?:time|premium|option|theta)\s+decay\b|\btheta\b[^.\n]{0,40}\b(?:erod|reduc|eats?|drains?)\w*\b|\b(?:erod|reduc)\w*\b[^.\n]{0,40}\b(?:option|time)\s+value\b|\b(?:put|option)s?\b[^.\n]{0,20}\blose\b|\blose\s+(?:the\s+|your\s+|entire\s+)?premium\b|\b(?:premium|put|option)(?:\s+leg)?\s+loss(?:es)?\b|\bloss(?:es)?\s+(?:of|on|from)\s+(?:the\s+)?(?:premium|put|option|leg)\b|\bpremium\s+(?:is\s+)?(?:at\s+risk|lost)\b/i;

// Normal Markdown bold emphasis around a number must not change sizing, e.g.
// "buy **4** put contracts" or "**5** puts". Strip paired ** / __ markers from
// the matching copy only; unmatched markers are left untouched.
function stripMarkdownEmphasis(text: string): string {
  return text.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2");
}

// A put quantity tied to its option unit, so numbered-list digits ("4."),
// unrelated figures (strikes, dates), call contracts, and generic options do
// not satisfy the sizing. The trailing boundary keeps "4 putative" out.
function hasHedgePutQuantity(text: string, digit: string, word: string): boolean {
  const digitPattern = new RegExp(`(?<![\\d.])${digit}(?![\\d.])\\s+${HEDGE_PUT_UNIT}\\b`, "i");
  if (digitPattern.test(text)) return true;
  if (!word) return false;
  const wordPattern = new RegExp(`\\b${word}\\b\\s+${HEDGE_PUT_UNIT}\\b`, "i");
  return wordPattern.test(text);
}

// A 50-share quantity stated with its share unit (not the "50" inside 450/"$50"
// premium/50 delta) and a residual or excess qualifier in the same context.
function hasFiftyShareMentionNear(text: string, qualifier: RegExp): boolean {
  const pattern =
    /(?<![\d.])(?:50|fifty)(?:-(?:share|shares)\b|\s+(?:[a-z][a-z-]*\s+){0,2}(?:share|shares)\b)/gi;
  for (const match of text.matchAll(pattern)) {
    const start = Math.max(0, match.index - 100);
    const end = Math.min(text.length, match.index + match[0].length + 100);
    if (qualifier.test(text.slice(start, end))) return true;
  }
  return false;
}

function evaluateHedgeSizingFromShares(text: string): {
  passed: boolean;
  reason: string;
  deterministic: boolean;
} {
  const normalized = stripMarkdownEmphasis(text);
  const ownedShares = HEDGE_OWNED_SHARES.test(normalized);
  const fourUnits = hasHedgePutQuantity(normalized, "4", "four");
  const fiveUnits = hasHedgePutQuantity(normalized, "5", "five");
  const residual = hasFiftyShareMentionNear(normalized, HEDGE_RESIDUAL_QUALIFIER);
  const excess = hasFiftyShareMentionNear(normalized, HEDGE_EXCESS_QUALIFIER);

  if (!ownedShares) {
    return {
      passed: false,
      reason:
        "expected the sized hedge to reference the owned 450 shares (digits or words), not a different position",
      deterministic: true,
    };
  }
  if (fourUnits && residual && fiveUnits && !excess) {
    return {
      passed: false,
      reason:
        "expected a reconciled sizing: a 4-put/50-share-residual recommendation and a 5-contract recommendation contradict without an explicit excess explanation",
      deterministic: true,
    };
  }
  if (fourUnits && residual) {
    return {
      passed: true,
      reason: "observed 4 put contracts with the 50-share residual made explicit",
      deterministic: true,
    };
  }
  if (fiveUnits && excess) {
    return {
      passed: true,
      reason: "observed 5 put contracts with the 50-share excess or overhedge made explicit",
      deterministic: true,
    };
  }
  return {
    passed: false,
    reason:
      "expected a put/contract quantity for the owned 450 shares with an explicit 50-share residual or an explained 50-share excess/overhedge; incidental digits, call contracts, generic options, or unqualified 500-share coverage do not count",
    deterministic: true,
  };
}

function evaluateManifestAssertion(
  assertion: string,
  trace: EvalTrace,
  text: string,
  tools: string[],
): { passed: boolean; reason: string; deterministic: boolean } | undefined {
  const lowerAssertion = assertion.toLowerCase();
  const workflow = trace.router?.workflow ?? trace.classification.workflow;
  const requiredTerms = (...terms: RegExp[]) => ({
    passed: true,
    reason: `registered qualitative assertion; not enforced with brittle keyword matching (${terms.map(String).join(", ")})`,
    deterministic: false,
  });
  const requires = (...terms: RegExp[]) => ({
    passed: terms.every((term) => term.test(text)),
    reason: `expected final answer to include: ${terms.map(String).join(", ")}`,
    deterministic: true,
  });
  const forbids = (...terms: RegExp[]) => ({
    passed: terms.every((term) => !term.test(text)),
    reason: `expected final answer not to include: ${terms.map(String).join(", ")}`,
    deterministic: true,
  });

  if (lowerAssertion.includes("does not punt because a dedicated live brokerage tool is missing")) {
    return forbids(
      /\b(?:cannot|can't|unable)\s+(?:compare|answer|help|provide)\b/,
      /\b(?:no dedicated|missing).{0,40}(?:tool|provider).{0,40}(?:cannot|can't|unable)\b/,
    );
  }
  if (lowerAssertion.includes("compares fees, expense ratios")) {
    return requiredTerms(
      /fees?/,
      /expense ratios?/,
      /cash sweep/,
      /fractional shares?/,
      /fund minimums?/,
      /tax[- ]loss/,
      /transfer|account fees?/,
      /support/,
      /recurring/,
    );
  }
  if (
    lowerAssertion.includes("labels provider-site facts") ||
    lowerAssertion.includes("labels current yield facts")
  ) {
    return requiredTerms(/verify|provider site|current .* facts?|not live|cannot verify/);
  }
  if (
    lowerAssertion.includes("practical default") ||
    lowerAssertion.includes("default hierarchy")
  ) {
    return requiredTerms(/default|next step|hierarchy|would/);
  }
  if (lowerAssertion.includes("compares requested etfs before portfolio construction")) {
    return {
      passed: workflow !== "portfolio_builder",
      reason: "expected comparison mode rather than portfolio construction",
      deterministic: true,
    };
  }
  if (lowerAssertion.includes("diversification framework")) {
    return requiredTerms(/diversif|overlap|concentration|holdings?|fund|quote|correlation/);
  }
  if (lowerAssertion.includes("followup preserves comparison shape")) {
    return requiredTerms(/vym/, /schd|replace|instead/, /compare|versus|vs\.?/);
  }
  if (lowerAssertion.includes("concrete allocation range and dollar amount")) {
    return requiredTerms(/\b\d+(?:\.\d+)?\s*%|\b\d+\s*-\s*\d+\s*%/, /\$\s?\d/);
  }
  if (lowerAssertion.includes("drawdown math")) {
    return requiredTerms(/drawdown|downside|loss/, /\$\s?\d|\b\d+(?:\.\d+)?\s*%/);
  }
  if (lowerAssertion.includes("sleep test, dca")) {
    return requiredTerms(
      /sleep test/,
      /DCA|dollar[- ]cost/,
      /rebalance/,
      /position cap/,
      /tax/,
      /custody|exchange/,
      /emergency fund|high[- ]interest debt/,
    );
  }
  if (lowerAssertion.includes("current date and market status")) {
    return requiredTerms(/market status|market closed|trading day|current date|as of/);
  }
  if (lowerAssertion.includes("most recent trading day")) {
    return requiredTerms(/most recent trading day|last trading day|market closed/);
  }
  if (lowerAssertion.includes("ties cause only to fetched quote")) {
    return requiredTerms(/quote|news|event|filing|evidence|catalyst/);
  }
  if (lowerAssertion.includes("quote or tool-output date")) {
    return requiredTerms(/as of|quote date|tool-output date|market closed|last available/);
  }
  if (lowerAssertion.includes("market-closed, delayed, or last available quote")) {
    return requiredTerms(/market[- ]closed|delayed|last available|last trading day/);
  }
  if (lowerAssertion.includes("missing fundamentals or unavailable dcf")) {
    return forbids(/\b(?:dcf|fundamentals?) unavailable.{0,120}(?:main|primary|only) thesis/);
  }
  if (lowerAssertion.includes("clear call with key risks")) {
    return requiredTerms(
      /buy|sell|hold|avoid|wait|trim|add|prefer|recommend/,
      /risk|downside/,
      /position|entry|size/,
      /confidence/,
      /invalidat/,
    );
  }
  if (lowerAssertion.includes("direction and strength of sentiment")) {
    return requiredTerms(
      /sentiment/,
      /bullish|bearish|positive|negative|neutral|lean/,
      /strong|weak|moderate|score/,
    );
  }
  if (lowerAssertion.includes("score scale")) {
    return requiredTerms(/score|scale|out of|0\s*[-/]\s*100|1\s*[-/]\s*10/);
  }
  if (lowerAssertion.includes("missing sources and why they matter")) {
    return requiredTerms(
      /missing|unavailable|not covered/,
      /source/,
      /matter|because|limits|confidence/,
    );
  }
  if (lowerAssertion.includes("source-coverage risk and low sample counts")) {
    return requiredTerms(
      /source[- ]coverage|coverage risk/,
      /low sample|sample count|sample size|thin sample/,
    );
  }
  if (lowerAssertion.includes("sentiment diverges from price action")) {
    return requiredTerms(/price action|price/, /diverge|confirm|align|contrast/);
  }
  if (lowerAssertion.includes("sec filing evidence")) {
    return {
      passed: tools.includes("get_sec_filings") || /sec|filing|10-k|10-q|8-k/.test(text),
      reason: "expected SEC filing evidence",
      deterministic: true,
    };
  }
  if (lowerAssertion.includes("separates filing metadata")) {
    return requiredTerms(
      /filing metadata|filing/,
      /section|body|summary/,
      /news|market data|adjacent/,
    );
  }
  if (lowerAssertion.includes("item 5.02")) {
    return forbids(/item\s*5\.02|management change|filing-section change/);
  }
  if (lowerAssertion.includes("thesis-changing deltas")) {
    return requiredTerms(
      /thesis|change|delta/,
      /date|timing/,
      /source/,
      /6[- ]?12|six|twelve|month/,
    );
  }
  if (lowerAssertion.includes("does not route as portfolio construction")) {
    return {
      passed: workflow !== "portfolio_builder",
      reason: "expected non-construction route",
      deterministic: true,
    };
  }
  if (lowerAssertion.includes("does not ask for a portfolio budget")) {
    return {
      passed: !affirmsForbidden(text, /\b(?:need|what|provide)\b[^.;?!\n]{0,60}\bbudget\b/),
      reason: "expected answer not to request a portfolio budget",
      deterministic: true,
    };
  }
  if (lowerAssertion.includes("dividend/income and growth-oriented etfs")) {
    return requiredTerms(/dividend|income|yield/, /growth|total return|qqq|voo/);
  }
  if (lowerAssertion.includes("tax/asset-location caveats")) {
    return requiredTerms(/tax|taxable|asset location|account type/);
  }
  if (lowerAssertion.includes("does not fabricate live yields")) {
    return forbids(/\b\d+(?:\.\d+)?\s*%.*(?:yield|apy).*(?:today|currently|now)\b/);
  }
  if (lowerAssertion.includes("liquidity, fdic")) {
    return requiredTerms(/liquid/, /FDIC|SIPC|Treasury/, /rate risk/, /tax/, /minimum/, /access/);
  }
  if (lowerAssertion.includes("guaranteed after-tax debt return")) {
    return requiredTerms(
      /guaranteed|certain/,
      /after[- ]tax|tax/,
      /debt|mortgage/,
      /uncertain|market return/,
    );
  }
  if (lowerAssertion.includes("liquidity, emergency fund")) {
    return requiredTerms(
      /liquid/,
      /emergency fund/,
      /tax/,
      /risk tolerance/,
      /time horizon/,
      /hybrid|split/,
    );
  }
  if (lowerAssertion.includes("6.8% rate")) {
    return requiredTerms(/6\.8\s*%|6\.8 percent/, /default|would|practical/);
  }
  const ownedUnderlying = lowerAssertion.match(
    /\buses ([a-z][a-z.]{0,5}) as (?:the )?(?:covered-call|protective-put) underlying\b/,
  );
  if (ownedUnderlying) {
    return usesOwnedUnderlying(ownedUnderlying[1], trace);
  }
  if (lowerAssertion.includes("preserves nvda as catalyst context")) {
    return requires(/\bnvda\b/, /catalyst|context|earnings|event/);
  }
  if (lowerAssertion.includes("cost basis and event-week dte")) {
    return requires(/cost basis/, /event[- ]week|dte|days? to expiration/);
  }
  if (lowerAssertion.includes("preserves requested 1-2 week dte")) {
    return requires(
      /1\s*[-–]\s*2|one\s+to\s+two|two[- ]week|weekly|7_to_14_days|7\s*(?:to|[-–])\s*14\s*days?|\b(?:[7-9]|1[0-4])\s*dte\b/,
      /dte|expiry|expiration/,
    );
  }
  if (lowerAssertion.includes("covered-call assignment")) {
    return requiredTerms(/assignment/, /downside/, /opportunity cost|capped upside/);
  }
  const hedgeQuantity = lowerAssertion.match(/\b(\d+)-share hedge quantity\b/);
  if (hedgeQuantity) {
    const shares = Number(hedgeQuantity[1]);
    const quantity = preservesShareQuantity(text, shares);
    const monthHint = /month|dte|days? to expiration/.test(text);
    return {
      passed: quantity && monthHint,
      reason: `expected the ${shares}-share quantity with a share unit (or ${shares / 100} put contracts) and a month/DTE hint; quantity=${quantity}, monthHint=${monthHint}`,
      deterministic: true,
    };
  }
  if (lowerAssertion.includes("does not convert protective put request into a bullish call")) {
    const bullishCall = /bullish call|bull call|call spread|covered call/;
    return {
      passed: !affirmsForbidden(text, bullishCall),
      reason: `expected final answer not to recommend a bullish call strategy (negated or contrasted mentions allowed): ${bullishCall}`,
      deterministic: true,
    };
  }
  if (lowerAssertion.includes("sizes hedge from 450 shares")) {
    return evaluateHedgeSizingFromShares(text);
  }
  if (lowerAssertion.includes("hedge floor, premium")) {
    const base = requires(/premium/, /delta|theta|greeks?/, /liquidity/);
    if (!base.passed) return base;
    if (!hasUnnegatedMarker(text, HEDGE_DOWNSIDE_HAZARD)) {
      return {
        passed: false,
        reason:
          "expected an explicit protective-put hazard, such as the put-leg loss/loses/premium at risk, unprotected or unhedged shares, or time/theta decay of the option's value, not only premium/Greeks/liquidity mechanics",
        deterministic: true,
      };
    }
    if (!HEDGE_FLOOR_MECHANICS.test(text)) {
      return {
        passed: false,
        reason:
          "expected explicit downside-protection floor mechanics, such as shares protected from falling below the strike minus premium or protection beginning at/below a strike",
        deterministic: true,
      };
    }
    return {
      passed: true,
      reason:
        "observed premium, Greeks, liquidity, an explicit protective-put hazard, and explicit downside-protection floor mechanics",
      deterministic: true,
    };
  }
  if (
    lowerAssertion.includes("bottom-line portfolio risk/reward") ||
    lowerAssertion.includes("bottom-line structural portfolio read")
  ) {
    const passed = opensWithBottomLineStructuralRead(trace.text);
    return {
      passed,
      reason: passed
        ? "opening block (after at most one short lead-in sentence) gives a bottom-line or structural read of the portfolio"
        : "expected the opening block (after at most one short lead-in sentence) to give a bottom-line or structural portfolio read, not a question, budget request, builder allocation, or unrelated preamble",
      deterministic: true,
    };
  }
  if (lowerAssertion.includes("current macro evidence")) {
    return requiredTerms(
      /current macro evidence|macro evidence/,
      /structural portfolio read|structural/,
      /sleeve/,
      /risk|opportunit/,
      /actionable|adjust/,
      /watchlist|invalidat/,
    );
  }
  if (lowerAssertion.includes("unavailable macro data")) {
    return requiredTerms(
      /unavailable|missing|data gap|not available/,
      /macro|inflation|rates?|fed|sentiment/,
    );
  }
  if (lowerAssertion.includes("diversification, concentration, geography")) {
    return requiredTerms(
      /diversif/,
      /concentration/,
      /geograph|international|regional/,
      /duration/,
      /credit/,
      /liquid/,
      /tax/,
      /horizon/,
      /rebalance/,
    );
  }
  if (lowerAssertion.includes("one practical adjustment")) {
    return requiredTerms(/adjust|rebalance|trim|add|watchlist|trigger/, /portfolio/);
  }
  if (lowerAssertion.includes("/connect")) {
    return requiredTerms(/\/connect|connect/, /credential|required|provider/);
  }
  if (lowerAssertion.includes("useful macro/portfolio framework")) {
    return requiredTerms(/macro|portfolio/, /framework|scenario|risk|watchlist/);
  }
  if (lowerAssertion.includes("specific current facts that would improve")) {
    return requiredTerms(
      /would improve|need|specific current facts|verify/,
      /inflation|rates?|sentiment|macro|data/,
    );
  }
  if (lowerAssertion.includes("missing-provider apology")) {
    return forbids(/^(?:sorry|i can't|i cannot|unable).{0,160}(?:provider|credential|missing)/);
  }
  if (lowerAssertion.includes("strategy return, buy-and-hold")) {
    return requiredTerms(
      /strategy return/,
      /buy[- ]and[- ]hold/,
      /outperformance|underperformance/,
      /trade count|trades/,
      /win rate/,
      /max drawdown/,
    );
  }
  if (lowerAssertion.includes("sharpe or sortino")) {
    return requiredTerms(/sharpe|sortino|unavailable/);
  }
  if (lowerAssertion.includes("why the strategy worked or failed")) {
    return requiredTerms(/worked|failed|because|regime/);
  }
  if (lowerAssertion.includes("costs/slippage")) {
    return requiredTerms(/costs?|slippage/);
  }
  if (lowerAssertion.includes("does not turn the state update into a buy/sell recommendation")) {
    return forbids(/\b(?:buy|sell|avoid)\b/);
  }
  if (lowerAssertion.includes("does not append analyst commitment")) {
    return forbids(/analyst view|commitment|confidence band|invalidation level|reasoning chain/);
  }
  return undefined;
}

// General bottom-line markers: the phrase itself (any spacing/hyphenation), the BLUF
// acronym, "verdict", and "overall/net read|assessment|view|take" summary labels.
const BOTTOM_LINE_MARKER =
  /\bbottom[\s-]*line\b|\bbluf\b|\bverdict\b|\b(?:overall|net) (?:read|assessment|view|take)\b/;
const NEGATED_BOTTOM_LINE_MARKER =
  /\bno (?:clear |real )?(?:bottom[\s-]*line|bluf|verdict|(?:overall|net) (?:read|assessment|view|take))\b/g;
const PORTFOLIO_SUBJECT =
  /\bportfolios?\b|\ballocations?\b|\b\d{1,3}\s*\/\s*\d{1,3}\b|\bsleeves?\b/;
const STRUCTURAL_CHARACTERIZATION =
  /\brisks?\b|\brewards?\b|\breturns?\b|\bvolatil|\bdiversif|\bconcentrat|\bduration\b|\bcorrelat|\bdrawdowns?\b|\bstructur|\bbalanc|\bhedg|\bexpos/;
const BUDGET_REQUEST =
  /\bbudget\b|\bhow much\b[^.?!]{0,30}\b(?:invest|allocate|put in)\b|\bamount (?:you|to)\b[^.?!]{0,20}\binvest\b/;
const BUILDER_OPENING =
  /\b(?:build|construct)(?:ing)?\b[^.?!]{0,40}\bportfolio\b|\bportfolio\b[^.?!]{0,40}\b(?:build|construct)\b|\ballocat(?:e|ing)\s+\d{1,3}\s*%/;

function normalizeOpeningBlock(block: string): string {
  return block
    .replace(/[*_#>`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isHeadingOnlyBlock(block: string): boolean {
  if (block.includes("\n")) return false;
  if (/^#{1,6}\s/.test(block) || /^\*\*[^*]+\*\*:?$/.test(block)) return true;
  const plain = normalizeOpeningBlock(block);
  return plain.length > 0 && plain.length <= 80 && !/[.!?]$/.test(plain);
}

function isShortLeadInSentence(block: string): boolean {
  const plain = normalizeOpeningBlock(block);
  return (
    !block.includes("\n") &&
    plain.length > 0 &&
    plain.length <= 200 &&
    !/[.!?:;]\s+\S/.test(plain) &&
    !isHeadingOnlyBlock(block)
  );
}

const NEGATED_BUILDING =
  /\b(?:not|never|rather than|instead of|without)\b[^.?!]{0,20}\b(?:build|construct)\w*/g;

function isRejectedOpening(plain: string): boolean {
  const firstSentence = plain.split(/(?<=[.!?])\s/, 1)[0] ?? "";
  const asksUser = /\?$/.test(firstSentence) && /\byour?\b/.test(firstSentence);
  return (
    asksUser ||
    BUDGET_REQUEST.test(plain) ||
    BUILDER_OPENING.test(plain.replace(NEGATED_BUILDING, ""))
  );
}

function isBottomLineStructuralRead(plain: string): boolean {
  if (!PORTFOLIO_SUBJECT.test(plain)) return false;
  const withoutNegatedMarkers = plain.replace(NEGATED_BOTTOM_LINE_MARKER, "");
  return BOTTOM_LINE_MARKER.test(withoutNegatedMarkers) || STRUCTURAL_CHARACTERIZATION.test(plain);
}

/**
 * "Starts with a bottom-line structural portfolio read": the opening unit (one heading plus its
 * first paragraph, or the first paragraph) must read the portfolio as a whole, either under a
 * bottom-line marker or as a risk/reward/structure characterization. At most one short lead-in
 * sentence may precede it. Openings that ask a question, request a budget, or start building a
 * new allocation fail, as does an answer whose bottom line only appears later.
 */
export function opensWithBottomLineStructuralRead(text: string): boolean {
  const blocks = text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
  let index = 0;
  const first = blocks[0];
  if (first === undefined) return false;
  if (isRejectedOpening(normalizeOpeningBlock(first))) return false;
  if (
    isShortLeadInSentence(first) &&
    !isBottomLineStructuralRead(normalizeOpeningBlock(first)) &&
    blocks.length > 1
  ) {
    index = 1;
  }
  const leadBlock = blocks[index] ?? "";
  const leadUnit =
    isHeadingOnlyBlock(leadBlock) && blocks[index + 1] !== undefined
      ? `${leadBlock}\n${blocks[index + 1]}`
      : leadBlock;
  const plain = normalizeOpeningBlock(leadUnit);
  return !isRejectedOpening(plain) && isBottomLineStructuralRead(plain);
}
