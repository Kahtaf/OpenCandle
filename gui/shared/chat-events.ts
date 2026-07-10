export type ChatRole = "user" | "assistant" | "system";

export interface MessageTextContent {
  type: "text";
  text: string;
}

export interface MessageToolContent {
  type: "tool";
  toolCallId: string;
}

export interface MessageImageContent {
  type: "image";
  url?: string;
  data?: string;
  mimeType?: string;
  alt?: string;
}

export type MessageContent = MessageTextContent | MessageToolContent | MessageImageContent;

export interface MessageAttachmentChip {
  kind: string;
  label: string;
}

export interface ToolOutput {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  details?: unknown;
  isError?: boolean;
  source?: string;
}

export interface ToolError {
  message: string;
  code?: string;
  details?: unknown;
}

export interface RunError {
  message: string;
  code?: string;
  details?: unknown;
}

export interface Usage {
  input?: number;
  output?: number;
  totalTokens?: number;
  cost?: unknown;
}

interface ChatEventBase {
  sessionId: string;
  seq: number;
}

interface RunScopedChatEventBase extends ChatEventBase {
  runId: string;
}

export type ChatEvent =
  | ({ type: "run.started" } & RunScopedChatEventBase)
  | ({ type: "thinking.delta"; text: string } & RunScopedChatEventBase)
  | ({ type: "thinking.completed"; text?: string } & RunScopedChatEventBase)
  | ({ type: "message.created"; messageId: string; role: ChatRole; runId?: string } & ChatEventBase)
  | ({ type: "message.delta"; messageId: string; text: string; runId?: string } & ChatEventBase)
  | ({
      type: "message.completed";
      messageId: string;
      content: MessageContent[];
      attachments?: MessageAttachmentChip[];
      runId?: string;
    } & ChatEventBase)
  | ({
      type: "custom.message";
      messageId: string;
      customType: string;
      content: MessageContent[];
      details?: unknown;
    } & ChatEventBase)
  | ({
      type: "tool.started";
      toolCallId: string;
      messageId: string;
      name: string;
      input: unknown;
      runId?: string;
    } & ChatEventBase)
  | ({ type: "tool.delta"; toolCallId: string; chunk: unknown; runId?: string } & ChatEventBase)
  | ({
      type: "tool.completed";
      toolCallId: string;
      output: ToolOutput;
      runId?: string;
    } & ChatEventBase)
  | ({ type: "tool.failed"; toolCallId: string; error: ToolError; runId?: string } & ChatEventBase)
  | ({ type: "run.completed"; usage?: Usage } & RunScopedChatEventBase)
  | ({ type: "run.failed"; error: RunError } & RunScopedChatEventBase)
  | ({ type: "session.updated"; title?: string; updatedAt: string } & ChatEventBase);

export interface RenderMessage {
  id: string;
  sessionId?: string;
  role: ChatRole;
  status: "streaming" | "completed";
  content: MessageContent[];
  text: string;
  attachments?: MessageAttachmentChip[];
  customType?: string;
  details?: unknown;
}

export interface RenderToolCall {
  id: string;
  sessionId?: string;
  messageId: string;
  name: string;
  input: unknown;
  status: "queued" | "running" | "completed" | "failed";
  chunks: unknown[];
  output?: ToolOutput;
  error?: ToolError;
}

export interface RenderThinking {
  runId: string;
  sessionId?: string;
  status: "streaming" | "completed";
  text: string;
}

export interface ChatRunState {
  id: string;
  sessionId?: string;
  status: "running" | "completed" | "failed";
  usage?: Usage;
  error?: RunError;
}

export interface ChatRenderState {
  lastSeq: number;
  seenSeq: Set<string>;
  lastSeqBySession: Map<string, number>;
  messages: RenderMessage[];
  messageById: Map<string, RenderMessage>;
  tools: Map<string, RenderToolCall>;
  runs: Map<string, ChatRunState>;
  thinking: Map<string, RenderThinking>;
  session?: { id: string; title?: string; updatedAt?: string };
  gaps: Array<{ expected: number; received: number }>;
}

export function createChatRenderState(): ChatRenderState {
  return {
    lastSeq: 0,
    seenSeq: new Set(),
    lastSeqBySession: new Map(),
    messages: [],
    messageById: new Map(),
    tools: new Map(),
    runs: new Map(),
    thinking: new Map(),
    gaps: [],
  };
}
