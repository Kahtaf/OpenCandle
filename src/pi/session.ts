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
import vantageExtension from "./vantage-extension.js";

export interface CreateVantageSessionOptions {
  cwd?: string;
  authStorage?: AuthStorage;
  modelRegistry?: ModelRegistry;
  settingsManager?: SettingsManager;
  sessionManager?: SessionManager;
  useInlineExtension?: boolean;
}

export async function createVantageSession(
  options: CreateVantageSessionOptions = {},
): Promise<CreateAgentSessionResult> {
  loadEnv();

  const cwd = options.cwd ?? process.cwd();
  const useInlineExtension = options.useInlineExtension ?? true;
  const resourceLoader = useInlineExtension
    ? new DefaultResourceLoader({
        cwd,
        settingsManager: options.settingsManager,
        extensionFactories: [vantageExtension],
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
