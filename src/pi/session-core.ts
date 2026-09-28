import { join } from "node:path";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import {
  type CreateAgentSessionResult,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  type SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { loadEnv } from "../config.js";
import { assertSupportedNodeVersion } from "../infra/node-version.js";
import type {
  SessionCoordinator,
  SessionCoordinatorOptions,
} from "../runtime/session-coordinator.js";
import type { AskUserHandler } from "../types/index.js";
import { chooseOpenCandleInitialModel } from "./default-model.js";
import { guardModelRuntimeApiKeyLogins } from "./model-key-login-guard.js";
import openCandleExtensionCore, {
  type OpenCandleExtensionOptions,
} from "./opencandle-extension-core.js";
import {
  attachSessionCancellationState,
  createSessionCancellationState,
} from "./session-cancellation.js";

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

// Session-bound coordinator lookup for host code (local GUI) that holds the
// AgentSession but not the coordinator created inside the extension factory.
const sessionCoordinators = new WeakMap<object, SessionCoordinator>();

export function getSessionCoordinator(
  session: object | null | undefined,
): SessionCoordinator | undefined {
  if (!session || typeof session !== "object") return undefined;
  return sessionCoordinators.get(session);
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
  // One cancellation state per created session. It is passed to the extension
  // so input-hook routing can abandon a cancelled turn, then attached to the
  // session object so the owning GUI can reach the current run token.
  const cancellation = createSessionCancellationState();
  const settingsManager = options.settingsManager ?? SettingsManager.create(cwd, agentDir);
  const resourceLoader = useInlineExtension
    ? new DefaultResourceLoader({
        cwd,
        agentDir,
        settingsManager,
        extensionFactories: [
          (pi) =>
            openCandleExtensionCore(pi, {
              askUserHandler: options.askUserHandler,
              modelRuntime: options.modelRuntime,
              cancellation,
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

  // Create the runtime the same way Pi would, so OpenCandle can pick its
  // provider default before Pi falls back to its own (see default-model.ts).
  const modelRuntime =
    options.modelRuntime ??
    (await ModelRuntime.create({
      authPath: join(agentDir, "auth.json"),
      modelsPath: join(agentDir, "models.json"),
    }));
  const initialModel = options.model
    ? undefined
    : chooseOpenCandleInitialModel({
        modelRuntime,
        settingsManager,
        sessionManager: options.sessionManager,
      });

  const result = await createAgentSession({
    cwd,
    agentDir,
    modelRuntime,
    model: options.model ?? initialModel?.model,
    thinkingLevel: options.thinkingLevel,
    sessionManager: options.sessionManager,
    settingsManager,
    resourceLoader,
    noTools: "builtin",
  });
  guardModelRuntimeApiKeyLogins(result.session.modelRuntime);
  if (initialModel?.fallbackMessage && !result.modelFallbackMessage) {
    result.modelFallbackMessage = initialModel.fallbackMessage;
  }

  attachSessionCancellationState(result.session, cancellation);
  if (coordinator) sessionCoordinators.set(result.session, coordinator);

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
