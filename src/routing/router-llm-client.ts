import type { Model } from "@earendil-works/pi-ai";
import { completeSimple } from "@earendil-works/pi-ai/compat";
import type { RouterLlmClient } from "./router-types.js";

type CompleteSimpleResponse = Awaited<ReturnType<typeof completeSimple>>;

/**
 * Build a router LLM client backed by pi-ai's `completeSimple`. The client
 * is intentionally thin: prompt in, raw text out. Schema validation and
 * retry logic live in `router.ts`.
 *
 * Zero tools are passed — the router operates on text alone. Temperature
 * is pinned low for structured-output stability.
 */
export function createPiAiRouterClient(
  model: Model<"anthropic-messages"> | Model<any>,
): RouterLlmClient {
  return {
    async complete(prompt: string): Promise<string> {
      const request = {
        messages: [
          {
            role: "user" as const,
            content: prompt,
            timestamp: Date.now(),
          },
        ],
        // Explicitly no tools — spec requirement.
        tools: [],
      };
      const options = {
        temperature: 0,
        maxTokens: 2000,
        reasoning: "minimal" as const,
      };
      let response: CompleteSimpleResponse;
      try {
        response = await completeSimple(model, request, options);
      } catch (error) {
        if (!isUnsupportedTemperatureError(error)) throw error;
        const { temperature: _temperature, ...retryOptions } = options;
        response = await completeSimple(model, request, retryOptions);
      }

      if (response.stopReason === "error" || response.stopReason === "aborted") {
        throw new Error(`router LLM call failed: ${response.errorMessage ?? response.stopReason}`);
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

function isUnsupportedTemperatureError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unsupported parameter/i.test(message) && /temperature/i.test(message);
}
