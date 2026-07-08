import { dirname } from "node:path";
import type { EvalTrace } from "./types.js";

export interface GeneratedFinancePrompt {
  id: string;
  prompt: string;
  topic: string;
  complexity: "simple" | "moderate" | "complex";
  evaluationFocus: string;
}

export interface FrozenCompetitivePanelPrompt extends GeneratedFinancePrompt {
  lossClass: string;
  promptPolicyManifestId: string;
}

export interface PromptGenerationOptions {
  count: number;
  seed?: string;
  asOfDate: string;
  savedStateSummary?: string;
}

export interface SeededMarketStateFixture {
  lots: Array<{
    symbol: string;
    name: string;
    assetType: "equity" | "etf";
    quantity: number;
    avgCost: number;
  }>;
  watchlist: Array<{ symbol: string; name: string }>;
}

/**
 * Deterministic user state for saved-state competitive prompts. Sector-diverse
 * and generic on purpose; benchmark literals stay here, never in production
 * prompts (see prompt-debt-guard).
 */
export const COMPETITIVE_STATE_FIXTURE: SeededMarketStateFixture = {
  lots: [
    { symbol: "SPY", name: "SPDR S&P 500 ETF Trust", assetType: "etf", quantity: 60, avgCost: 480 },
    { symbol: "AAPL", name: "Apple Inc.", assetType: "equity", quantity: 40, avgCost: 175 },
    {
      symbol: "XLE",
      name: "Energy Select Sector SPDR Fund",
      assetType: "etf",
      quantity: 100,
      avgCost: 85,
    },
  ],
  watchlist: [
    { symbol: "MSFT", name: "Microsoft Corporation" },
    { symbol: "JPM", name: "JPMorgan Chase & Co." },
  ],
};

export const FROZEN_COMPETITIVE_PANEL: FrozenCompetitivePanelPrompt[] = [
  {
    id: "frozen-portfolio-review-not-builder",
    prompt:
      "Critically evaluate a 60/40 portfolio for the next year. Do not build a new portfolio; just review the existing allocation.",
    topic: "portfolio review",
    complexity: "moderate",
    evaluationFocus:
      "Preserve the user's review request and avoid turning an existing-allocation critique into portfolio construction.",
    lossClass: "portfolio-review-not-builder",
    promptPolicyManifestId: "existing-allocation-review",
  },
  {
    id: "frozen-covered-call-dte-preservation",
    prompt:
      "I own 100 shares of DRAM at a $51 cost basis. NVDA earnings are today, but I want a covered call 1-2 weeks out. What strike and expiry should I look at?",
    topic: "options existing position",
    complexity: "complex",
    evaluationFocus:
      "Preserve the owned underlying, catalyst context, cost basis, and requested 1-2 week DTE instead of drifting to the catalyst ticker or same-day expiry.",
    lossClass: "1-2 weeks DTE preservation",
    promptPolicyManifestId: "covered-call-dte-preservation",
  },
  {
    id: "frozen-protective-put-not-bullish-call",
    prompt:
      "NVDA earnings are today. I own 200 shares of AMD. What protective put should I buy for the next month?",
    topic: "options existing position",
    complexity: "complex",
    evaluationFocus:
      "Keep the strategy as a protective put on AMD sized to the owned share count, not a bullish call or catalyst-ticker options trade.",
    lossClass: "protective-put-not-bullish-call",
    promptPolicyManifestId: "protective-put-routing",
  },
  {
    id: "frozen-unknown-ticker-no-dead-end",
    prompt:
      "I hold 300 shares of ZZZZ and earnings are tonight. Should I trim, hedge, or hold through it?",
    topic: "unknown ticker event risk",
    complexity: "complex",
    evaluationFocus:
      "Avoid dead-ending on an unknown ticker: disclose unverifiability, avoid fabricated earnings facts, and still give a useful event-risk framework.",
    lossClass: "unknown-ticker-no-dead-end",
    promptPolicyManifestId: "unknown-ticker-earnings-risk",
  },
  {
    id: "frozen-hedge-sizing-with-share-count",
    prompt:
      "I own 450 shares of AAPL and want downside protection through the next month. How many puts should I consider and what tradeoffs matter?",
    topic: "options hedge sizing",
    complexity: "complex",
    evaluationFocus:
      "Use the stated share count to size protective puts by 100-share contracts and explain residual unhedged shares and hedge tradeoffs.",
    lossClass: "hedge sizing with share count",
    promptPolicyManifestId: "hedge-sizing-share-count",
  },
];

export function frozenCompetitivePanelFromEnv(
  env: Record<string, string | undefined>,
): FrozenCompetitivePanelPrompt[] | null {
  return env.OPENCANDLE_COMPETITIVE_PANEL === "frozen" ? FROZEN_COMPETITIVE_PANEL : null;
}

