import { ModelRegistry, ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import { getProvider, type ProviderId } from "../onboarding/providers.js";
import {
  clearProviderOnboardingEntry,
  loadOnboardingState,
  saveOnboardingState,
} from "../onboarding/state.js";
import { renderDoctorReport } from "./render.js";
import { buildDoctorReport, type DoctorModelSetupState } from "./report.js";

export async function handleDoctorCommand(
  args: string[],
  cwd: string,
  agentDir: string,
): Promise<boolean> {
  if (args[0] !== "doctor") return false;

  const json = args.includes("--json");
  const enableFlag = args.findIndex((arg) => arg === "--enable" || arg === "--reenable");
  if (enableFlag >= 0) {
    const providerId = args[enableFlag + 1] as ProviderId | undefined;
    if (!providerId) {
      console.error("Usage: opencandle doctor --enable <provider>");
      process.exitCode = 1;
      return true;
    }
    try {
      getProvider(providerId);
    } catch {
      console.error(`Unknown provider: ${providerId}`);
      process.exitCode = 1;
      return true;
    }
    saveOnboardingState(clearProviderOnboardingEntry(loadOnboardingState(), providerId));
    if (!json) console.log(`Re-enabled ${providerId}.`);
  }

  const modelRuntime = await ModelRuntime.create({
    authPath: `${agentDir}/auth.json`,
    modelsPath: `${agentDir}/models.json`,
  });
  const modelRegistry = new ModelRegistry(modelRuntime);
  const settingsManager = SettingsManager.create(cwd, agentDir);
  const includeSessions = args.includes("--sessions");
  if (includeSessions) {
    console.error(
      "Session checks may read browser cookies or trigger platform permission prompts for Reddit and X/Twitter.",
    );
  }
  const report = await buildDoctorReport({
    cwd,
    agentDir,
    includeSessions,
    includeGui: args.includes("--full"),
    modelSetup: buildCliModelSetupState(modelRegistry, settingsManager),
  });
  console.log(json ? JSON.stringify(report, null, 2) : renderDoctorReport(report));
  if (report.status === "blocked") process.exitCode = 1;
  return true;
}

function buildCliModelSetupState(
  modelRegistry: ModelRegistry,
  settingsManager: SettingsManager,
): DoctorModelSetupState {
  void modelRegistry.refresh();
  const provider = settingsManager.getDefaultProvider();
  const modelId = settingsManager.getDefaultModel();
  const activeModel = provider && modelId ? modelRegistry.find(provider, modelId) : undefined;
  if (activeModel && modelRegistry.hasConfiguredAuth(activeModel)) {
    return {
      requirement: "ready",
      currentModel: `${activeModel.provider}/${activeModel.id}`,
    };
  }

  const availableModels = modelRegistry.getAvailable().map((model) => ({
    provider: model.provider,
    id: model.id,
    label: `${model.provider}/${model.id}`,
  }));
  return {
    requirement: availableModels.length > 0 ? "select_model" : "connect_auth",
    currentModel: activeModel ? `${activeModel.provider}/${activeModel.id}` : undefined,
    availableModels,
  };
}
