import type { Message, ToolResultMessage } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { ChatEvent, MessageContent, ToolOutput } from "../shared/chat-events.js";
import { normalizeToolOutput } from "../shared/tool-output.js";

export interface SessionEventOptions {
  sessionId: string;
  title?: string;
  updatedAt?: string;
  startSeq?: number;
  markUnresolvedToolCalls?: boolean;
}

export function sessionEntriesToChatEvents(
  entries: SessionEntry[],
  options: SessionEventOptions,
): ChatEvent[] {
  let seq = options.startSeq ?? 1;
  const events: ChatEvent[] = [];
  const seenToolCalls = new Set<string>();
  const resolvedToolCalls = new Set<string>();
  const pendingToolCalls = new Map<string, { name: string }>();
  const assistantErrorsWithExplicitFailure = pairedAssistantFailureIds(entries);
  // Set by an opencandle-user-input marker: the user's words before a workflow
  // transform expanded the turn. The next user message renders this instead.
  let pendingOriginalInput: string | null = null;
  let pendingOriginalAttachments: Array<{ kind: string; label: string }> = [];
  let lastEntryWasUserMessage = false;
  let lastUserCompletedEventIndex: number | null = null;
  let lastRetryPrompt: string | null = null;
  const workflowSteps = workflowStepMetadata(entries);
  const updatedAt = options.updatedAt ?? entries.at(-1)?.timestamp ?? new Date().toISOString();

  events.push({
    type: "session.updated",
    sessionId: options.sessionId,
    title: options.title,
    updatedAt,
    seq: seq++,
  });

  for (const entry of entries) {
    if (isOriginalInputEntry(entry)) {
      const originalInput = originalInputText(entry);
      const originalAttachments = originalInputAttachments(entry);
      if (lastEntryWasUserMessage && lastUserCompletedEventIndex != null) {
        applyOriginalInput(events[lastUserCompletedEventIndex], originalInput, originalAttachments);
      } else {
        pendingOriginalInput = originalInput;
        pendingOriginalAttachments = originalAttachments;
      }
      lastEntryWasUserMessage = false;
      continue;
    }

    if (entry.type === "custom_message") {
      lastEntryWasUserMessage = false;
      const messageId = entry.id;
      events.push({
        type: "custom.message",
        sessionId: options.sessionId,
        messageId,
        customType: String((entry as { customType?: unknown }).customType || "custom"),
        content: [{ type: "text", text: customMessageText(entry.content) }],
        details: (entry as { details?: unknown }).details,
        seq: seq++,
      });
      continue;
    }

    if (entry.type !== "message") {
      lastEntryWasUserMessage = false;
      continue;
    }
    const message = entry.message as Message;
    const messageId = entry.id;

    if (message.role === "user") {
      const workflowStep = workflowSteps.get(messageId);
      if (!workflowStep || workflowStep.preserveUserTurn) {
        const content = userMessageContent(message.content, pendingOriginalInput);
        events.push({
          type: "message.created",
          sessionId: options.sessionId,
          messageId,
          role: "user",
          seq: seq++,
        });
        const completedEvent: ChatEvent = {
          type: "message.completed",
          sessionId: options.sessionId,
          messageId,
          content,
          ...(pendingOriginalAttachments.length > 0
            ? { attachments: pendingOriginalAttachments }
            : {}),
          seq: seq++,
        };
        events.push(completedEvent);
        lastRetryPrompt = messageText(content).trim() || null;
        lastUserCompletedEventIndex = events.length - 1;
        lastEntryWasUserMessage = true;
      } else {
        lastEntryWasUserMessage = false;
      }
      if (workflowStep) {
        events.push({
          type: "custom.message",
          sessionId: options.sessionId,
          messageId: `workflow-step-${messageId}`,
          customType: "opencandle-workflow-step",
          content: userMessageContent(message.content, null),
          details: workflowStep,
          seq: seq++,
        });
      }
      pendingOriginalInput = null;
      pendingOriginalAttachments = [];
      continue;
    }

    if (message.role === "assistant") {
      lastEntryWasUserMessage = false;
      const failure = assistantFailure(message);
      if (failure) {
        if (!assistantErrorsWithExplicitFailure.has(messageId)) {
          events.push({
            type: "custom.message",
            sessionId: options.sessionId,
            messageId: `model-error-${messageId}`,
            customType: "opencandle-model-run-failed",
            content: [{ type: "text", text: failure.message }],
            details: {
              source: "persisted-assistant",
              reason: "model_error",
              provider: failure.provider,
              model: failure.model,
              ...(lastRetryPrompt ? { prompt: lastRetryPrompt } : {}),
            },
            seq: seq++,
          });
        }
        continue;
      }
      events.push({
        type: "message.created",
        sessionId: options.sessionId,
        messageId,
        role: "assistant",
        seq: seq++,
      });
      const content: MessageContent[] = [];
      for (const part of Array.isArray(message.content) ? message.content : []) {
        if (part.type === "text") {
          content.push({ type: "text", text: part.text });
          continue;
        }
        if (part.type === "toolCall") {
          seenToolCalls.add(part.id);
          pendingToolCalls.set(part.id, { name: part.name });
          content.push({ type: "tool", toolCallId: part.id });
          events.push({
            type: "tool.started",
            sessionId: options.sessionId,
            toolCallId: part.id,
            messageId,
            name: part.name,
            input: part.arguments,
            seq: seq++,
          });
        }
        if (part.type === "image") {
          content.push({ type: "image", url: part.url });
        }
      }
      events.push({
        type: "message.completed",
        sessionId: options.sessionId,
        messageId,
        content,
        seq: seq++,
      });
      continue;
    }

    if (message.role === "toolResult") {
      lastEntryWasUserMessage = false;
      const tool = message as ToolResultMessage;
      const toolCallId = tool.toolCallId || `tool-${entry.id}`;
      resolvedToolCalls.add(toolCallId);
      pendingToolCalls.delete(toolCallId);
      if (!seenToolCalls.has(toolCallId)) {
        events.push({
          type: "tool.started",
          sessionId: options.sessionId,
          toolCallId,
          messageId,
          name: tool.toolName || "tool",
          input: inputFromDetails(tool.details),
          seq: seq++,
        });
      }
      events.push({
        type: tool.isError ? "tool.failed" : "tool.completed",
        sessionId: options.sessionId,
        toolCallId,
        ...(tool.isError
          ? { error: { message: messageText(tool.content), details: tool.details } }
          : { output: toolOutput(tool) }),
        seq: seq++,
      } as ChatEvent);
    }
  }

  if (options.markUnresolvedToolCalls !== false) {
    for (const [toolCallId, tool] of pendingToolCalls) {
      if (resolvedToolCalls.has(toolCallId)) continue;
      events.push({
        type: "tool.failed",
        sessionId: options.sessionId,
        toolCallId,
        error: {
          message:
            "Tool call did not finish. The run may have been interrupted before OpenCandle received a tool result.",
          details: { toolName: tool.name, reason: "missing_tool_result" },
        },
        seq: seq++,
      });
    }
  }

  return events;
}

