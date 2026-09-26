import { vi } from "vitest";
import { registerEvalSuite } from "../../../evals/eval-suite.js";
import type { EvalTrace } from "../../../evals/types.js";

// Credible mock boundary: only the live agent harness is replaced. The real
// scoreCase, registerEvalSuite, buildReport, and formatReport all run.
vi.mock("../../../evals/runner.js", () => ({
  runEvalCase: vi.fn(
    async (): Promise<EvalTrace> => ({
      // Generated isolated test prompt, not real user input.
      prompt: "isolated diagnostic fixture prompt for layer-block evidence",
      classification: {
        workflow: "single_asset_analysis",
        confidence: 0.95,
        tier: "rule",
        entities: { symbols: ["ZZTST"] },
      },
      toolCalls: [
        {
          name: "get_quote",
          args: { symbol: "ZZTST", access_token: "synthetic-fixture-secret-value" },
          result: { price: 100, high: 200, low: 300 },
        },
      ],
      askUserTranscript: [],
      // 4 financial numbers, only 3 grounded by the tool result: the
      // data_faithfulness layer scores 0.75 but the aggregate stays 0.875.
      text: "ZZTST trades at $100, with a high of $200, a low of $300, and a target of $999. session=fixture-session-token",
      customEntries: [],
    }),
  ),
}));

const diagnosticsDir = process.env.EVAL_DIAGNOSTICS_DIR;

registerEvalSuite(
  "eval layer-block fail fixture",
  [
    {
      name: "partial-layer",
      tier: "always",
      prompt: "isolated diagnostic fixture prompt for layer-block evidence",
      assertions: { requiredTools: ["get_quote"], dataFaithfulness: true },
    },
  ],
  diagnosticsDir ? { diagnosticsDir } : undefined,
);
