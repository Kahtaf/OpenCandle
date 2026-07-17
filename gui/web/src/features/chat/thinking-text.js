const LEADING_MARKDOWN_PATTERN = /^\s*(?:(?:#{1,6}|>|[-+*]|\d+[.)])\s+)+/gm;
const STRONG_ASTERISK_PATTERN = /(^|[^\w])\*\*(?=\S)(.+?\S)\*\*(?=$|[^\w])/g;
const STRONG_UNDERSCORE_PATTERN = /(^|[^\w])__(?=\S)(.+?\S)__(?=$|[^\w])/g;
const EMPHASIS_ASTERISK_PATTERN = /(^|[^\w])\*(?=\S)([^*\n]*?\S)\*(?=$|[^\w])/g;
const EMPHASIS_UNDERSCORE_PATTERN = /(^|[^\w])_(?=\S)([^_\n]*?\S)_(?=$|[^\w])/g;

export function stripThinkingMarkdown(text) {
  return String(text || "")
    .replace(LEADING_MARKDOWN_PATTERN, "")
    .replace(STRONG_ASTERISK_PATTERN, "$1$2")
    .replace(STRONG_UNDERSCORE_PATTERN, "$1$2")
    .replace(EMPHASIS_ASTERISK_PATTERN, "$1$2")
    .replace(EMPHASIS_UNDERSCORE_PATTERN, "$1$2");
}

export function compactThinkingText(text) {
  const normalized = stripThinkingMarkdown(text)
    .trim()
    .replace(/\n{3,}/g, "\n\n");
  if (normalized.length <= 700) return normalized;
  return `${normalized.slice(0, 700).trimEnd()}...`;
}
