import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
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
import type {
  SessionCoordinator,
  SessionCoordinatorOptions,
} from "../runtime/session-coordinator.js";
import type { AskUserHandler } from "../types/index.js";
import { guardModelRuntimeApiKeyLogins } from "./model-key-login-guard.js";
import openCandleExtensionCore, {
  type OpenCandleExtensionOptions,
} from "./opencandle-extension-core.js";

export interface CreateOpenCandleSessionOptions {
  cwd?: string;
  agentDir?: string;
  modelRuntime?: ModelRuntime;
  model?: Model<Api>;
  thinkingLevel?: ThinkingLevel;
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
  onCoordinatorCreated?: OpenCandleExtensionOptions["onCoordinatorCreated"];
  titleCompletion?: OpenCandleExtensionOptions["titleCompletion"];
}

export interface CreateOpenCandleSessionResult extends CreateAgentSessionResult {
  coordinator?: SessionCoordinator;
  waitForSettled(): Promise<void>;
}

export async function createOpenCandleSessionCore(
  options: CreateOpenCandleSessionOptions = {},
): Promise<CreateOpenCandleSessionResult> {
  assertSupportedNodeVersion();
  loadEnv();

  const cwd = options.cwd ?? process.cwd();
  const agentDir = options.agentDir ?? getAgentDir();
  const useInlineExtension = options.useInlineExtension ?? true;
  if (options.modelRuntime) guardModelRuntimeApiKeyLogins(options.modelRuntime);
  let coordinator: SessionCoordinator | undefined;
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
              onCoordinatorCreated: (value) => {
                coordinator = value;
                options.onCoordinatorCreated?.(value);
              },
              titleCompletion: options.titleCompletion,
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
    model: options.model,
    thinkingLevel: options.thinkingLevel,
    sessionManager: options.sessionManager,
    settingsManager: options.settingsManager,
    resourceLoader,
    noTools: "builtin",
  });
  guardModelRuntimeApiKeyLogins(result.session.modelRuntime);

  await applySavedDefaultModel(result);

  if (options.bindExtensions !== false) {
    await result.session.bindExtensions({});
  }

  return {
    ...result,
    coordinator,
    async waitForSettled() {
      await coordinator?.waitForActiveWorkflow();
      await result.session.waitForIdle();
    },
  };
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
