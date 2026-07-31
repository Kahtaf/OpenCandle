import {
  type CreateAgentSessionResult,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  type ModelRuntime,
  type SessionManager,
  type SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { loadEnv } from "../config.js";
import { assertSupportedNodeVersion } from "../infra/node-version.js";
import type { SessionCoordinatorOptions } from "../runtime/session-coordinator.js";
import type { AskUserHandler } from "../types/index.js";
import openCandleExtensionCore, {
  type OpenCandleExtensionOptions,
} from "./opencandle-extension-core.js";

export interface CreateOpenCandleSessionOptions {
  cwd?: string;
  agentDir?: string;
  modelRuntime?: ModelRuntime;
  settingsManager?: SettingsManager;
  sessionManager?: SessionManager;
  useInlineExtension?: boolean;
  bindExtensions?: boolean;
  askUserHandler?: AskUserHandler;
  stateDatabaseFactory?: SessionCoordinatorOptions["stateDatabaseFactory"];
  addonToolDescriptionsFactory?: SessionCoordinatorOptions["addonToolDescriptionsFactory"];
  toolDefaultsFactory?: SessionCoordinatorOptions["toolDefaultsFactory"];
  toolDefinitions?: OpenCandleExtensionOptions["toolDefinitions"];
  routerLlmClient?: OpenCandleExtensionOptions["routerLlmClient"];
  setupRunner?: OpenCandleExtensionOptions["setupRunner"];
}

export async function createOpenCandleSessionCore(
  options: CreateOpenCandleSessionOptions = {},
): Promise<CreateAgentSessionResult> {
  assertSupportedNodeVersion();
  loadEnv();

  const cwd = options.cwd ?? process.cwd();
  const agentDir = options.agentDir ?? getAgentDir();
  const useInlineExtension = options.useInlineExtension ?? true;
  const resourceLoader = useInlineExtension
    ? new DefaultResourceLoader({
        cwd,
        agentDir,
        settingsManager: options.settingsManager,
        extensionFactories: [
          (pi) =>
            openCandleExtensionCore(pi, {
              askUserHandler: options.askUserHandler,
              modelRuntime: options.modelRuntime,
              stateDatabaseFactory: options.stateDatabaseFactory,
              toolDefinitions: options.toolDefinitions,
              routerLlmClient: options.routerLlmClient,
              setupRunner: options.setupRunner,
              addonToolDescriptionsFactory: options.addonToolDescriptionsFactory,
              toolDefaultsFactory: options.toolDefaultsFactory,
            }),
        ],
      })
    : undefined;

  if (resourceLoader) {
    await resourceLoader.reload();
  }

  const result = await createAgentSession({
    cwd,
    agentDir,
    modelRuntime: options.modelRuntime,
    sessionManager: options.sessionManager,
    settingsManager: options.settingsManager,
    resourceLoader,
    noTools: "builtin",
  });

  await applySavedDefaultModel(result);

  if (options.bindExtensions !== false) {
    await result.session.bindExtensions({});
  }

  return result;
}

async function applySavedDefaultModel(result: CreateAgentSessionResult): Promise<void> {
  const provider = result.session.settingsManager.getDefaultProvider();
  const modelId = result.session.settingsManager.getDefaultModel();
  if (!provider || !modelId) return;

  const savedDefault = result.session.modelRuntime.getModel(provider, modelId);
  if (!savedDefault || !result.session.modelRuntime.hasConfiguredAuth(savedDefault.provider))
    return;

  const current = result.session.model;
  if (current?.provider === savedDefault.provider && current.id === savedDefault.id) return;

  await result.session.setModel(savedDefault);
}