export function buildSavedStateSummary(fixture: SeededMarketStateFixture): string {
  const lines = ["The user's saved OpenCandle state:"];
  lines.push("Portfolio lots:");
  for (const lot of fixture.lots) {
    lines.push(
      `- ${lot.symbol} (${lot.name}): ${lot.quantity} shares @ $${lot.avgCost.toFixed(2)}`,
    );
  }
  lines.push("Watchlist:");
  for (const item of fixture.watchlist) {
    lines.push(`- ${item.symbol} (${item.name})`);
  }
  return lines.join("\n");
}

export interface CompetitorAnswer {
  id: string;
  label: string;
  provider: string;
  model: string;
  answer: string;
  error?: string;
  cachedFromReport?: string;
}

export interface ComparisonJudgeInput {
  prompt: GeneratedFinancePrompt;
  asOfDate: string;
  openCandleTrace: EvalTrace;
  competitorAnswers: CompetitorAnswer[];
  savedStateSummary?: string;
}

export interface ComparisonJudgment {
  winner: string;
  openCandleScore: number;
  competitorScores: Record<string, number>;
  reason: string;
  openCandleDidBetter: string[];
  competitorsDidBetter: Record<string, string[]>;
  openCandleImprovementIdeas: string[];
}

export interface CompetitiveCaseAnalysis {
  id: string;
  prompt: string;
  winner: string;
  openCandleScore: number;
  competitorScores: Record<string, number>;
  scoreGap: number;
  lostTo?: string;
  judgeReason: string;
  openCandleDidBetter: string[];
  competitorsDidBetter: Record<string, string[]>;
  openCandleImprovementIdeas: string[];
  improvementThemes: string[];
  failureClassifications: string[];
  planning?: {
    taskFamily?: string;
    evidencePlanId?: string;
    structuredCheckFailures?: unknown[];
    retryEligible?: boolean;
  };
  toolCalls: string[];
  cachedCompetitors: string[];
}

export interface CompetitiveThemeSummary {
  theme: string;
  count: number;
  caseIds: string[];
  ideas: string[];
}

export interface CompetitiveReportAnalysis {
  generatedAt?: string;
  reportPath?: string;
  promptCount: number;
  openCandleWins: number;
  losses: number;
  ties: number;
  cases: CompetitiveCaseAnalysis[];
  themeSummary: CompetitiveThemeSummary[];
}

export interface CompetitiveModelCandidate {
  provider: string;
  id: string;
  contextWindow?: number;
}

export interface CompetitiveReportCacheEntry {
  path: string;
  report: unknown;
}

const PREFERRED_CONTEXT_WINDOW = 128_000;

export function buildPromptGenerationPrompt(options: PromptGenerationOptions): string {
  const seedLine = options.seed
    ? `Use this run seed to vary the prompt set: ${options.seed}`
    : "Invent a fresh prompt set.";
  return `Generate ${options.count} realistic finance prompts for comparing OpenCandle against generic no-tool finance agents such as Claude, Codex, and Gemini.

Current date for this benchmark run: ${options.asOfDate}

${seedLine}

The set must cover general finance, investing, portfolio construction, market structure, risk, macro, company research, options, sentiment, and educational questions when useful.

Prompt wording rules:
- Write each prompt as an average retail investor would ask it in chat.
- Use messy, conversational wording when natural: "thinking about buying", "what should I do", "does this look risky", "explain this to me".
- Do not mention OpenCandle, generic agents, benchmarks, evals, judges, routing, providers, APIs, or tools inside the user-facing prompt.
- Do not ask the user to compare tool coverage, source availability, or evidence categories unless a normal user would ask that explicitly.
- Prefer realistic constraints users actually give, such as budget, holdings, cost basis, time horizon, worry, target, stop, or "today/right now".

${
  options.savedStateSummary
    ? `${options.savedStateSummary}

The user has saved this state in their assistant. Make about two of the prompts naturally reference it the way a returning user would ("my portfolio", "my watchlist", "the stocks I'm watching") without enumerating the saved rows verbatim. The remaining prompts should not depend on saved state.

`
    : ""
}Do not bias toward prompts where OpenCandle obviously has a tool advantage. Include prompts where:
- OpenCandle may be better because it can gather evidence or run tools.
- A generic agent may be better because the prompt mainly needs synthesis, explanation, or judgment.
- The winner is ambiguous and the comparison should reveal what OpenCandle needs to improve.

Return JSON only:
{
  "prompts": [
    {
      "id": "short-kebab-id",
      "prompt": "user-facing prompt",
      "topic": "short topic",
      "complexity": "simple|moderate|complex",
      "evaluationFocus": "what the comparison should inspect"
    }
  ]
}`;
}

export function buildGenericAgentPrompt(
  prompt: string,
  options: { agentName: string; asOfDate: string; savedStateSummary?: string },
): string {
  return `You are ${options.agentName}, acting as a general finance assistant without live tools, browsing, private data, or market-data APIs.

Current date: ${options.asOfDate}

Answer the user's prompt as well as you can. Be explicit when current data would be needed and you cannot verify it. Do not pretend to have live prices, filings, options chains, sentiment, or macro probabilities.
${
  options.savedStateSummary
    ? `
Context the user previously shared with you:
${options.savedStateSummary}
`
    : ""
}
User prompt:
${prompt}`;
}

