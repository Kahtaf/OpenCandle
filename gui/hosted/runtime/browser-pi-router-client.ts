import type {
  Api,
  AssistantMessage,
  Context,
  Model,
  Provider,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import type { RouterLlmClient } from "../../../src/routing/router-types.js";
import type { ProbeRequest } from "./request-contract.js";

type BrowserModelProvider = ProbeRequest["provider"];

export interface ResolvedBrowserModel {
  provider: Provider<Api>;
  model: Model<Api>;
}

export function resolveBrowserModel(
  providerId: BrowserModelProvider,
  modelId: string,
): ResolvedBrowserModel {
  if (providerId !== "openai") throw new Error("Unsupported provider or model");
  const provider: Provider<Api> = openaiProvider();
  const model = provider.getModels().find((candidate) => candidate.id === modelId);
  if (!model || model.provider !== providerId) {
    throw new Error("Unsupported provider or model");
  }
  return { provider, model };
}

export function createBrowserPiRouterClient(
  providerId: BrowserModelProvider,
  modelId: string,
  apiKey: string,
): RouterLlmClient {
  const { provider, model } = resolveBrowserModel(providerId, modelId);
  return {
    async complete(prompt: string): Promise<string> {
      const context: Context = {
        messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
        tools: [],
      };
      const options: SimpleStreamOptions = {
        apiKey,
        temperature: 0,
        maxTokens: 2_000,
        reasoning: "minimal",
      };
      let response = await completeSimple(provider, model, context, options);
      if (
        response.stopReason === "error" &&
        isUnsupportedTemperatureError(response.errorMessage)
      ) {
        const { temperature: _temperature, ...retryOptions } = options;
        response = await completeSimple(provider, model, context, retryOptions);
      }
      if (response.stopReason === "error" || response.stopReason === "aborted") {
        throw new Error(`router LLM call failed: ${response.errorMessage ?? response.stopReason}`);
      }
      const text = response.content
        .filter((content): content is { type: "text"; text: string } => content.type === "text")
        .map((content) => content.text)
        .join("");
      if (!text) throw new Error("router LLM call returned no text content");
      return text;
    },
  };
}

async function completeSimple(
  provider: Provider<Api>,
  model: Model<Api>,
  context: Context,
  options: SimpleStreamOptions,
): Promise<AssistantMessage> {
  return provider.streamSimple(model, context, options).result();
}

function isUnsupportedTemperatureError(value: unknown): boolean {
  const message = value instanceof Error ? value.message : String(value ?? "");
  return /unsupported parameter/i.test(message) && /temperature/i.test(message);
}