function pairedAssistantFailureIds(entries: SessionEntry[]): Set<string> {
  const paired = new Set<string>();
  entries.forEach((entry, index) => {
    if (entry.type !== "message" || !assistantFailure(entry.message as Message)) return;
    const next = entries[index + 1];
    if (
      next?.type === "custom_message" &&
      (next as { customType?: unknown }).customType === "opencandle-model-run-failed"
    ) {
      paired.add(entry.id);
    }
  });
  return paired;
}

function assistantFailure(message: Message): {
  message: string;
  provider?: string;
  model?: string;
} | null {
  if (message.role !== "assistant" || message.stopReason !== "error") return null;
  const failure = message as Message & {
    errorMessage?: unknown;
    provider?: unknown;
    model?: unknown;
  };
  const errorMessage =
    typeof failure.errorMessage === "string" && failure.errorMessage.trim()
      ? failure.errorMessage.trim()
      : "The model run failed before it returned a response.";
  return {
    message: errorMessage,
    ...(typeof failure.provider === "string" ? { provider: failure.provider } : {}),
    ...(typeof failure.model === "string" ? { model: failure.model } : {}),
  };
}

interface WorkflowStepDetails {
  label: string;
  stage: string;
  step: number;
  total: number;
  preserveUserTurn: boolean;
}

interface WorkflowStepCandidate {
  messageId: string;
  stage?: string;
  label?: string;
  preserveUserTurn: boolean;
}

function workflowStepMetadata(entries: SessionEntry[]): Map<string, WorkflowStepDetails> {
  const groups: WorkflowStepCandidate[][] = [];
  let activeGroup: WorkflowStepCandidate[] | null = null;
  let pendingOriginalInput = false;

  for (const [index, entry] of entries.entries()) {
    if (isCustomEntry(entry, "opencandle-workflow")) {
      activeGroup = [];
      groups.push(activeGroup);
      continue;
    }
    if (isOriginalInputEntry(entry)) {
      const previousEntry = entries[index - 1];
      const followsUserMessage =
        previousEntry?.type === "message" && (previousEntry.message as Message).role === "user";
      pendingOriginalInput = !followsUserMessage;
      continue;
    }
    if (entry.type === "message" && (entry.message as Message).role === "user") {
      if (activeGroup) {
        const candidate: WorkflowStepCandidate = {
          messageId: entry.id,
          preserveUserTurn: pendingOriginalInput,
        };
        activeGroup.push(candidate);
      }
      pendingOriginalInput = false;
      continue;
    }
    if (isCustomEntry(entry, "opencandle-analyst-step")) {
      const data = customEntryData(entry);
      const stage = stringField(data, "stage") ?? "analysis";
      assignPendingWorkflowSteps(activeGroup, stage, workflowStepLabel(stage, data));
      continue;
    }
    if (isCustomEntry(entry, "opencandle-validation")) {
      assignPendingWorkflowSteps(activeGroup, "validation", "Validation and synthesis");
      activeGroup = null;
      pendingOriginalInput = false;
      continue;
    }
    if (
      isCustomEntry(entry, "opencandle-workflow-complete") ||
      isCustomEntry(entry, "opencandle-workflow-aborted")
    ) {
      activeGroup = null;
      pendingOriginalInput = false;
      continue;
    }
  }

  const metadata = new Map<string, WorkflowStepDetails>();
  for (const group of groups) {
    group.forEach((candidate, index) => {
      metadata.set(candidate.messageId, {
        label: candidate.label ?? "Workflow step",
        stage: candidate.stage ?? "workflow",
        step: index + 1,
        total: group.length,
        preserveUserTurn: candidate.preserveUserTurn,
      });
    });
  }
  return metadata;
}

