import {
  AuthStorage,
  InteractiveMode,
  ModelRegistry,
  SettingsManager,
  initTheme,
} from "@mariozechner/pi-coding-agent";
import { createVantageSession } from "./agent.js";
import { loadEnv } from "./config.js";

async function main(): Promise<void> {
  const cwd = process.cwd();
  loadEnv();
  const settingsManager = SettingsManager.create(cwd);
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  const shouldSuppressFallbackMessage = modelRegistry.getAvailable().length === 0;

  initTheme(settingsManager.getTheme(), true);

  const { session, modelFallbackMessage } = await createVantageSession({
    cwd,
    settingsManager,
    authStorage,
    modelRegistry,
  });

  try {
    const interactiveMode = new InteractiveMode(session, {
      modelFallbackMessage: shouldSuppressFallbackMessage ? undefined : modelFallbackMessage,
    });
    await interactiveMode.run();
  } finally {
    session.dispose();
  }
}

await main();
