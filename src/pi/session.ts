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
import type { AskUserHandler } from "../types/index.js";
import openCandleExtension from "./opencandle-extension.js";

export interface CreateOpenCandleSessionOptions {
  cwd?: string;
  agentDir?: string;
  modelRuntime?: ModelRuntime;
  settingsManager?: SettingsManager;
  sessionManager?: SessionManager;
  useInlineExtension?: boolean;
  bindExtensions?: boolean;
  askUserHandler?: AskUserHandler;
}

export async function createOpenCandleSession(
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
            openCandleExtension(pi, {
              askUserHandler: options.askUserHandler,
              modelRuntime: options.modelRuntime,
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
