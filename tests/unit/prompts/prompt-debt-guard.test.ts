import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface PromptPolicyManifest {
  prompts: Array<{
    text: string;
    expected?: {
      finalAnswerHardAssertions?: string[];
      optionalJudgeAssertions?: string[];
    };
  }>;
}

const PRODUCTION_PROMPT_FILES = ["src/prompts/context-builder.ts", "src/prompts/policy-cards.ts"];

const GENERIC_ACRONYMS = new Set([
  "API",
  "CD",
  "DCF",
  "DCA",
  "DTE",
  "EPS",
  "ETF",
  "FDIC",
  "FOMC",
  "HYSA",
  "IV",
  "MD",
  "OI",
  "SEC",
  "SIPC",
]);

describe("prompt debt guard", () => {
  it("keeps benchmark-specific literals out of production prompt guidance", () => {
    const manifest = JSON.parse(
      readFileSync("docs/internal/prompt-to-policy-migration-manifest.json", "utf-8"),
    ) as PromptPolicyManifest;
    const literals = benchmarkSpecificLiterals(manifest);
    const violations = productionPromptText().flatMap(({ file, text }) =>
      literals.filter((literal) => text.includes(literal)).map((literal) => `${file}: ${literal}`),
    );

    expect(violations).toEqual([]);
  });
});

function productionPromptText(): Array<{ file: string; text: string }> {
  return PRODUCTION_PROMPT_FILES.map((file) => ({
    file,
    text: readFileSync(file, "utf-8"),
  }));
}

function benchmarkSpecificLiterals(manifest: PromptPolicyManifest): string[] {
  const candidates = new Set<string>();
  for (const prompt of manifest.prompts) {
    collectSpecificLiterals(prompt.text, candidates);
    for (const assertion of prompt.expected?.finalAnswerHardAssertions ?? []) {
      collectSpecificLiterals(assertion, candidates);
    }
    for (const assertion of prompt.expected?.optionalJudgeAssertions ?? []) {
      collectSpecificLiterals(assertion, candidates);
    }
  }
  return [...candidates].sort();
}

function collectSpecificLiterals(text: string, candidates: Set<string>): void {
  collectMatches(text, /\b\d+(?:\.\d+)?%\s+(?:mortgage|rate)\b/g, candidates);
  collectMatches(text, /\$\s?\d[\d,]*(?:k)?(?:\s+(?:portfolio|cost basis))?/gi, candidates);
  collectMatches(text, /\b\d+\s+shares?\b/gi, candidates);
  for (const match of text.matchAll(/\b[A-Z]{2,5}\b/g)) {
    const token = match[0];
    if (!GENERIC_ACRONYMS.has(token)) candidates.add(token);
  }
}

function collectMatches(text: string, pattern: RegExp, candidates: Set<string>): void {
  for (const match of text.matchAll(pattern)) {
    candidates.add(match[0]);
  }
}
