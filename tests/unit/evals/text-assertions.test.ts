import { describe, expect, it } from "vitest";
import {
  affirmsForbidden,
  hasUnnegatedMarker,
  splitSentences,
  withoutPromptEcho,
} from "../../evals/text-assertions.js";

describe("hasUnnegatedMarker", () => {
  const RISK = /\brisks?\b/gi;

  it("accepts an affirmative marker", () => {
    expect(hasUnnegatedMarker("The main risk is a gap down.", RISK)).toBe(true);
  });

  it.each([
    "There is no risk here.",
    "This carries zero risk.",
    "It is not a real risk.",
    "You face no clear risk.",
  ])("rejects a marker whose only occurrence is directly negated: %s", (text) => {
    expect(hasUnnegatedMarker(text, RISK)).toBe(false);
  });

  it("keeps an unrelated clause negation from hiding the marker", () => {
    expect(hasUnnegatedMarker("Do not ignore it, the risk is real.", RISK)).toBe(true);
  });

  it("accepts the marker when one occurrence is negated and another is affirmative", () => {
    expect(hasUnnegatedMarker("No risk to the dividend. The risk is in the multiple.", RISK)).toBe(
      true,
    );
  });

  it("rejects a caller-supplied negated compound", () => {
    const marker = /\brisk\w*/gi;
    expect(
      hasUnnegatedMarker("This is a riskless bet.", marker, { negatedCompound: /^riskless\b/i }),
    ).toBe(false);
  });

  it("works with a non-global marker pattern", () => {
    expect(hasUnnegatedMarker("There is no risk. A risk remains.", /\brisk\b/i)).toBe(true);
  });
});

describe("affirmsForbidden", () => {
  const BUDGET = /\bneed\b[^.?!\n]{0,60}\bbudget\b/gi;
  const BULLISH = /\bcovered call\b|\bbull call\b/gi;

  it("flags an affirmative forbidden phrase", () => {
    expect(affirmsForbidden("I need to know your budget first.", BUDGET)).toBe(true);
    expect(affirmsForbidden("Sell a covered call against the shares.", BULLISH)).toBe(true);
  });

  it.each([
    "You don't need to share a budget for this review.",
    "There is no need to provide a budget.",
    "You do not need a budget here.",
  ])("does not flag a negated request: %s", (text) => {
    expect(affirmsForbidden(text, BUDGET)).toBe(false);
  });

  it.each([
    "This is a protective put, not a covered call.",
    "Buy the put rather than a bull call spread.",
    "Use a protective put instead of a covered call.",
    "Unlike a covered call, the put keeps your upside.",
  ])("does not flag a contrasted phrase: %s", (text) => {
    expect(affirmsForbidden(text, BULLISH)).toBe(false);
  });

  it("flags the affirmative phrase even when a negated mention precedes it", () => {
    expect(
      affirmsForbidden("This is not a covered call. Still, sell a covered call anyway.", BULLISH),
    ).toBe(true);
  });

  it("does not let a negation in a previous clause excuse the phrase", () => {
    expect(affirmsForbidden("Do not panic; sell a covered call.", BULLISH)).toBe(true);
  });
});

describe("withoutPromptEcho", () => {
  const prompt =
    "I hold 300 shares of ZZZZ and earnings are tonight. Should I trim, hedge, or hold through it?";

  it("drops sentences that restate the request", () => {
    const text = "You asked whether to trim, hedge, or hold. Gap risk is the main issue.";
    expect(withoutPromptEcho(text, prompt)).not.toMatch(/trim/);
    expect(withoutPromptEcho(text, prompt)).toMatch(/Gap risk/);
  });

  it("drops a heading that copies a long run of the prompt", () => {
    const text = "## Should I trim, hedge, or hold through it?\nSize the position down first.";
    expect(withoutPromptEcho(text, prompt)).not.toMatch(/hedge/);
    expect(withoutPromptEcho(text, prompt)).toMatch(/Size the position/);
  });

  it("keeps an answer sentence that reuses a few prompt words", () => {
    const text = "Trim 100 of your 300 shares before the report.";
    expect(withoutPromptEcho(text, prompt)).toBe(text);
  });

  it("returns the text unchanged for an empty prompt", () => {
    expect(withoutPromptEcho("Hedge with puts.", "")).toBe("Hedge with puts.");
  });
});

describe("splitSentences", () => {
  it("splits on sentence ends and line breaks but not on decimals", () => {
    expect(splitSentences("EPS was 2.15 last year. Revenue grew.\n- Bullet one")).toEqual([
      "EPS was 2.15 last year.",
      "Revenue grew.",
      "- Bullet one",
    ]);
  });
});
