import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/core/model-runtime.js";
import {
  browserSafeModelProviderIds,
  type FirstClassModelProviderId,
} from "../../../src/pi/model-provider-metadata.js";

export type BrowserModelCredentials = Partial<Record<FirstClassModelProviderId, string>>;

/**
 * Create the same concrete Pi ModelRuntime used by the local GUI and TUI.
 * The hosted bundle aliases Pi's all-provider catalog to the browser-safe
 * first-class provider set, but discovery, auth, request preparation,
 * compatibility overlays, and streaming remain Pi's implementation.
 */
export async function createBrowserModelRuntime(
  configured: BrowserModelCredentials,
): Promise<ModelRuntime> {
  const credentials = new InMemoryCredentialStore();
  for (const providerId of browserSafeModelProviderIds) {
    const key = configured[providerId]?.trim();
    if (!key) continue;
    await credentials.modify(providerId, async () => ({ type: "api_key", key }));
  }

  return ModelRuntime.create({
    credentials,
    modelsPath: null,
    allowModelNetwork: false,
  });
}
