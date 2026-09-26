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
      passed:
        /could not|couldn't|unavailable|not verified|not verify|ambig|missing|unknown|unable|invalid (?:ticker|symbol)|placeholder|not recognized|no verified|not find|no results|not available|mutual fund|not (?:an? )?(?:company|stock)|does not report earnings|earnings premise/i.test(
          text,
        ) || asksForTickerClarification(trace),
      reason: asksForTickerClarification(trace)
        ? "asked user to clarify ambiguous ticker"
        : "expected unresolved-ticker disclosure",
    },
    {
      pattern: /does not invent current earnings facts|no invented current earnings facts/i,
      passed:
        /could not|unavailable|not verified|not verify|missing|unknown|unable|no current|provider gap/i.test(
          text,
        ) ||
        !/\b(?:eps|revenue|guidance|beat|miss|reported|consensus|actual)\b.{0,40}\b\d+(?:\.\d+)?\b/i.test(
          trace.text,
        ),
      reason: "expected no fabricated current earnings figures",
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
      passed: /trim|hedge|hold|position size|event[- ]risk|earnings|gap risk|stop/.test(text),
      reason: "expected event-risk decision framework",
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
  const wordPattern = new RegExp(`\\b${word}\\b\\s+${HEDGE_PUT_UNIT}\\b`, "i");
  return digitPattern.test(text) || wordPattern.test(text);
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
      passed: !/need .*budget|what .*budget|provide .*budget/.test(text),
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
  if (lowerAssertion.includes("uses dram as the covered-call underlying")) {
    return requires(/\bdram\b/);
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
  if (lowerAssertion.includes("uses amd as protective-put underlying")) {
    return requires(/\bamd\b/);
  }
  if (lowerAssertion.includes("uses aapl as protective-put underlying")) {
    return requires(/\baapl\b/);
  }
  if (lowerAssertion.includes("200-share hedge quantity")) {
    return requires(/200/, /month|dte|days? to expiration/);
  }
  if (lowerAssertion.includes("does not convert protective put request into a bullish call")) {
    return forbids(/bullish call|bull call|call spread|covered call/);
  }
  if (lowerAssertion.includes("sizes hedge from 450 shares")) {
    return evaluateHedgeSizingFromShares(text);
  }
  if (lowerAssertion.includes("hedge floor, premium")) {
    const base = requires(/premium/, /delta|theta|greeks?/, /liquidity/);
    if (!base.passed) return base;
    if (!HEDGE_DOWNSIDE_HAZARD.test(text)) {
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
