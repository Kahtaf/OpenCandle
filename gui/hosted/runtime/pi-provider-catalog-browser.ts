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
