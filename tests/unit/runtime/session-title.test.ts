import { describe, expect, it, vi } from "vitest";
import { generateSessionTitle } from "../../../src/runtime/session-title.js";

function stubCompletion(response: string) {
  return vi.fn(async (_prompt: string) => response);
}

describe("generateSessionTitle", () => {
  it("builds a prompt containing the user and assistant text and returns the title", async () => {
    const complete = stubCompletion("Dividend Basics Explained");
    const title = await generateSessionTitle(
      { userText: "how do dividends work", assistantText: "Dividends are cash payouts..." },
      complete,
    );
    expect(title).toBe("Dividend Basics Explained");
    expect(complete).toHaveBeenCalledTimes(1);
    const prompt = complete.mock.calls[0]?.[0];
    expect(prompt).toContain("how do dividends work");
    expect(prompt).toContain("Dividends are cash payouts...");
    expect(prompt.toLowerCase()).toContain("title");
  });

  it("omits the assistant section when assistantText is absent", async () => {
    const complete = stubCompletion("Market Overview Question");
    const title = await generateSessionTitle({ userText: "how are markets today" }, complete);
    expect(title).toBe("Market Overview Question");
    expect(complete.mock.calls[0]?.[0]).not.toContain("Assistant:");
  });

  it("strips surrounding quotes", async () => {
    const title = await generateSessionTitle(
      { userText: "x" },
      stubCompletion('"Covered Call Mechanics"'),
    );
    expect(title).toBe("Covered Call Mechanics");
  });

  it("strips markdown and keeps only the first line", async () => {
    const title = await generateSessionTitle(
      { userText: "x" },
      stubCompletion("**Bond Ladder Strategy**\nHere is some extra commentary."),
    );
    expect(title).toBe("Bond Ladder Strategy");
  });

  it("strips trailing punctuation", async () => {
    const title = await generateSessionTitle(
      { userText: "x" },
      stubCompletion("Comparing Two Index Funds."),
    );
    expect(title).toBe("Comparing Two Index Funds");
  });

  it("caps overly long titles to about 60 characters at a word boundary", async () => {
    const title = await generateSessionTitle(
      { userText: "x" },
      stubCompletion("Long Horizon Allocation Review Across Several Accounts And Goals"),
    );
    expect(title).not.toBeNull();
    expect(title?.length).toBeLessThanOrEqual(60);
    expect(title?.endsWith(" ")).toBe(false);
    // Cut on a word boundary, not mid-word.
    expect("Long Horizon Allocation Review Across Several Accounts And Goals").toContain(title!);
  });

  it("rejects empty or whitespace-only responses", async () => {
    expect(await generateSessionTitle({ userText: "x" }, stubCompletion(""))).toBeNull();
    expect(await generateSessionTitle({ userText: "x" }, stubCompletion("  \n  "))).toBeNull();
  });

  it("rejects garbage responses with more than 12 words", async () => {
    const rambling =
      "I am sorry but I cannot write a title without more information about the session";
    expect(await generateSessionTitle({ userText: "x" }, stubCompletion(rambling))).toBeNull();
  });

  it("propagates completion errors to the caller", async () => {
    const failing = vi.fn(async () => {
      throw new Error("model unavailable");
    });
    await expect(generateSessionTitle({ userText: "x" }, failing)).rejects.toThrow(
      "model unavailable",
    );
  });
});