export function buildComparisonJudgePrompt(input: ComparisonJudgeInput): string {
  const toolCalls = input.openCandleTrace.toolCalls.map((call) => ({
    name: call.name,
    args: call.args,
  }));
  const competitorAnswers = input.competitorAnswers
    .map(
      (
        competitor,
      ) => `Agent: ${competitor.label} (${competitor.id}, ${competitor.provider}/${competitor.model})
Answer:
${competitor.answer}`,
    )
    .join("\n\n---\n\n");
  const planningMetadata = input.openCandleTrace.planning
    ? {
        taskFamily: input.openCandleTrace.planning.taskFamily,
        commitmentMode: input.openCandleTrace.planning.commitmentMode,
        policyCardId: input.openCandleTrace.planning.policyCardId,
        evidencePlanId: input.openCandleTrace.planning.evidencePlanId,
        answerContractId: input.openCandleTrace.planning.answerContractId,
        structuredCheckIds: input.openCandleTrace.planning.structuredCheckIds,
        capabilityGapIds: input.openCandleTrace.planning.capabilityGapIds,
        structuredCheckFailures: input.openCandleTrace.planning.structuredCheckFailures.map(
          (failure) => ({
            checkId: failure.checkId,
            failureReason: failure.failureReason,
          }),
        ),
        retryEligibility: input.openCandleTrace.planning.retryEligibility,
      }
    : null;
  const winnerOptions = [
    "opencandle",
    ...input.competitorAnswers.map((competitor) => competitor.id),
    "tie",
  ].join("|");
  const scoreShape = Object.fromEntries(
    input.competitorAnswers.map((competitor) => [competitor.id, 0]),
  );
  const didBetterShape = Object.fromEntries(
    input.competitorAnswers.map((competitor) => [competitor.id, ["..."]]),
  );
  return `Compare OpenCandle against generic no-tool finance agents for the same user prompt.

Current date: ${input.asOfDate}

User prompt:
${input.prompt.prompt}

Evaluation focus:
${input.prompt.evaluationFocus}

OpenCandle classification:
${JSON.stringify(input.openCandleTrace.classification)}

OpenCandle tool calls:
${JSON.stringify(toolCalls, null, 2)}

OpenCandle planning metadata:
${JSON.stringify(planningMetadata, null, 2)}

OpenCandle answer:
${input.openCandleTrace.text}

Generic no-tool agent answers:
${competitorAnswers}

Judge the answers on usefulness, correctness, evidence, clarity, and honesty about uncertainty. Score each answer on a 0-10 scale anchored as: 10 = excellent on all five criteria with no material flaws; 7 = good with minor gaps; 5 = mixed, useful but with a significant gap (missing evidence, vagueness, or an unsupported claim); 3 = weak, mostly unhelpful or partly wrong; 0 = harmful or fabricated. Use the full scale; do not cluster at 7-8 by default. It is acceptable for any generic agent to win. When one does, explain why and what OpenCandle should improve. Treat dates on or before the current date as current or historical, not future-dated.

${
  input.savedStateSummary
    ? `Saved state for this user (both agents had access to these facts):
${input.savedStateSummary}

When the prompt concerns the user's own portfolio or watchlist, verify each answer against this saved state: penalize answers that ignore it, misquote quantities or cost basis, or invent holdings. Reward answers that connect the question to the specific saved positions.

`
    : ""
}Do not reward fabricated current facts. A no-tool agent that presents unverified live prices, filings, options chains, sentiment, macro probabilities, or filing changes as factual should be penalized for correctness and honesty even if the answer sounds specific. For prompts about current filings or live market data, prefer a sourced OpenCandle answer or an honest generic limitation over an unsourced no-tool answer that invents details.

When suggesting OpenCandle improvements, make them layer-specific where possible: routing, planning, evidence-plan, tool-capability, evidence-normalization, answer-contract, structured-check, retry-eligibility, synthesis, or judge/harness.

Return JSON only:
{
  "winner": "${winnerOptions}",
  "openCandleScore": 0,
  "competitorScores": ${JSON.stringify(scoreShape)},
  "reason": "short explanation",
  "openCandleDidBetter": ["..."],
  "competitorsDidBetter": ${JSON.stringify(didBetterShape)},
  "openCandleImprovementIdeas": ["..."]
}`;
}

export function buildComparisonJudgeRetryPrompt(input: {
  originalPrompt: string;
  invalidResponse: string;
  errorMessage: string;
}): string {
  return `${input.originalPrompt}

Your previous comparison judgment was invalid JSON and could not be parsed.
Parse error: ${input.errorMessage}

Invalid response:
${input.invalidResponse}

Return JSON only. Do not include markdown fences, comments, trailing prose, or malformed arrays/objects.`;
}

export function parseGeneratedPrompts(raw: string): GeneratedFinancePrompt[] {
  const value = parseJsonPayload(raw);
  const prompts = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.prompts)
      ? value.prompts
      : [];

  return prompts.map((item, index) => normalizeGeneratedPrompt(item, index));
}

