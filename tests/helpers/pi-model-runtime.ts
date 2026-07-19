import { type Credential, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";

export async function createTestModelRuntime(
  credentialsByProvider: Record<string, Credential> = {},
) {
  const credentials = new InMemoryCredentialStore();
  for (const [providerId, credential] of Object.entries(credentialsByProvider)) {
    await credentials.modify(providerId, async () => credential);
  }
  const modelRuntime = await ModelRuntime.create({
    credentials,
    modelsPath: null,
    allowModelNetwork: false,
  });
  return {
    credentials,
    modelRuntime,
    modelRegistry: new ModelRegistry(modelRuntime),
  };
}
