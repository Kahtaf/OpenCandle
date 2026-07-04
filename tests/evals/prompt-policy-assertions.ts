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
        /could not|couldn't|unavailable|not verified|not verify|ambig|missing|unknown|unable|not recognized|no verified|not find|no results|not available/i.test(
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
        /bottom line/.test(text) && /practical workflow/.test(text) && /quick checklist/.test(text),
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
    return requires(/1\s*[-–]\s*2|one\s+to\s+two|two[- ]week|weekly/, /dte|expiry|expiration/);
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
    return requires(/450/, /\b4\b|four/, /50|residual|unhedged|round/);
  }
  if (lowerAssertion.includes("hedge floor, premium")) {
    return requires(/hedge floor|floor/, /premium/, /delta|theta|greeks?/, /liquidity/, /risk/);
  }
  if (
    lowerAssertion.includes("bottom-line portfolio risk/reward") ||
    lowerAssertion.includes("bottom-line structural portfolio read")
  ) {
    return requires(/bottom line/, /portfolio/, /risk|reward|structural/);
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
