#!/usr/bin/env tsx
import { readFileSync } from "node:fs";
import type { CompetitiveReplayComparison } from "../evals/main-branch-competitive-replay.js";
import type { ProductReplayComparison } from "../evals/main-branch-replay.js";
import {
  buildOcSuperiorityScorecard,
  writeOcSuperiorityScorecard,
} from "../evals/oc-superiority-scorecard.js";

interface CliOptions {
  productReplay?: string;
  competitiveReplay?: string;
  promptPolicy?: string;
}

const options = parseArgs(process.argv.slice(2));
const scorecard = buildOcSuperiorityScorecard({
  productReplay: options.productReplay
    ? readJson<ProductReplayComparison>(options.productReplay)
    : undefined,
  competitiveReplay: options.competitiveReplay
    ? readJson<CompetitiveReplayComparison>(options.competitiveReplay)
    : undefined,
  promptPolicy: options.promptPolicy ? readJson(options.promptPolicy) : undefined,
});
const outputPath = writeOcSuperiorityScorecard(scorecard);

console.log(`OC superiority status: ${scorecard.status}`);
for (const blocker of scorecard.blockers) {
  console.log(`Blocker: ${blocker.layer}: ${blocker.reason}`);
}
console.log(`Report: ${outputPath}`);

function readJson<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--product-replay" && next) {
      options.productReplay = next;
      index += 1;
    } else if (arg === "--competitive-replay" && next) {
      options.competitiveReplay = next;
      index += 1;
    } else if (arg === "--prompt-policy" && next) {
      options.promptPolicy = next;
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }
  return options;
}
