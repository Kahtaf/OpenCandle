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
import { getOpenCandleToolDefinitions } from "./tool-adapter.js";
import type { AskUserHandler } from "../types/index.js";

export interface CreateOpenCandleSessionOptions {
  cwd?: string;
  authStorage?: AuthStorage;
  modelRegistry?: ModelRegistry;
  settingsManager?: SettingsManager;
  sessionManager?: SessionManager;
  agentDir?: string;
  useInlineExtension?: boolean;
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

  const activeToolNames = getOpenCandleToolDefinitions().map((tool) => tool.name);

  return createAgentSession({
    cwd,
    agentDir,
    authStorage: options.authStorage,
    modelRegistry: options.modelRegistry,
    sessionManager: options.sessionManager,
    settingsManager: options.settingsManager,
    resourceLoader,
    tools: activeToolNames,
  });
}
