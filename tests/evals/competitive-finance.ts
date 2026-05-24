import { dirname } from "node:path";
import type { EvalTrace } from "./types.js";

export interface GeneratedFinancePrompt {
  id: string;
  prompt: string;
  topic: string;
  complexity: "simple" | "moderate" | "complex";
  evaluationFocus: string;
}

export interface PromptGenerationOptions {
  count: number;
  seed?: string;
  asOfDate: string;
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
  const seedLine = options.seed ? `Use this run seed to vary the prompt set: ${options.seed}` : "Invent a fresh prompt set.";
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

Do not bias toward prompts where OpenCandle obviously has a tool advantage. Include prompts where:
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
  options: { agentName: string; asOfDate: string },
): string {
  return `You are ${options.agentName}, acting as a general finance assistant without live tools, browsing, private data, or market-data APIs.

Current date: ${options.asOfDate}

Answer the user's prompt as well as you can. Be explicit when current data would be needed and you cannot verify it. Do not pretend to have live prices, filings, options chains, sentiment, or macro probabilities.

User prompt:
${prompt}`;
}

export function buildComparisonJudgePrompt(input: ComparisonJudgeInput): string {
  const toolCalls = input.openCandleTrace.toolCalls.map((call) => ({
    name: call.name,
    args: call.args,
  }));
  const competitorAnswers = input.competitorAnswers
    .map((competitor) => `Agent: ${competitor.label} (${competitor.id}, ${competitor.provider}/${competitor.model})
Answer:
${competitor.answer}`)
    .join("\n\n---\n\n");
  const winnerOptions = ["opencandle", ...input.competitorAnswers.map((competitor) => competitor.id), "tie"].join("|");
  const scoreShape = Object.fromEntries(input.competitorAnswers.map((competitor) => [competitor.id, 0]));
  const didBetterShape = Object.fromEntries(input.competitorAnswers.map((competitor) => [competitor.id, ["..."]]));
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

OpenCandle answer:
${input.openCandleTrace.text}

Generic no-tool agent answers:
${competitorAnswers}

Judge the answers on usefulness, correctness, evidence, clarity, and honesty about uncertainty. It is acceptable for any generic agent to win. When one does, explain why and what OpenCandle should improve. Treat dates on or before the current date as current or historical, not future-dated.

Do not reward fabricated current facts. A no-tool agent that presents unverified live prices, filings, options chains, sentiment, macro probabilities, or filing changes as factual should be penalized for correctness and honesty even if the answer sounds specific. For prompts about current filings or live market data, prefer a sourced OpenCandle answer or an honest generic limitation over an unsourced no-tool answer that invents details.

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
      const answer = answers.find((candidate) => candidate.id === competitorId);
      if (!answer) continue;
      return {
        ...answer,
        cachedFromReport: entry.path,
      };
    }
  }
  return null;
}

