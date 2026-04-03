import {
  type AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  type ModelRegistry,
  type CreateAgentSessionResult,
  type SettingsManager,
  type SessionManager,
} from "@mariozechner/pi-coding-agent";
import { loadEnv } from "../config.js";
import openCandleExtension from "./opencandle-extension.js";
import type { AskUserHandler } from "../types/index.js";

export interface CreateOpenCandleSessionOptions {
  cwd?: string;
  authStorage?: AuthStorage;
  modelRegistry?: ModelRegistry;
  settingsManager?: SettingsManager;
  sessionManager?: SessionManager;
  useInlineExtension?: boolean;
  askUserHandler?: AskUserHandler;
}

export async function createOpenCandleSession(
  options: CreateOpenCandleSessionOptions = {},
): Promise<CreateAgentSessionResult> {
  loadEnv();

  const cwd = options.cwd ?? process.cwd();
  const useInlineExtension = options.useInlineExtension ?? true;
  const resourceLoader = useInlineExtension
    ? new DefaultResourceLoader({
        cwd,
        settingsManager: options.settingsManager,
        extensionFactories: [(pi) => openCandleExtension(pi, { askUserHandler: options.askUserHandler })],
      })
    : undefined;

  if (resourceLoader) {
    await resourceLoader.reload();
  }

  return createAgentSession({
    cwd,
    authStorage: options.authStorage,
    modelRegistry: options.modelRegistry,
    sessionManager: options.sessionManager,
    settingsManager: options.settingsManager,
    resourceLoader,
    tools: [],
  });
}
