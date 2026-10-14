import type { Provider } from "@earendil-works/pi-ai";
import { createFirstClassModelProviders } from "../../../src/pi/model-provider-catalog.js";

/** Browser-safe replacement for Pi's all-provider catalog. */
export function builtinProviders(): Provider[] {
  return createFirstClassModelProviders();
}

export function getBuiltinModelDataGeneratedAt(): number | undefined {
  return undefined;
}

export function radiusProvider(): never {
  throw new Error("Radius providers are unavailable in browser-hosted OpenCandle");
}

/** OpenRouter is outside the hosted provider allowlist. */
export function personalizeOpenRouterCatalog(): never {
  throw new Error("OpenRouter is unavailable in browser-hosted OpenCandle");
}