export function parseComparisonJudgment(raw: string): ComparisonJudgment {
  const value = parseJsonPayload(raw);
  if (!isRecord(value)) throw new Error("Comparison judgment must be a JSON object");

  const winner = stringValue(value.winner);
  if (!winner) throw new Error("Comparison judgment winner is required");

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
    const lostTo = judgment.winner !== "opencandle" && judgment.winner !== "tie"
      ? judgment.winner
      : undefined;
    const ideas = judgment.openCandleImprovementIdeas;
    return [{
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
      toolCalls: toolCallsFromResult(result),
      cachedCompetitors: competitorAnswersFromResult(result)
        .filter((answer) => answer.cachedFromReport)
        .map((answer) => answer.id),
    }];
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
  lines.push(`Summary: OC wins ${analysis.openCandleWins}, losses ${analysis.losses}, ties ${analysis.ties}, cases ${analysis.promptCount}.`);

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
    lines.push(`Winner: ${c.winner}. Scores: OC ${c.openCandleScore}${scores ? `, ${scores}` : ""}.`);
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

export function fixedPromptFromEnv(env: Record<string, string | undefined>): GeneratedFinancePrompt | null {
  const prompt = env.OPENCANDLE_COMPETITIVE_PROMPT?.trim();
  if (!prompt) return null;

  const complexity = env.OPENCANDLE_COMPETITIVE_PROMPT_COMPLEXITY?.trim();
  return {
    id: env.OPENCANDLE_COMPETITIVE_PROMPT_ID?.trim() || "fixed-prompt",
    prompt,
    topic: env.OPENCANDLE_COMPETITIVE_PROMPT_TOPIC?.trim() || "fixed prompt",
    complexity: complexity === "simple" || complexity === "complex" ? complexity : "moderate",
    evaluationFocus: env.OPENCANDLE_COMPETITIVE_PROMPT_FOCUS?.trim() ||
      "Compare OpenCandle against generic agents on the same fixed prompt and identify concrete OpenCandle improvements.",
  };
}

export function extractUsableAnswerFromCliFailure(message: string): string | null {
  const match = /\bfailed:\s*/i.exec(message);
  const candidate = (match ? message.slice(match.index + match[0].length) : message).trim();
  if (!candidate) return null;
  if (/^(Internal error|Error handling request|Gemini CLI ACP startup timed out|exit status)\b/i.test(candidate)) {
    return null;
  }
  if (/Failed to authenticate|Invalid authentication credentials|Permission denied/i.test(candidate)) {
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
  return options.available.find((model) => (model.contextWindow ?? 0) >= PREFERRED_CONTEXT_WINDOW) ??
    options.available[0];
}

export function competitiveBenchmarkExitCode(): number {
  return 0;
}

export function competitivePreflightTimeoutMs(env: Record<string, string | undefined>): number {
  const parsed = Number(env.OPENCANDLE_COMPETITIVE_PREFLIGHT_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60_000;
}

export function selectCompetitiveCodexModel(env: Record<string, string | undefined>): string {
  return env.OPENCANDLE_COMPETITIVE_CODEX_MODEL ?? "gpt-5.3-codex-spark[medium]";
}

export function shouldRetryCompetitiveModelCall(message: string, attempt: number, maxAttempts: number): boolean {
  if (attempt >= maxAttempts) return false;
  return /\b(fetch failed|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|rate limit|429|500|502|503|504)\b/i.test(message);
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
    return [{
      id,
      label: stringValue(item.label) || id,
      provider: stringValue(item.provider),
      model: stringValue(item.model),
      answer,
      ...(typeof item.error === "string" ? { error: item.error } : {}),
      ...(typeof item.cachedFromReport === "string" ? { cachedFromReport: item.cachedFromReport } : {}),
    }];
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
  if (!isRecord(result) || !isRecord(result.openCandleTrace) || !Array.isArray(result.openCandleTrace.toolCalls)) {
    return [];
  }
  return unique(result.openCandleTrace.toolCalls.flatMap((call): string[] => {
    if (!isRecord(call)) return [];
    const name = stringValue(call.name);
    return name ? [name] : [];
  }));
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
  return Array.from(byTheme.values()).sort((a, b) => b.count - a.count || a.theme.localeCompare(b.theme));
}

function classifyImprovementIdea(idea: string): string[] {
  const lower = idea.toLowerCase();
  const themes: string[] = [];
  if (/\b(data|fetch|retriev|source|fred|macro|indicator|tool|current|live)\b/.test(lower)) {
    themes.push("data retrieval and integration");
  }
  if (/\b(synthesis|connect|integrat|context|explain|why|implication)\b/.test(lower)) {
    themes.push("synthesis and reasoning");
  }
  if (/\b(portfolio|sleeve|allocation|component|concentration|duration|credit|tips|emerging|tech)\b/.test(lower)) {
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

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function parseJsonPayload(raw: string): unknown {
  const trimmed = raw.trim();
  const parseCandidate = (candidate: string): unknown => {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      const repaired = repairCommonMissingCommas(candidate);
      if (repaired !== candidate) return JSON.parse(repaired);
      throw error;
    }
  };

  try {
    return parseCandidate(trimmed);
  } catch {
    const start = Math.min(...["{", "["].map((char) => {
      const index = trimmed.indexOf(char);
      return index === -1 ? Number.POSITIVE_INFINITY : index;
    }));
    const end = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
    if (!Number.isFinite(start) || end <= start) throw new Error("No JSON payload found");
    return parseCandidate(trimmed.slice(start, end + 1));
  }
}

function repairCommonMissingCommas(payload: string): string {
  return payload
    .replace(/("(?:[^"\\]|\\.)*")(\s*\r?\n\s*)"/g, "$1,$2\"")
    .replace(/(\b(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null))(\s*\r?\n?\s*)"/g, "$1,$2\"")
    .replace(/(\]|\})(\s*\r?\n\s*)"/g, "$1,$2\"");
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
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function numberRecord(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1])),
  );
}

function stringArrayRecord(value: unknown): Record<string, string[]> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).map(([key, arrayValue]) => [key, stringArray(arrayValue)]),
  );
}
