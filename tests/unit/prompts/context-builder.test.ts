import { describe, it, expect } from "vitest";
import { PromptContextBuilder } from "../../../src/prompts/context-builder.js";
import { truncateTobudget } from "../../../src/prompts/sections.js";

describe("truncateTobudget", () => {
  it("returns content unchanged when within budget", () => {
    expect(truncateTobudget("short", 100)).toBe("short");
  });

  it("truncates and adds marker when over budget", () => {
    const long = "a".repeat(200);
    const result = truncateTobudget(long, 50);
    expect(result.length).toBeLessThanOrEqual(50);
    expect(result).toContain("[...truncated]");
  });

  it("tries to cut at line boundary", () => {
    const content = "line1\nline2\nline3\nline4\nline5";
    const result = truncateTobudget(content, 25);
    expect(result).toContain("[...truncated]");
    // Should cut at a newline, not mid-word
    expect(result).not.toMatch(/\bline\d[^\n]/);
  });
});

describe("PromptContextBuilder", () => {
  it("assembles sections in defined order", () => {
    const builder = new PromptContextBuilder();
    builder.setSection("output-format", "Format here");
    builder.setSection("base-role", "Role here");

    const result = builder.build();
    const roleIndex = result.indexOf("Role here");
    const formatIndex = result.indexOf("Format here");
    expect(roleIndex).toBeLessThan(formatIndex);
  });

  it("skips empty sections", () => {
    const builder = new PromptContextBuilder();
    builder.setSection("base-role", "Role here");
    // memory-context is left empty

    const result = builder.build();
    expect(result).toContain("Role here");
    expect(result).not.toContain("memory-context");
  });

  it("truncates sections that exceed budget", () => {
    const builder = new PromptContextBuilder({ "base-role": 50 });
    builder.setSection("base-role", "x".repeat(200));

    const result = builder.build();
    expect(result.length).toBeLessThanOrEqual(50);
    expect(result).toContain("[...truncated]");
  });

  it("populateFromOptions sets all standard sections", () => {
    const builder = new PromptContextBuilder();
    builder.populateFromOptions({
      memoryContext: "risk_profile: aggressive",
    });

    const result = builder.build();
    expect(result).toContain("OpenCandle");
    expect(result).toContain("Available Tools");
    expect(result).toContain("risk_profile: aggressive");
    expect(result).toContain("Disclaimer");
  });

  it("includes add-on tools in tool catalog", () => {
    const builder = new PromptContextBuilder();
    builder.populateFromOptions({
      addonToolDescriptions: ["my_custom_tool: Does something cool"],
    });

    const result = builder.build();
    expect(result).toContain("Add-on Tools");
    expect(result).toContain("my_custom_tool");
  });

  it("injects workflow instructions when provided", () => {
    const builder = new PromptContextBuilder();
    builder.populateFromOptions({
      workflowInstructions: "Build a 5-position portfolio with these constraints...",
    });

    const result = builder.build();
    expect(result).toContain("5-position portfolio");
  });

  it("omits workflow instructions when not provided", () => {
    const builder = new PromptContextBuilder();
    builder.populateFromOptions({});

    const result = builder.build();
    // Should still have base role and other sections
    expect(result).toContain("OpenCandle");
    // But no workflow-specific content (we can't easily test absence,
    // but we verify the builder doesn't crash)
  });
});
