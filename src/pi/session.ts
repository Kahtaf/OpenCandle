import "../infra/node-version.js";
import {
  type AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
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
    authStorage: options.authStorage,
    modelRegistry: options.modelRegistry,
    sessionManager: options.sessionManager,
    settingsManager: options.settingsManager,
    resourceLoader,
    noTools: "builtin",
  });

  if (options.bindExtensions !== false) {
    await result.session.bindExtensions({});
  }

  return result;
}