export function findCachedPromptMetadata(
  cache: CompetitiveReportCacheEntry[],
  promptText: string,
): GeneratedFinancePrompt | null {
  for (const entry of cache) {
    for (const result of reportResults(entry.report)) {
      const prompt = promptFromResult(result);
      if (prompt?.prompt === promptText) return prompt;
    }
  }
  return null;
}

export function findCachedCompetitorAnswer(
  cache: CompetitiveReportCacheEntry[],
  promptText: string,
  competitorId: string,
): CompetitorAnswer | null {
  for (const entry of cache) {
    for (const result of reportResults(entry.report)) {
      const prompt = promptFromResult(result);
      if (prompt?.prompt !== promptText) continue;
      const answers = competitorAnswersFromResult(result);
      // Failed baselines record a failure-placeholder answer with `error`
      // set; only clean answers are reusable — a crashed baseline must be
      // retried live (or skipped at preflight) on later runs, not frozen
      // into the cache.
      const answer = answers.find((candidate) => candidate.id === competitorId && !candidate.error);
      if (!answer) continue;
      return {
        ...answer,
        cachedFromReport: entry.path,
      };
    }
  }
  return null;
}

export function parseComparisonJudgment(
  raw: string,
  options?: { allowedWinners?: string[] },
): ComparisonJudgment {
  const value = parseJsonPayload(raw);
  if (!isRecord(value)) throw new Error("Comparison judgment must be a JSON object");

  let winner = stringValue(value.winner).trim().toLowerCase();
  if (!winner) throw new Error("Comparison judgment winner is required");
  if (options?.allowedWinners) {
    const allowed = options.allowedWinners.map((candidate) => candidate.toLowerCase());
    if (!allowed.includes(winner)) {
      throw new Error(
        `Comparison judgment winner "${winner}" is not one of: ${options.allowedWinners.join(", ")}`,
      );
    }
    winner = options.allowedWinners[allowed.indexOf(winner)];
  }

  return {
    winner,
    openCandleScore: numberValue(value.openCandleScore),
    competitorScores: numberRecord(value.competitorScores),
    reason: stringValue(value.reason),
    openCandleDidBetter: stringArray(value.openCandleDidBetter),
    competitorsDidBetter: stringArrayRecord(value.competitorsDidBetter),
    openCandleImprovementIdeas: stringArray(value.openCandleImprovementIdeas),
  };
}

export function analyzeCompetitiveReport(
  report: unknown,
  options: { reportPath?: string } = {},
): CompetitiveReportAnalysis {
  const cases = reportResults(report).flatMap((result): CompetitiveCaseAnalysis[] => {
    const prompt = promptFromResult(result);
    const judgment = judgmentFromResult(result);
    if (!prompt || !judgment) return [];
    const bestCompetitor = bestCompetitorScore(judgment.competitorScores);
    const lostTo =
      judgment.winner !== "opencandle" && judgment.winner !== "tie" ? judgment.winner : undefined;
    const ideas = judgment.openCandleImprovementIdeas;
    return [
      {
        id: prompt.id,
        prompt: prompt.prompt,
        winner: judgment.winner,
        openCandleScore: judgment.openCandleScore,
        competitorScores: judgment.competitorScores,
        scoreGap: bestCompetitor ? bestCompetitor.score - judgment.openCandleScore : 0,
        lostTo,
        judgeReason: judgment.reason,
        openCandleDidBetter: judgment.openCandleDidBetter,
        competitorsDidBetter: judgment.competitorsDidBetter,
        openCandleImprovementIdeas: ideas,
        improvementThemes: unique(ideas.flatMap(classifyImprovementIdea)),
        failureClassifications: unique(ideas.flatMap(classifyFailureLayer)),
        planning: planningFromResult(result),
        toolCalls: toolCallsFromResult(result),
        cachedCompetitors: competitorAnswersFromResult(result)
          .filter((answer) => answer.cachedFromReport)
          .map((answer) => answer.id),
      },
    ];
  });

  return {
    generatedAt: isRecord(report) ? stringValue(report.generatedAt) || undefined : undefined,
    reportPath: options.reportPath,
    promptCount: cases.length,
    openCandleWins: cases.filter((c) => c.winner === "opencandle").length,
    losses: cases.filter((c) => c.lostTo).length,
    ties: cases.filter((c) => c.winner === "tie").length,
    cases: [...cases].sort((a, b) => b.scoreGap - a.scoreGap),
    themeSummary: summarizeImprovementThemes(cases),
  };
}

