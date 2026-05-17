/**
 * User-facing disclaimer text. Rendered OUTSIDE the LLM instruction context as
 * a custom display message (see `src/pi/opencandle-extension.ts`), so it no
 * longer steers model behavior but still surfaces on every assistant turn.
 */
export const DISCLAIMER_TEXT =
  "OpenCandle is a research and analysis tool, not financial advice or a fiduciary financial advisor. " +
  "Views, targets, and allocations are informational analyst output — not personalized recommendations. " +
  "Verify independently before acting.";
