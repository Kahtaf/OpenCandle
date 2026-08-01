import type { Api, Model } from "@earendil-works/pi-ai";
import type { RouterLlmClient } from "./router-types.js";

export type PiModelCompletion = typeof import("@earendil-works/pi-ai/compat").completeSimple;
type CompleteSimpleResponse = Awaited<ReturnType<PiModelCompletion>>;

const defaultPiModelCompletion: PiModelCompletion = async (...args) => {
  const { completeSimple } = await import("@earendil-works/pi-ai/compat");
  return completeSimple(...args);
};

/**
 * Build a router LLM client backed by pi-ai's `completeSimple`. The client
 * is intentionally thin: prompt in, raw text out. Schema validation and
 * retry logic live in `router.ts`.
 *
 * Zero tools are passed — the router operates on text alone. Temperature
 * is pinned low for structured-output stability.
 */
export function createPiAiRouterClient(
  model: Model<"anthropic-messages"> | Model<Api>,
  complete: PiModelCompletion = defaultPiModelCompletion,
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
        ...(model.reasoning ? {} : { temperature: 0 }),
        maxTokens: 2000,
        reasoning: "minimal" as const,
      };
      let response: CompleteSimpleResponse;
      try {
        response = await complete(model, request, options);
      } catch (error) {
        if (!isUnsupportedTemperatureError(error)) throw error;
        const { temperature: _temperature, ...retryOptions } = options;
        response = await complete(model, request, retryOptions);
      }
      if (response.stopReason === "error" && isUnsupportedTemperatureError(response.errorMessage)) {
        const { temperature: _temperature, ...retryOptions } = options;
        response = await complete(model, request, retryOptions);
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