export function formatCompetitiveReportAnalysisMarkdown(
  analysis: CompetitiveReportAnalysis,
): string {
  const lines: string[] = [];
  lines.push("# Competitive Report Analysis");
  if (analysis.reportPath) lines.push(`Report: ${analysis.reportPath}`);
  if (analysis.generatedAt) lines.push(`Generated: ${analysis.generatedAt}`);
  lines.push("");
  lines.push(
    `Summary: OC wins ${analysis.openCandleWins}, losses ${analysis.losses}, ties ${analysis.ties}, cases ${analysis.promptCount}.`,
  );

  if (analysis.themeSummary.length > 0) {
    lines.push("");
    lines.push("## Improvement Themes");
    for (const theme of analysis.themeSummary) {
      lines.push(`- ${theme.theme} (${theme.count}): ${theme.ideas.slice(0, 2).join(" / ")}`);
    }
  }

  lines.push("");
  lines.push("## Cases");
  for (const c of analysis.cases) {
    const scores = Object.entries(c.competitorScores)
      .map(([id, score]) => `${id} ${score}`)
      .join(", ");
    lines.push(`### ${c.id}`);
    lines.push(
      `Winner: ${c.winner}. Scores: OC ${c.openCandleScore}${scores ? `, ${scores}` : ""}.`,
    );
    if (c.lostTo) lines.push(`Loss gap: ${c.lostTo} beat OC by ${c.scoreGap}.`);
    lines.push(`Prompt: ${c.prompt}`);
    lines.push("");
    lines.push("Judge reason:");
    lines.push(c.judgeReason || "(none)");
    if (Object.keys(c.competitorsDidBetter).length > 0) {
      lines.push("");
      lines.push("Competitors did better:");
      for (const [id, items] of Object.entries(c.competitorsDidBetter)) {
        for (const item of items) lines.push(`- ${id}: ${item}`);
      }
    }
    if (c.openCandleImprovementIdeas.length > 0) {
      lines.push("");
      lines.push("OC improvement ideas:");
      for (const idea of c.openCandleImprovementIdeas) lines.push(`- ${idea}`);
    }
    const failureClassifications = c.failureClassifications ?? [];
    if (failureClassifications.length > 0) {
      lines.push("");
      lines.push(`Failure layers: ${failureClassifications.join(", ")}`);
    }
    if (c.planning) {
      lines.push(
        `Planning: ${c.planning.taskFamily ?? "(unknown)"} / ${c.planning.evidencePlanId ?? "(unknown evidence plan)"}.`,
      );
    }
    if (c.toolCalls.length > 0) {
      lines.push("");
      lines.push(`OC tools: ${c.toolCalls.join(", ")}`);
    }
    if (c.cachedCompetitors.length > 0) {
      lines.push(`Cached competitors: ${c.cachedCompetitors.join(", ")}`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function competitiveReportAnalysisPath(reportPath: string): string {
  if (reportPath.endsWith("_competitive-finance.json")) {
    return reportPath.replace(/_competitive-finance\.json$/, "_competitive-finance-analysis.md");
  }
  if (reportPath.endsWith(".json")) {
    return `${reportPath.slice(0, -".json".length)}-competitive-finance-analysis.md`;
  }
  return `${reportPath}-competitive-finance-analysis.md`;
}

export function fixedPromptFromEnv(
  env: Record<string, string | undefined>,
): GeneratedFinancePrompt | null {
  const prompt = env.OPENCANDLE_COMPETITIVE_PROMPT?.trim();
  if (!prompt) return null;

  const complexity = env.OPENCANDLE_COMPETITIVE_PROMPT_COMPLEXITY?.trim();
  return {
    id: env.OPENCANDLE_COMPETITIVE_PROMPT_ID?.trim() || "fixed-prompt",
    prompt,
    topic: env.OPENCANDLE_COMPETITIVE_PROMPT_TOPIC?.trim() || "fixed prompt",
    complexity: complexity === "simple" || complexity === "complex" ? complexity : "moderate",
    evaluationFocus:
      env.OPENCANDLE_COMPETITIVE_PROMPT_FOCUS?.trim() ||
      "Compare OpenCandle against generic agents on the same fixed prompt and identify concrete OpenCandle improvements.",
  };
}

export function extractUsableAnswerFromCliFailure(message: string): string | null {
  const match = /\bfailed:\s*/i.exec(message);
  const candidate = (match ? message.slice(match.index + match[0].length) : message).trim();
  if (!candidate) return null;
  if (
    /^(Internal error|Error handling request|Gemini CLI ACP startup timed out|exit status)\b/i.test(
      candidate,
    )
  ) {
    return null;
  }
  if (
    /Failed to authenticate|Invalid authentication credentials|Permission denied/i.test(candidate)
  ) {
    return null;
  }
  return candidate;
}

export function selectCliFailureMessage(options: {
  stdout: string;
  stderr: string;
  status?: number | null;
  ignoreStderr?: boolean;
}): string {
  const stdout = options.stdout.trim();
  const stderr = options.stderr.trim();
  if (stdout) return stdout;
  if (!options.ignoreStderr && stderr) return stderr;
  return `exit status ${options.status ?? "unknown"}`;
}

export function buildPortableAgentPath(env: {
  PATH?: string;
  HOME?: string;
  execPath?: string;
  cwd?: string;
}): string {
  const parts = [
    `${env.cwd ?? process.cwd()}/node_modules/.bin`,
    env.HOME ? `${env.HOME}/.local/bin` : "",
    env.execPath ? dirname(env.execPath) : "",
    "/opt/homebrew/bin",
    env.PATH ?? "",
  ];
  return parts.filter(Boolean).join(":");
}

export function selectDefaultCompetitiveModel<T extends CompetitiveModelCandidate>(options: {
  googleAuthConfigured: boolean;
  googleModel: T;
  available: T[];
}): T | undefined {
  if (options.googleAuthConfigured) return options.googleModel;
  return (
    options.available.find((model) => (model.contextWindow ?? 0) >= PREFERRED_CONTEXT_WINDOW) ??
    options.available[0]
  );
}

export function competitiveBenchmarkExitCode(): number {
  return 0;
}

export function competitivePreflightTimeoutMs(env: Record<string, string | undefined>): number {
  const parsed = Number(env.OPENCANDLE_COMPETITIVE_PREFLIGHT_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60_000;
}

export function selectCompetitiveCodexModel(env: Record<string, string | undefined>): string {
  return env.OPENCANDLE_COMPETITIVE_CODEX_MODEL ?? "gpt-5.3-codex-spark";
}

export function selectCompetitiveGeminiBaseline(env: Record<string, string | undefined>): {
  mode: "api" | "acpx";
  provider: string;
  model: string;
} {
  if (env.OPENCANDLE_COMPETITIVE_GEMINI_AGENT === "acpx") {
    return { mode: "acpx", provider: "acpx/gemini", model: "subscription" };
  }
  const model = env.OPENCANDLE_COMPETITIVE_GEMINI_MODEL ?? "gemini-2.5-flash";
  if (
    env.OPENCANDLE_COMPETITIVE_GEMINI_AGENT === "api" ||
    env.GEMINI_API_KEY ||
    env.GOOGLE_API_KEY
  ) {
    return { mode: "api", provider: "google", model };
  }
  return { mode: "acpx", provider: "acpx/gemini", model: "subscription" };
}

export function shouldRetryCompetitiveModelCall(
  message: string,
  attempt: number,
  maxAttempts: number,
): boolean {
  if (attempt >= maxAttempts) return false;
  return /\b(fetch failed|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|rate limit|429|500|502|503|504)\b/i.test(
    message,
  );
}

/**
 * Pi's ModelRegistry.getApiKeyAndHeaders resolves AuthStorage credentials
 * with includeFallback: false, so provider env keys (for example
 * GEMINI_API_KEY for google) are never consulted. The competitive eval runs
 * in environments where .env is the only credential source, so when the
 * registry resolves no API key, seed the env key as a runtime AuthStorage
 * override and re-resolve. The runtime override has top priority in
 * AuthStorage, so the same key also reaches the OpenCandle session runner
 * that shares the AuthStorage instance. Test-harness-only behavior; the
 * production auth path is unchanged.
 */
export async function resolveRequestAuthWithEnvApiKeyFallback<
  T extends { ok: boolean; apiKey?: string },
>(options: {
  provider: string;
  resolveRequestAuth: () => Promise<T>;
  getEnvApiKey: (provider: string) => string | undefined;
  setRuntimeApiKey: (provider: string, apiKey: string) => void;
}): Promise<T> {
  const initial = await options.resolveRequestAuth();
  if (initial.ok && initial.apiKey) return initial;
  const envKey = options.getEnvApiKey(options.provider);
  if (!envKey) return initial;
  options.setRuntimeApiKey(options.provider, envKey);
  return options.resolveRequestAuth();
}

function normalizeGeneratedPrompt(item: unknown, index: number): GeneratedFinancePrompt {
  if (!isRecord(item)) throw new Error(`Generated prompt ${index + 1} must be an object`);
  const complexity = stringValue(item.complexity);
  if (complexity !== "simple" && complexity !== "moderate" && complexity !== "complex") {
    throw new Error(`Generated prompt ${index + 1} has invalid complexity: ${complexity}`);
  }
  return {
    id: stringValue(item.id) || `prompt-${index + 1}`,
    prompt: stringValue(item.prompt),
    topic: stringValue(item.topic),
    complexity,
    evaluationFocus: stringValue(item.evaluationFocus),
  };
}

function reportResults(report: unknown): unknown[] {
  if (!isRecord(report) || !Array.isArray(report.results)) return [];
  return report.results;
}

function promptFromResult(result: unknown): GeneratedFinancePrompt | null {
  if (!isRecord(result) || !isRecord(result.prompt)) return null;
  const prompt = result.prompt;
  const text = stringValue(prompt.prompt);
  if (!text) return null;
  const complexity = stringValue(prompt.complexity);
  return {
    id: stringValue(prompt.id) || "cached-prompt",
    prompt: text,
    topic: stringValue(prompt.topic),
    complexity: complexity === "simple" || complexity === "complex" ? complexity : "moderate",
    evaluationFocus: stringValue(prompt.evaluationFocus),
  };
}

function competitorAnswersFromResult(result: unknown): CompetitorAnswer[] {
  if (!isRecord(result) || !Array.isArray(result.competitorAnswers)) return [];
  return result.competitorAnswers.flatMap((item): CompetitorAnswer[] => {
    if (!isRecord(item)) return [];
    const id = stringValue(item.id);
    const answer = stringValue(item.answer);
    if (!id || !answer) return [];
    return [
      {
        id,
        label: stringValue(item.label) || id,
        provider: stringValue(item.provider),
        model: stringValue(item.model),
        answer,
        ...(typeof item.error === "string" ? { error: item.error } : {}),
        ...(typeof item.cachedFromReport === "string"
          ? { cachedFromReport: item.cachedFromReport }
          : {}),
      },
    ];
  });
}

function judgmentFromResult(result: unknown): ComparisonJudgment | null {
  if (!isRecord(result) || !isRecord(result.judgment)) return null;
  const judgment = result.judgment;
  const winner = stringValue(judgment.winner);
  if (!winner) return null;
  return {
    winner,
    openCandleScore: numberValue(judgment.openCandleScore),
    competitorScores: numberRecord(judgment.competitorScores),
    reason: stringValue(judgment.reason),
    openCandleDidBetter: stringArray(judgment.openCandleDidBetter),
    competitorsDidBetter: stringArrayRecord(judgment.competitorsDidBetter),
    openCandleImprovementIdeas: stringArray(judgment.openCandleImprovementIdeas),
  };
}

function toolCallsFromResult(result: unknown): string[] {
  if (
    !isRecord(result) ||
    !isRecord(result.openCandleTrace) ||
    !Array.isArray(result.openCandleTrace.toolCalls)
  ) {
    return [];
  }
  return unique(
    result.openCandleTrace.toolCalls.flatMap((call): string[] => {
      if (!isRecord(call)) return [];
      const name = stringValue(call.name);
      return name ? [name] : [];
    }),
  );
}

function bestCompetitorScore(scores: Record<string, number>): { id: string; score: number } | null {
  let best: { id: string; score: number } | null = null;
  for (const [id, score] of Object.entries(scores)) {
    if (!best || score > best.score) best = { id, score };
  }
  return best;
}

function summarizeImprovementThemes(cases: CompetitiveCaseAnalysis[]): CompetitiveThemeSummary[] {
  const byTheme = new Map<string, CompetitiveThemeSummary>();
  for (const c of cases) {
    for (const idea of c.openCandleImprovementIdeas) {
      for (const theme of classifyImprovementIdea(idea)) {
        const current = byTheme.get(theme) ?? { theme, count: 0, caseIds: [], ideas: [] };
        current.count += 1;
        if (!current.caseIds.includes(c.id)) current.caseIds.push(c.id);
        if (!current.ideas.includes(idea)) current.ideas.push(idea);
        byTheme.set(theme, current);
      }
    }
  }
  return Array.from(byTheme.values()).sort(
    (a, b) => b.count - a.count || a.theme.localeCompare(b.theme),
  );
}

function planningFromResult(result: unknown): CompetitiveCaseAnalysis["planning"] | undefined {
  if (
    !isRecord(result) ||
    !isRecord(result.openCandleTrace) ||
    !isRecord(result.openCandleTrace.planning)
  ) {
    return undefined;
  }
  const planning = result.openCandleTrace.planning;
  const retryEligibility = isRecord(planning.retryEligibility)
    ? planning.retryEligibility
    : undefined;
  return {
    taskFamily: stringValue(planning.taskFamily) || undefined,
    evidencePlanId: stringValue(planning.evidencePlanId) || undefined,
    structuredCheckFailures: Array.isArray(planning.structuredCheckFailures)
      ? planning.structuredCheckFailures
      : undefined,
    retryEligible:
      typeof retryEligibility?.eligible === "boolean" ? retryEligibility.eligible : undefined,
  };
}

function classifyImprovementIdea(idea: string): string[] {
  const lower = idea.toLowerCase();
  const themes: string[] = [];
  if (/\b(data|fetch|retriev|source|fred|macro|indicator|tool|current|live)\b/.test(lower)) {
    themes.push("data retrieval and integration");
  }
  themes.push(...classifyFailureLayer(idea));
  if (/\b(synthesis|connect|integrat|context|explain|why|implication)\b/.test(lower)) {
    themes.push("synthesis and reasoning");
  }
  if (
    /\b(portfolio|sleeve|allocation|component|concentration|duration|credit|tips|emerging|tech)\b/.test(
      lower,
    )
  ) {
    themes.push("portfolio-specific nuance");
  }
  if (/\b(action|adjust|rebalance|trim|specific|percentage|condition|mitigat)\b/.test(lower)) {
    themes.push("actionability");
  }
  if (/\b(structure|format|table|summar|lead|list|begin|composition)\b/.test(lower)) {
    themes.push("answer structure");
  }
  if (/\b(route|router|classification|workflow|clarification|budget|diagnostic)\b/.test(lower)) {
    themes.push("routing and harness");
  }
  return themes.length > 0 ? themes : ["other"];
}

function classifyFailureLayer(idea: string): string[] {
  const lower = idea.toLowerCase();
  const layers: string[] = [];
  if (/\b(route|router|classification|workflow)\b/.test(lower)) layers.push("routing");
  if (/\b(plan|planning|task family|task-family)\b/.test(lower)) layers.push("planning");
  if (/\b(evidence plan|market status|temporal|freshness|source coverage)\b/.test(lower))
    layers.push("evidence-plan");
  if (
    /\b(tool|provider|data|holdings overlap|cash yield|brokerage|calendar|earnings|live)\b/.test(
      lower,
    )
  )
    layers.push("tool-capability");
  if (/\b(normaliz|provider gap|degradation|connect|credential)\b/.test(lower))
    layers.push("evidence-normalization");
  if (/\b(answer contract|contract|tradeoff framing|framework|commitment)\b/.test(lower))
    layers.push("answer-contract");
  if (/\b(structured check|check|validator|disclosure)\b/.test(lower))
    layers.push("structured-check");
  if (/\b(retry|repair)\b/.test(lower)) layers.push("retry-eligibility");
  if (/\b(synthesis|reasoning|explain|connect)\b/.test(lower)) layers.push("synthesis");
  if (/\b(judge|harness|eval|benchmark|parser)\b/.test(lower)) layers.push("judge/harness");
  return layers.length > 0 ? layers : ["synthesis"];
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function parseJsonPayload(raw: string): unknown {
  const trimmed = raw.trim();
  const parseCandidate = (candidate: string): unknown => {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      const repaired = repairMalformedJson(candidate);
      if (repaired !== candidate) return JSON.parse(repaired);
      throw error;
    }
  };

  try {
    return parseCandidate(trimmed);
  } catch {
    const start = Math.min(
      ...["{", "["].map((char) => {
        const index = trimmed.indexOf(char);
        return index === -1 ? Number.POSITIVE_INFINITY : index;
      }),
    );
    const end = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
    if (!Number.isFinite(start) || end <= start) throw new Error("No JSON payload found");
    return parseCandidate(trimmed.slice(start, end + 1));
  }
}

function repairMalformedJson(payload: string): string {
  return trimAfterFirstCompleteJson(balanceJsonDelimiters(repairCommonMissingCommas(payload)));
}

function repairCommonMissingCommas(payload: string): string {
  const jsonValueEnd =
    /("(?:[^"\\]|\\.)*"|\b(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)|\]|\})/g;
  return payload.replace(jsonValueEnd, (match, value: string, offset: number, full: string) => {
    const rest = full.slice(offset + match.length);
    const whitespace = rest.match(/^\s*/)?.[0] ?? "";
    const next = rest.slice(whitespace.length, whitespace.length + 1);
    if (!whitespace.includes("\n")) return match;
    if (!next || next === "," || next === "]" || next === "}" || next === ":") return match;
    if (next === '"' || next === "{" || next === "[" || next === "-" || /\d|t|f|n/.test(next)) {
      return `${value},`;
    }
    return match;
  });
}

function balanceJsonDelimiters(payload: string): string {
  let repaired = "";
  const stack: Array<"{" | "["> = [];
  let inString = false;
  let escaped = false;

  for (const char of payload) {
    repaired += char;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = inString;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === "{" || char === "[") {
      stack.push(char);
      continue;
    }

    if (char === "}" || char === "]") {
      const expected = char === "}" ? "{" : "[";
      if (stack.at(-1) === expected) {
        stack.pop();
        continue;
      }
      repaired = repaired.slice(0, -1);
      if (!stack.includes(expected)) continue;
      while (stack.length > 0 && stack.at(-1) !== expected) {
        repaired += closeDelimiter(stack.pop());
      }
      repaired += char;
      if (stack.at(-1) === expected) stack.pop();
    }
  }

  while (stack.length > 0) {
    repaired += closeDelimiter(stack.pop());
  }
  return repaired;
}

function trimAfterFirstCompleteJson(payload: string): string {
  const stack: Array<"{" | "["> = [];
  let inString = false;
  let escaped = false;
  let started = false;

  for (let index = 0; index < payload.length; index += 1) {
    const char = payload[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = inString;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === "{" || char === "[") {
      started = true;
      stack.push(char);
      continue;
    }
    if (char === "}" || char === "]") {
      const expected = char === "}" ? "{" : "[";
      if (stack.at(-1) !== expected) continue;
      stack.pop();
      if (started && stack.length === 0) return payload.slice(0, index + 1);
    }
  }

  return payload;
}

function closeDelimiter(open: "{" | "[" | undefined): string {
  return open === "[" ? "]" : "}";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function numberRecord(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === "number" && Number.isFinite(entry[1]),
    ),
  );
}

function stringArrayRecord(value: unknown): Record<string, string[]> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).map(([key, arrayValue]) => [key, stringArray(arrayValue)]),
  );
}
