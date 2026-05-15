import "../infra/node-version.js";
import {
  type AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  type ModelRegistry,
  type CreateAgentSessionResult,
  type SettingsManager,
  type SessionManager,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { loadEnv } from "../config.js";
import openCandleExtension from "./opencandle-extension.js";
import type { AskUserHandler } from "../types/index.js";

export interface CreateOpenCandleSessionOptions {
  cwd?: string;
  agentDir?: string;
  authStorage?: AuthStorage;
  modelRegistry?: ModelRegistry;
  settingsManager?: SettingsManager;
  sessionManager?: SessionManager;
  useInlineExtension?: boolean;
  bindExtensions?: boolean;
  askUserHandler?: AskUserHandler;
}

export async function createOpenCandleSession(
  options: CreateOpenCandleSessionOptions = {},
): Promise<CreateAgentSessionResult> {
  loadEnv();

  const cwd = options.cwd ?? process.cwd();
  const agentDir = options.agentDir ?? getAgentDir();
  const useInlineExtension = options.useInlineExtension ?? true;
  const resourceLoader = useInlineExtension
    ? new DefaultResourceLoader({
        cwd,
        agentDir,
        settingsManager: options.settingsManager,
        extensionFactories: [(pi) => openCandleExtension(pi, { askUserHandler: options.askUserHandler })],
      })
    : undefined;

  if (resourceLoader) {
    await resourceLoader.reload();
  }

  const result = await createAgentSession({
    cwd,
    agentDir,
    authStorage: options.authStorage,
    modelRegistry: options.modelRegistry,
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

  const savedDefault = result.session.modelRegistry.find(provider, modelId);
  if (!savedDefault || !result.session.modelRegistry.hasConfiguredAuth(savedDefault)) return;

  const current = result.session.model;
  if (current?.provider === savedDefault.provider && current.id === savedDefault.id) return;

  await result.session.setModel(savedDefault);
}
