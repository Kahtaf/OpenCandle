import { ApiKeyProviderBuilder } from "./api-key-provider-builder.jsx";
import { ExternalToolProviderBuilder } from "./external-tool-provider-builder.jsx";
import { PublicHttpProviderBuilder } from "./public-http-provider-builder.jsx";

export function ProviderBuilder({ provider, send, setToast }) {
  if (provider.kind === "external-tool") {
    return <ExternalToolProviderBuilder provider={provider} send={send} setToast={setToast} />;
  }
  if (provider.kind === "public-http") {
    return <PublicHttpProviderBuilder provider={provider} send={send} setToast={setToast} />;
  }
  return <ApiKeyProviderBuilder provider={provider} send={send} setToast={setToast} />;
}
