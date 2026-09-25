import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Test-only Pi/OpenCandle configuration for the deterministic GUI journey.
 *
 * The real `gui/server/server.ts` is imported unmodified in a child process.
 * Everything it reads from disk or the environment is pointed at an isolated
 * temp root: HOME, OPENCANDLE_HOME, and PI_CODING_AGENT_DIR. A custom
 * OpenCandle test provider is written with the supported `models.json` schema
 * so the unmodified server talks to the local HTTP model fixture.
 */

export const GUI_JOURNEY_PROVIDER_ID = "oc-gui-journey";
export const GUI_JOURNEY_MODEL_ID = "oc-gui-journey-model";
export const GUI_JOURNEY_API_KEY = "test-gui-journey-key";

export interface GuiJourneyPaths {
  root: string;
  home: string;
  openCandleHome: string;
  agentDir: string;
  sessionDir: string;
}

export function writeModelRuntimeConfig(options: {
  agentDir: string;
  modelBaseUrl: string;
  providerId?: string;
  modelId?: string;
  apiKey?: string;
}): void {
  const providerId = options.providerId ?? GUI_JOURNEY_PROVIDER_ID;
  const modelId = options.modelId ?? GUI_JOURNEY_MODEL_ID;
  const apiKey = options.apiKey ?? GUI_JOURNEY_API_KEY;
  mkdirSync(options.agentDir, { recursive: true });

  // Supported Pi models.json schema (docs/models.md): a custom OpenAI-compatible
  // provider with a literal test key. No other provider credentials are present.
  const modelsJson = {
    providers: {
      [providerId]: {
        name: "OpenCandle GUI Journey Test Provider",
        baseUrl: options.modelBaseUrl,
        api: "openai-completions",
        apiKey,
        // The fixture server speaks plain OpenAI chat completions; skip the
        // developer-role / reasoning-effort extensions real OpenAI uses.
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
        },
        models: [
          {
            id: modelId,
            name: "OpenCandle GUI Journey Test Model",
            reasoning: false,
            input: ["text"],
            contextWindow: 8192,
            maxTokens: 1024,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          },
        ],
      },
    },
  };
  writeFileSync(join(options.agentDir, "models.json"), JSON.stringify(modelsJson, null, 2));

  const settingsJson = {
    defaultProvider: providerId,
    defaultModel: modelId,
    // Never prompt about project trust in the isolated child.
    defaultProjectTrust: "never",
  };
  writeFileSync(join(options.agentDir, "settings.json"), JSON.stringify(settingsJson, null, 2));
}
