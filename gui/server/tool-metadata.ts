import { getOpenCandleToolDefinitions } from "../../src/index.js";
import { getAllDefaults, setDefault } from "../../src/memory/tool-defaults.js";
import {
  getCredential,
  isApiKeyProvider,
  isExternalToolProvider,
  isPublicHttpProvider,
  PROVIDERS,
  type ProviderDescriptor,
} from "../../src/onboarding/providers.js";
import { loadOnboardingState, type OnboardingState } from "../../src/onboarding/state.js";
import {
  inferToolDomain,
  OPENCANDLE_WORKFLOWS,
  providerCatalogBase,
  serializeApiKeyProviderCatalog,
} from "../shared/catalog-metadata.js";

export function buildCatalog() {
  const defaults = getAllDefaults();
  const onboardingState = loadOnboardingState();
  const tools = getOpenCandleToolDefinitions().map((tool) => ({
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters,
    domain: inferToolDomain(tool.name),
    enabled: defaults.get(tool.name)?.__enabled !== false,
    defaults: defaults.get(tool.name) ?? {},
  }));

  return {
    tools,
    workflows: OPENCANDLE_WORKFLOWS,
    providers: PROVIDERS.map((provider) => serializeProvider(provider, onboardingState)),
  };
}

// A provider the user snoozed or dismissed is not simply unconfigured: the
// settings row says which of the two it is, and until when.
function serializeOnboarding(provider: ProviderDescriptor, onboardingState: OnboardingState) {
  const entry = onboardingState.providers[provider.id];
  if (!entry || entry.status === "completed") return {};
  return {
    onboarding:
      entry.status === "snoozed"
        ? { status: entry.status, snoozeUntil: entry.snoozeUntil }
        : { status: entry.status },
  };
}

function serializeProvider(provider: ProviderDescriptor, onboardingState: OnboardingState) {
  const common = {
    ...providerCatalogBase(provider),
    ...serializeOnboarding(provider, onboardingState),
  };

  if (isApiKeyProvider(provider)) {
    // Never serialize the credential value: this payload reaches the browser DOM.
    const credential = getCredential(provider.id);
    const source = credential.source;
    return {
      ...serializeApiKeyProviderCatalog(provider, {
        source,
        credential: credential.value,
      }),
      ...serializeOnboarding(provider, onboardingState),
      status: source,
    };
  }

  if (isExternalToolProvider(provider)) {
    if (onboardingState.providers[provider.id]?.status === "never_ask") {
      return {
        ...common,
        status: "skipped",
        statusDetail: {
          providerId: provider.id,
          kind: "external-tool",
          mode: "install",
          state: "skipped",
          installCmd: provider.installCmd,
          message: `Skipped by user preference; run opencandle doctor --enable ${provider.id} to re-enable.`,
          checkedAt: new Date().toISOString(),
          cacheHit: false,
        },
        binary: provider.binary,
        installCmd: provider.installCmd,
        sessionSource: provider.sessionSource,
        supportedBrowsers: provider.supportedBrowsers,
      };
    }
    return {
      ...common,
      status: "unknown",
      binary: provider.binary,
      installCmd: provider.installCmd,
      sessionSource: provider.sessionSource,
      supportedBrowsers: provider.supportedBrowsers,
    };
  }

  if (isPublicHttpProvider(provider)) {
    return {
      ...common,
      status: "unknown",
      probeUrl: provider.probeUrl,
    };
  }

  const exhaustive: never = provider;
  return exhaustive;
}

export function setToolEnabled(toolName: string, enabled: boolean): void {
  setDefault(toolName, "__enabled", enabled);
}
