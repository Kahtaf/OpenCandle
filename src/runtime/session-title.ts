/**
 * LLM-summarized session titles.
 *
 * Builds a strict short-title prompt from the user's first message (plus an
 * optional slice of the first assistant reply), delegates to an injected
 * completion function, and sanitizes the result. Returns null when the model
 * output is unusable (empty or rambling) so callers can keep the existing
 * placeholder name. Completion errors propagate to the caller.
 */

const MAX_TITLE_CHARS = 60;
const MAX_TITLE_WORDS = 12;

export interface SessionTitleInput {
  userText: string;
  assistantText?: string;
}

export async function generateSessionTitle(
  input: SessionTitleInput,
  complete: (prompt: string) => Promise<string>,
): Promise<string | null> {
  const lines = [
    "Write a 4-8 word title for this finance chat session.",
    "No quotes, no punctuation at the end, no markdown. Return only the title.",
    "",
    `User: ${input.userText}`,
  ];
  if (input.assistantText !== undefined && input.assistantText.trim().length > 0) {
    lines.push("", `Assistant: ${input.assistantText}`);
  }
  const raw = await complete(lines.join("\n"));
  return sanitizeTitle(raw);
}

function sanitizeTitle(raw: string): string | null {
  // First non-empty line only — discard any model commentary after a newline.
  let title =
    raw
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "";
  // Strip markdown emphasis/heading/code characters.
  title = title.replace(/[*_`#]/g, "");
  // Strip surrounding quotes.
  title = title.replace(/^["'“”‘’]+/, "").replace(/["'“”‘’]+$/, "");
  // Strip trailing punctuation.
  title = title.replace(/[.!?:;,]+$/, "");
  // Collapse whitespace.
  title = title.replace(/\s+/g, " ").trim();

  if (title.length === 0) return null;
  if (title.split(" ").length > MAX_TITLE_WORDS) return null;
  if (title.length > MAX_TITLE_CHARS) {
    const cut = title.slice(0, MAX_TITLE_CHARS);
    const lastSpace = cut.lastIndexOf(" ");
    title = (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim();
  }
  return title;
}
