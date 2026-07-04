/**
 * Subscribes to session events and builds an AgentTrace.
 * Optionally streams events to a JSONL file.
 */

import { appendFileSync, writeFileSync } from "node:fs";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { AgentTrace, InteractionTrace, ToolCallTrace, TurnTrace } from "./types.js";

interface PendingToolCall {
  name: string;
  args: Record<string, unknown>;
  startTime: number;
}

export interface TraceCollector {
  /** Get the current trace snapshot. */
  getTrace(): AgentTrace;
  /** Set the prompt index applied to subsequently captured turns/interactions. */
  setPromptIndex(promptIndex: number): void;
  /** Record an ask_user interaction. */
  addInteraction(interaction: InteractionTrace): void;
  /** Unsubscribe from session events. */
  dispose(): void;
}

export function createTraceCollector(
  session: { subscribe: (cb: (event: AgentSessionEvent) => void) => () => void },
  prompt: string,
  options?: { jsonlPath?: string; trackPromptIndex?: boolean },
): TraceCollector {
  const startTime = Date.now();
  const pendingTools = new Map<string, PendingToolCall>();
  const turns: TurnTrace[] = [];
  const interactions: InteractionTrace[] = [];
  let currentPromptIndex = 0;
  const createTurn = (): TurnTrace => ({
    toolCalls: [],
    text: "",
    ...(options?.trackPromptIndex ? { promptIndex: currentPromptIndex } : {}),
  });
  let currentTurn: TurnTrace = createTurn();
  let finalText = "";

  if (options?.jsonlPath) {
    writeFileSync(options.jsonlPath, "", "utf-8");
  }

  function appendToJsonl(event: Record<string, unknown>) {
    if (options?.jsonlPath) {
      appendFileSync(options.jsonlPath, `${JSON.stringify(event)}\n`, "utf-8");
    }
  }

  const unsub = session.subscribe((event: AgentSessionEvent) => {
    switch (event.type) {
      case "tool_execution_start": {
        const pending: PendingToolCall = {
          name: event.toolName,
          args: event.args as Record<string, unknown>,
          startTime: Date.now(),
        };
        pendingTools.set(event.toolCallId, pending);
        appendToJsonl({
          type: event.type,
          toolName: event.toolName,
          args: event.args,
          timestamp: Date.now(),
        });
        break;
      }
      case "tool_execution_end": {
        const pending = pendingTools.get(event.toolCallId);
        if (pending) {
          const trace: ToolCallTrace = {
            name: pending.name,
            args: pending.args,
            result: event.result,
            isError: event.isError,
            durationMs: Date.now() - pending.startTime,
            ...(options?.trackPromptIndex ? { promptIndex: currentPromptIndex } : {}),
          };
          currentTurn.toolCalls.push(trace);
          pendingTools.delete(event.toolCallId);
        }
        appendToJsonl({
          type: event.type,
          toolName: event.toolName,
          result: event.result,
          isError: event.isError,
          timestamp: Date.now(),
        });
        break;
      }
      case "message_update": {
        if (event.assistantMessageEvent.type === "text_delta") {
          currentTurn.text += event.assistantMessageEvent.delta;
        }
        break;
      }
      case "turn_end": {
        if (currentTurn.toolCalls.length > 0 || currentTurn.text.length > 0) {
          turns.push(currentTurn);
        }
        currentTurn = createTurn();
        appendToJsonl({ type: event.type, timestamp: Date.now() });
        break;
      }
      case "agent_end": {
        // Push any remaining current turn
        if (currentTurn.toolCalls.length > 0 || currentTurn.text.length > 0) {
          turns.push(currentTurn);
          currentTurn = createTurn();
        }
        finalText = turns.length > 0 ? turns[turns.length - 1].text : "";
        appendToJsonl({ type: event.type, timestamp: Date.now() });
        break;
      }
    }
  });

  function buildToolSequence(): string[] {
    return turns.flatMap((t) => t.toolCalls.map((tc) => tc.name));
  }

  return {
    getTrace(): AgentTrace {
      return {
        prompt,
        turns,
        interactions,
        finalText,
        toolSequence: buildToolSequence(),
        durationMs: Date.now() - startTime,
      };
    },
    setPromptIndex(promptIndex: number) {
      currentPromptIndex = promptIndex;
      if (
        options?.trackPromptIndex &&
        currentTurn.toolCalls.length === 0 &&
        currentTurn.text === ""
      ) {
        currentTurn.promptIndex = promptIndex;
      }
    },
    addInteraction(interaction: InteractionTrace) {
      interactions.push({
        ...interaction,
        ...(options?.trackPromptIndex ? { promptIndex: currentPromptIndex } : {}),
      });
    },
    dispose() {
      unsub();
    },
  };
}
