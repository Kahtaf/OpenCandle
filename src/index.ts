import { InteractiveMode, SettingsManager, initTheme } from "@mariozechner/pi-coding-agent";
import { createVantageSession } from "./agent.js";

async function main(): Promise<void> {
  const cwd = process.cwd();
  const settingsManager = SettingsManager.create(cwd);

  initTheme(settingsManager.getTheme(), true);

  const { session, modelFallbackMessage } = await createVantageSession({
    cwd,
    settingsManager,
  });

  try {
    const interactiveMode = new InteractiveMode(session, {
      modelFallbackMessage,
    });
    await interactiveMode.run();
  } finally {
    session.dispose();
  }
}

await main();
