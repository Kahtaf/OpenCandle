import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

export interface PromptObservation {
  userTexts: string[];
  sawAssistantOrTool: boolean;
}

export function createPromptObservation(): PromptObservation {
  return {
    userTexts: [],
    sawAssistantOrTool: false,
  };
}

export function observePromptEvent(observation: PromptObservation, event: AgentSessionEvent): void {
  if (event.type === "message_start") {
    const message = event.message as { role?: unknown; content?: unknown };
    if (message.role === "user") {
      observation.userTexts.push(messageTextFromContent(message.content));
      return;
    }
    if (message.role === "assistant") {
      observation.sawAssistantOrTool = true;
    }
    return;
  }

  if (event.type === "tool_execution_start") {
    observation.sawAssistantOrTool = true;
  }
}

export function selectReplayPrompt(
  observation: PromptObservation,
  originalPrompt: string,
): string | undefined {
  if (observation.sawAssistantOrTool) return undefined;

  const original = originalPrompt.trim();
  const text = [...observation.userTexts]
    .reverse()
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.length > 0 && candidate !== original);

  return text || undefined;
}

function messageTextFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      typeof part === "object" && part !== null && "text" in part && typeof part.text === "string"
        ? part.text
        : "",
    )
    .join("");
}
