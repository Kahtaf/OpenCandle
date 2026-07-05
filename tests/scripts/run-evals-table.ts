import { appendFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

export interface ResolvedEvalCommand {
  suite: string;
  description: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface EvalSuiteInfo {
  id: string;
  description: string;
  envFlags: string[];
}

export interface SuiteResult {
  suite: string;
  exitCode: number;
}

interface EvalSuite extends EvalSuiteInfo {
  resolve(argv: string[]): ResolvedEvalCommand;
}

const SUITES: EvalSuite[] = [
  {
    id: "cases",
    description: "Vitest eval cases",
    envFlags: [
      "EVAL_TIER",
      "OPENCANDLE_LIVE_MULTI_TURN_EVAL",
      "OPENCANDLE_RUN_KNOWN_FAIL_EVALS",
      "OPENCANDLE_EVAL_KNOWN_FAIL_E2",
    ],
    resolve(argv) {
      const options = parseOptions(argv);
      const env: Record<string, string> = {};
      if (options.tier) env.EVAL_TIER = options.tier;
      if (options["known-fail"] === "e1") {
        env.EVAL_TIER = "usually";
        env.OPENCANDLE_LIVE_MULTI_TURN_EVAL = "1";
        env.OPENCANDLE_RUN_KNOWN_FAIL_EVALS = "1";
      } else if (options["known-fail"] === "e2") {
        env.EVAL_TIER = "usually";
        env.OPENCANDLE_EVAL_KNOWN_FAIL_E2 = "1";
      } else if (options["known-fail"]) {
        throw new Error(`Unknown known-fail "${options["known-fail"]}". Expected e1 or e2.`);
      }
      return command("cases", "vitest", ["run", "--config", "vitest.config.evals.ts"], env);
    },
  },
  {
    id: "product",
    description: "Full-session product evals",
    envFlags: [
      "PRODUCT_EVAL_CASE",
      "PRODUCT_EVAL_FAMILY",
      "PRODUCT_EVAL_INCLUDE_OPT_IN",
      "PRODUCT_EVAL_LIMIT",
    ],
    resolve(argv) {
      const options = parseOptions(argv);
      return command("product", "tsx", ["tests/scripts/run-product-evals.ts"], {
        ...valueEnv(options, "case", "PRODUCT_EVAL_CASE"),
        ...valueEnv(options, "family", "PRODUCT_EVAL_FAMILY"),
        ...(options["include-opt-in"] === "1" ? { PRODUCT_EVAL_INCLUDE_OPT_IN: "1" } : {}),
        ...valueEnv(options, "limit", "PRODUCT_EVAL_LIMIT"),
      });
    },
  },
  {
    id: "competitive",
    description: "Competitive finance benchmark",
    envFlags: [
      "COMPETITIVE_PROMPT_COUNT",
      "COMPETITIVE_PROMPT_SEED",
      "OPENCANDLE_COMPETITIVE_PROVIDER",
      "OPENCANDLE_COMPETITIVE_MODEL",
      "OPENCANDLE_COMPETITIVE_PANEL",
    ],
    resolve(argv) {
      const options = parseOptions(argv);
      return command("competitive", "tsx", ["tests/scripts/run-competitive-finance-eval.ts"], {
        ...valueEnv(options, "provider", "OPENCANDLE_COMPETITIVE_PROVIDER"),
        ...valueEnv(options, "model", "OPENCANDLE_COMPETITIVE_MODEL"),
        ...valueEnv(options, "count", "COMPETITIVE_PROMPT_COUNT"),
        ...valueEnv(options, "seed", "COMPETITIVE_PROMPT_SEED"),
      });
    },
  },
  {
    id: "competitive:frozen",
    description: "Frozen competitive release panel",
    envFlags: [
      "OPENCANDLE_COMPETITIVE_PANEL",
      "OPENCANDLE_COMPETITIVE_PROVIDER",
      "OPENCANDLE_COMPETITIVE_MODEL",
    ],
    resolve(argv) {
      const options = parseOptions(argv);
      return command(
        "competitive:frozen",
        "tsx",
        ["tests/scripts/run-competitive-finance-eval.ts"],
        {
          OPENCANDLE_COMPETITIVE_PANEL: "frozen",
          ...valueEnv(options, "provider", "OPENCANDLE_COMPETITIVE_PROVIDER"),
          ...valueEnv(options, "model", "OPENCANDLE_COMPETITIVE_MODEL"),
        },
      );
    },
  },
  {
    id: "competitive:analyze",
    description: "Analyze a competitive report",
    envFlags: [],
    resolve(argv) {
      return command("competitive:analyze", "tsx", [
        "tests/scripts/analyze-competitive-finance-report.ts",
        ...argv,
      ]);
    },
  },
  {
    id: "router-live",
    description: "Live router fixture eval",
    envFlags: ["OPENCANDLE_ROUTER_PROVIDER", "OPENCANDLE_ROUTER_MODEL"],
    resolve(argv) {
      const options = parseOptions(argv);
      return command("router-live", "tsx", ["tests/scripts/run-live-router-eval.ts"], {
        ...valueEnv(options, "provider", "OPENCANDLE_ROUTER_PROVIDER"),
        ...valueEnv(options, "model", "OPENCANDLE_ROUTER_MODEL"),
      });
    },
  },
  {
    id: "replay:product",
    description: "Replay product evals against a base ref",
    envFlags: ["PRODUCT_REPLAY_BASE_REF"],
    resolve(argv) {
      const options = parseOptions(argv);
      return command("replay:product", "tsx", ["tests/scripts/run-main-branch-product-replay.ts"], {
        ...valueEnv(options, "base-ref", "PRODUCT_REPLAY_BASE_REF"),
      });
    },
  },
  {
    id: "replay:competitive",
    description: "Compare competitive reports against a base report",
    envFlags: [],
    resolve(argv) {
      return command("replay:competitive", "tsx", [
        "tests/scripts/run-main-branch-competitive-replay.ts",
        ...argv,
      ]);
    },
  },
  {
    id: "scorecard",
    description: "Build the OC superiority scorecard",
    envFlags: [],
    resolve(argv) {
      return command("scorecard", "tsx", [
        "tests/scripts/build-oc-superiority-scorecard.ts",
        ...argv,
      ]);
    },
  },
  {
    id: "prompt-policy",
    description: "Run the prompt-to-policy manifest",
    envFlags: ["PROMPT_POLICY_IDS", "PROMPT_POLICY_LIMIT", "PROMPT_POLICY_STRICT"],
    resolve(argv) {
      const options = parseOptions(argv);
      return command("prompt-policy", "tsx", ["tests/scripts/run-prompt-policy-manifest.ts"], {
        ...valueEnv(options, "ids", "PROMPT_POLICY_IDS"),
        ...valueEnv(options, "limit", "PROMPT_POLICY_LIMIT"),
        ...(options.strict === "1" ? { PROMPT_POLICY_STRICT: "1" } : {}),
      });
    },
  },
  {
    id: "prompt-policy:parity",
    description: "Compare prompt-to-policy behavior across refs",
    envFlags: ["PROMPT_POLICY_BASE_REF", "PROMPT_POLICY_CURRENT_REF"],
    resolve(argv) {
      const options = parseOptions(argv);
      return command(
        "prompt-policy:parity",
        "tsx",
        ["tests/scripts/run-prompt-policy-ref-parity.ts"],
        {
          ...valueEnv(options, "base-ref", "PROMPT_POLICY_BASE_REF"),
          ...valueEnv(options, "current-ref", "PROMPT_POLICY_CURRENT_REF"),
        },
      );
    },
  },
  {
    id: "release",
    description: "Run the release eval cadence",
    envFlags: [],
    resolve() {
      return command("release", "node", ["<internal-release-sequence>"]);
    },
  },
];

export const RELEASE_SEQUENCE = ["router-live", "cases", "product", "competitive:frozen"] as const;

export function listEvalSuites(): EvalSuiteInfo[] {
  return SUITES.map(({ id, description, envFlags }) => ({ id, description, envFlags }));
}

export function suiteListText(): string {
  return listEvalSuites()
    .map((suite) => {
      const flags = suite.envFlags.length > 0 ? ` [${suite.envFlags.join(", ")}]` : "";
      return `${suite.id.padEnd(24)} ${suite.description}${flags}`;
    })
    .join("\n");
}

export function resolveEvalCommand(suiteId: string, argv: string[]): ResolvedEvalCommand {
  const suite = SUITES.find((entry) => entry.id === suiteId);
  if (!suite) {
    throw new Error(`Unknown eval suite "${suiteId}". Available suites:\n${suiteListText()}`);
  }
  return suite.resolve(argv);
}

export function snapshotRunReports(runsDir: string): Set<string> {
  try {
    return new Set(
      readdirSync(runsDir)
        .filter((name) => name !== "index.jsonl")
        .sort(),
    );
  } catch {
    return new Set();
  }
}

export function diffRunReports(
  runsDir: string,
  before: Set<string>,
  cwd = process.cwd(),
): string[] {
  return [...snapshotRunReports(runsDir)]
    .filter((name) => !before.has(name))
    .map((name) => relative(cwd, join(runsDir, name)))
    .sort();
}

export function appendRunIndexEntry(input: {
  cwd: string;
  suite: string;
  startedAt: string;
  finishedAt: string;
  exitCode: number;
  reports: string[];
  argv: string[];
}): string {
  const runsDir = join(input.cwd, "tests", "evals", "runs");
  mkdirSync(runsDir, { recursive: true });
  const path = join(runsDir, "index.jsonl");
  appendFileSync(
    path,
    `${JSON.stringify({
      suite: input.suite,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      exitCode: input.exitCode,
      reports: input.reports,
      argv: input.argv,
    })}\n`,
    "utf-8",
  );
  return path;
}

export function summarizeReleaseResults(results: SuiteResult[]): {
  exitCode: number;
  rows: Array<SuiteResult & { status: "PASS" | "FAIL" }>;
} {
  const rows = results.map((result) => ({
    ...result,
    status: result.exitCode === 0 ? ("PASS" as const) : ("FAIL" as const),
  }));
  return {
    rows,
    exitCode: rows.some((row) => row.exitCode !== 0) ? 1 : 0,
  };
}

function command(
  suite: string,
  commandName: string,
  args: string[],
  env: Record<string, string> = {},
): ResolvedEvalCommand {
  const info = SUITES.find((entry) => entry.id === suite);
  return {
    suite,
    description: info?.description ?? suite,
    command: commandName,
    args,
    env,
  };
}

function parseOptions(argv: string[]): Record<string, string> {
  const options: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = "1";
    } else {
      options[key] = next;
      index += 1;
    }
  }
  return options;
}

function valueEnv(
  options: Record<string, string>,
  optionName: string,
  envName: string,
): Record<string, string> {
  const value = options[optionName];
  return value !== undefined ? { [envName]: value } : {};
}