function assignPendingWorkflowSteps(
  group: WorkflowStepCandidate[] | null,
  stage: string,
  label: string,
): void {
  if (!group) return;
  for (let index = group.length - 1; index >= 0; index -= 1) {
    const candidate = group[index];
    if (candidate.stage) continue;
    candidate.stage = stage;
    candidate.label = label;
    return;
  }
}

function workflowStepLabel(stage: string, data: Record<string, unknown>): string {
  const role = stringField(data, "role");
  if (stage.startsWith("analyst_")) {
    return `${sentenceCase(role ?? stage.slice("analyst_".length))} analyst`;
  }
  if (stage === "debate_bull") return "Bull researcher";
  if (stage === "debate_bear") return "Bear researcher";
  if (stage === "debate_rebuttal") return "Debate rebuttal";
  return sentenceCase(stage.replaceAll("_", " "));
}

function sentenceCase(value: string): string {
  const normalized = value.trim().toLowerCase();
  return normalized ? `${normalized[0].toUpperCase()}${normalized.slice(1)}` : "Workflow step";
}

function isCustomEntry(entry: SessionEntry, customType: string): boolean {
  return entry.type === "custom" && (entry as { customType?: unknown }).customType === customType;
}

function customEntryData(entry: SessionEntry): Record<string, unknown> {
  const data = (entry as { data?: unknown }).data;
  return typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
}

function stringField(data: Record<string, unknown>, field: string): string | undefined {
  const value = data[field];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function applyOriginalInput(
  event: ChatEvent | undefined,
  originalInput: string | null,
  attachments: Array<{ kind: string; label: string }>,
): void {
  if (event?.type !== "message.completed") return;
  if (originalInput) {
    event.content = userMessageContent(event.content, originalInput);
  }
  if (attachments.length > 0) {
    event.attachments = attachments;
  }
}

export function isOriginalInputEntry(entry: SessionEntry): boolean {
  return (
    entry.type === "custom" &&
    (entry as { customType?: unknown }).customType === "opencandle-user-input"
  );
}

export function originalInputText(entry: SessionEntry): string | null {
  const data = (entry as { data?: { original?: unknown } }).data;
  return typeof data?.original === "string" && data.original.trim().length > 0
    ? data.original
    : null;
}

export function originalInputAttachments(
  entry: SessionEntry,
): Array<{ kind: string; label: string }> {
  const data = (entry as { data?: { attachments?: unknown } }).data;
  if (!Array.isArray(data?.attachments)) return [];
  return data.attachments
    .map((attachment) => {
      if (typeof attachment !== "object" || attachment === null) return null;
      const kind = String((attachment as { kind?: unknown }).kind ?? "").trim();
      const label = String((attachment as { label?: unknown }).label ?? "").trim();
      return kind && label ? { kind, label } : null;
    })
    .filter((attachment): attachment is { kind: string; label: string } => attachment != null);
}

function customMessageText(content: unknown): string {
  if (typeof content === "string") return content;
  return messageText(content);
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => (typeof part.text === "string" ? part.text : "")).join("");
}

function userMessageContent(content: unknown, originalText: string | null): MessageContent[] {
  const parts: MessageContent[] = [{ type: "text", text: originalText ?? messageText(content) }];
  if (!Array.isArray(content)) return parts;
  for (const part of content) {
    if (part?.type !== "image") continue;
    if (typeof part.url === "string") {
      parts.push({ type: "image", url: part.url, alt: imageAlt(part) });
      continue;
    }
    if (typeof part.data === "string" && typeof part.mimeType === "string") {
      parts.push({
        type: "image",
        url: `data:${part.mimeType};base64,${part.data}`,
        data: part.data,
        mimeType: part.mimeType,
        alt: imageAlt(part),
      });
    }
  }
  return parts;
}

function imageAlt(part: unknown): string | undefined {
  return typeof part === "object" &&
    part !== null &&
    "alt" in part &&
    typeof (part as { alt?: unknown }).alt === "string"
    ? (part as { alt: string }).alt
    : undefined;
}

function toolOutput(message: ToolResultMessage): ToolOutput {
  return normalizeToolOutput({
    content: message.content,
    details: message.details,
    isError: message.isError,
  });
}

function inputFromDetails(details: unknown): unknown {
  if (typeof details !== "object" || details === null) return undefined;
  if ("args" in details) return (details as { args?: unknown }).args;
  return undefined;
}
