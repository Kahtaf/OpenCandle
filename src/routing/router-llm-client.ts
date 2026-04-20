import { completeSimple, type Model } from "@mariozechner/pi-ai";
import type { RouterLlmClient } from "./router-types.js";

/**
 * Build a router LLM client backed by pi-ai's `completeSimple`. The client
 * is intentionally thin: prompt in, raw text out. Schema validation and
 * retry logic live in `router.ts`.
 *
 * Zero tools are passed — the router operates on text alone. Temperature
 * is pinned low for structured-output stability.
 */
export function createPiAiRouterClient(model: Model<"anthropic-messages"> | Model<any>): RouterLlmClient {
  return {
    async complete(prompt: string): Promise<string> {
      const response = await completeSimple(
        model,
        {
          messages: [
            {
              role: "user",
              content: prompt,
              timestamp: Date.now(),
            },
          ],
          // Explicitly no tools — spec requirement.
          tools: [],
        },
        {
          temperature: 0,
          maxTokens: 2000,
          reasoning: "minimal",
        },
      );

      if (response.stopReason === "error" || response.stopReason === "aborted") {
        throw new Error(
          `router LLM call failed: ${response.errorMessage ?? response.stopReason}`,
        );
      }

      const text = response.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("");
      if (!text) {
        throw new Error("router LLM call returned no text content");
      }
      return text;
    },
  };
}
