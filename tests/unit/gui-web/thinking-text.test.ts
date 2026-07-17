import { describe, expect, it } from "vitest";
import {
  compactThinkingText,
  stripThinkingMarkdown,
} from "../../../gui/web/src/features/chat/thinking-text.js";

describe("thinking text preview", () => {
  it("flattens inline emphasis without changing internal punctuation", () => {
    expect(stripThinkingMarkdown("**Preparing to gather information**")).toBe(
      "Preparing to gather information",
    );
    expect(stripThinkingMarkdown("The ratio *rose, then fell.* That's useful.")).toBe(
      "The ratio rose, then fell. That's useful.",
    );
    expect(stripThinkingMarkdown("Keep price_to_sales and _remove only paired emphasis_.")).toBe(
      "Keep price_to_sales and remove only paired emphasis.",
    );
  });

  it("removes heading, blockquote, and list prefixes line by line", () => {
    expect(
      stripThinkingMarkdown(
        "## Plan\n> Check recent prices\n- Compare volume\n* Review filings\n1. Summarize",
      ),
    ).toBe("Plan\nCheck recent prices\nCompare volume\nReview filings\nSummarize");
  });

  it("keeps the preview compacted to 700 characters", () => {
    expect(compactThinkingText(`**${"a".repeat(710)}**`)).toBe(`${"a".repeat(700)}...`);
  });
});
