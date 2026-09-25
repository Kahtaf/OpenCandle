import type { TerminalErrorCategory, TerminalOutcomeTrace, TerminalStopReason } from "./types.js";

/**
 * Derive sanitized terminal metadata from Pi's final assistant message.
 *
 * The raw `errorMessage` is only read to pick a bounded category; it is never
 * copied into the returned trace, so a diagnostic cannot leak provider text,
 * credentials, or session values.
 */

const STOP_REASONS: ReadonlySet<string> = new Set([
  "pending",
  "stop",
  "length",
  "toolUse",
  "error",
  "aborted",
  "deferred",
]);

/**
 * Ordered, bounded error classifiers. First match wins; the returned value is
 * always one of these fixed categories, never the input text.
 */
const ERROR_CATEGORY_PATTERNS: ReadonlyArray<readonly [TerminalErrorCategory, RegExp]> = [
  ["aborted", /\babort(?:ed)?\b|\bcancel(?:led|ed)?\b/i],
  [
    "authentication",
    /\b(?:401|403)\b|unauthor|forbidden|invalid[\s_-]?api[\s_-]?key|\bapi[\s_-]?key\b|credential|authenticat|permission/i,
  ],
  [
    "rate_limit",
    /\b429\b|rate[\s_-]?limit|too many requests|\bquota\b|resource[\s_-]?exhausted|overloaded/i,
  ],
  ["timeout", /timed?[\s_-]?out|etimedout|\bdeadline\b/i],
  [
    "context_length",
    /context[\s_-]?(?:length|window)|too many tokens|maximum.{0,20}tokens|token.{0,10}limit|max[\s_-]?tokens|prompt is too long|input.{0,20}too long/i,
  ],
  ["safety", /\bsafety\b|content filter|\bblocked\b|moderation|recitation/i],
  [
    "network",
    /econnreset|econnrefused|enotfound|fetch failed|\bnetwork\b|socket|\bdns\b|connection (?:reset|refused)/i,
  ],
  [
    "provider_error",
    /\b5\d\d\b|internal server|bad gateway|service unavailable|upstream (?:error|failure)|provider (?:error|failure|rejected)/i,
  ],
];

export interface TerminalAssistantMessageLike {
  role?: unknown;
  stopReason?: unknown;
  errorMessage?: unknown;
  content?: unknown;
}

/** Coarse, non-sensitive classification of a terminal provider error. */
export function classifyTerminalError(
  errorMessage: string | undefined,
  stopReason: string | undefined,
): TerminalErrorCategory {
  if (stopReason === "aborted") return "aborted";
  if (!errorMessage) return "unknown";
  for (const [category, pattern] of ERROR_CATEGORY_PATTERNS) {
    if (pattern.test(errorMessage)) return category;
  }
  return "unknown";
}

/** True when an assistant message carries at least one non-empty text block. */
export function assistantMessageHasText(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  return content.some((block) => {
    if (typeof block !== "object" || block === null) return false;
    const candidate = block as { type?: unknown; text?: unknown };
    return (
      candidate.type === "text" &&
      typeof candidate.text === "string" &&
      candidate.text.trim().length > 0
    );
  });
}

/** Build the sanitized terminal outcome for one assistant message. */
export function terminalOutcomeFromMessage(
  message: TerminalAssistantMessageLike,
): TerminalOutcomeTrace | undefined {
  if (message.role !== "assistant") return undefined;
  const rawStopReason = typeof message.stopReason === "string" ? message.stopReason : "";
  const stopReason: TerminalStopReason = STOP_REASONS.has(rawStopReason)
    ? (rawStopReason as TerminalStopReason)
    : "unknown";
  const errorMessage = typeof message.errorMessage === "string" ? message.errorMessage : undefined;
  const errorPresent =
    stopReason === "error" || stopReason === "aborted" || errorMessage !== undefined;
  return {
    stopReason,
    errorPresent,
    textEmpty: !assistantMessageHasText(message.content),
    ...(errorPresent ? { errorCategory: classifyTerminalError(errorMessage, stopReason) } : {}),
  };
}

/** Copy terminal metadata with a prompt index attached for multi-prompt runs. */
export function withPromptIndex(
  outcome: TerminalOutcomeTrace,
  promptIndex: number | undefined,
): TerminalOutcomeTrace {
  return promptIndex === undefined ? outcome : { ...outcome, promptIndex };
}
