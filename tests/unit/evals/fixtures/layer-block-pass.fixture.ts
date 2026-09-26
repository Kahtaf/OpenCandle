import { vi } from "vitest";
import { registerEvalSuite } from "../../../evals/eval-suite.js";
import type { EvalTrace } from "../../../evals/types.js";

// All-green control for the layer-block fixture: the same credible mock
// boundary, but every layer passes and every number is grounded.
vi.mock("../../../evals/runner.js", () => ({
  runEvalCase: vi.fn(
    async (): Promise<EvalTrace> => ({
      prompt: "isolated diagnostic fixture prompt for all-green control",
      classification: {
        workflow: "single_asset_analysis",
        confidence: 0.95,
        tier: "rule",
        entities: { symbols: ["ZZTST"] },
      },
      toolCalls: [
        {
          name: "get_quote",
          args: { symbol: "ZZTST" },
          result: { price: 100, high: 200, low: 300 },
        },
      ],
      askUserTranscript: [],
      text: "ZZTST trades at $100, with a high of $200 and a low of $300.",
      customEntries: [],
    }),
  ),
}));

const diagnosticsDir = process.env.EVAL_DIAGNOSTICS_DIR;

registerEvalSuite(
  "eval layer-block pass fixture",
  [
    {
      name: "all-layers-pass",
      tier: "always",
      prompt: "isolated diagnostic fixture prompt for all-green control",
      assertions: { requiredTools: ["get_quote"], dataFaithfulness: true },
    },
  ],
  diagnosticsDir ? { diagnosticsDir } : undefined,
);
