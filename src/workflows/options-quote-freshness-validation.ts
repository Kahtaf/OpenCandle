import type { PromptOutputValidation, PromptValidationContext } from "../runtime/prompt-step.js";
import {
  disclosesNonLiveQuotes,
  findNonLiveQuoteEvidence,
  presentsQuoteFigures,
} from "../runtime/quote-freshness.js";

const ERROR_PREFIX = "Option quotes are presented without disclosing that they are not live";

/**
 * Fails when captured option-chain evidence for this workflow run was not live
 * (last-session, closed-market, or stale-cache quotes) and the answer does not
 * say so. Evidence comes from the runtime capture, never from the model text.
 * An answer that shows no price figures presents no quotes, so it passes.
 */
export function validateOptionsQuoteFreshness(
  rawText: string,
  context?: PromptValidationContext,
): string[] {
  if (!context || !presentsQuoteFigures(rawText)) return [];
  const nonLive = findNonLiveQuoteEvidence([...context.priorEvidence, ...context.currentEvidence]);
  if (nonLive.length === 0 || disclosesNonLiveQuotes(rawText)) return [];
  const reasons = [...new Set(nonLive.map((entry) => entry.reason))];
  return [`${ERROR_PREFIX}: ${reasons.join(" ")}`];
}

export function createOptionsQuoteFreshnessValidation(): PromptOutputValidation {
  return {
    validate: validateOptionsQuoteFreshness,
    repairPrompt: (errors) =>
      `The options answer failed quote-freshness validation:\n${errors.map((error) => `- ${error}`).join("\n")}\n\nReturn the complete answer again using the existing evidence. Keep the same contracts, ranking, assumptions, requested horizon, and risk caveats. Next to the quoted bid/ask or premium figures, state plainly that they are not live, are not executable now, and must be rechecked during regular options trading. Do not make new tool calls or invent prices.`,
  };
}
