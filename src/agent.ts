import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import type { Config } from "./config.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { getAllTools } from "./tools/index.js";

export function createAgent(config: Config): Agent {
  const agent = new Agent({
    initialState: {
      systemPrompt: buildSystemPrompt(),
      model: getModel("google", "gemini-3-flash-preview"),
      tools: getAllTools(),
    },
    getApiKey: (provider: string) => {
      if (provider === "google") return config.geminiApiKey;
      return undefined;
    },
  });

  agent.setThinkingLevel("low");

  return agent;
}
