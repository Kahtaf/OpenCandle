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
  url: string;
  alt?: string;
}

export type MessageContent = MessageTextContent | MessageToolContent | MessageImageContent;

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

export type ChatEvent =
  | { type: "run.started"; runId: string; sessionId: string; seq: number }
  | { type: "thinking.delta"; runId: string; text: string; seq: number }
  | { type: "thinking.completed"; runId: string; text?: string; seq: number }
  | { type: "message.created"; messageId: string; role: ChatRole; seq: number }
  | { type: "message.delta"; messageId: string; text: string; seq: number }
  | { type: "message.completed"; messageId: string; content: MessageContent[]; seq: number }
  | {
      type: "custom.message";
      messageId: string;
      customType: string;
      content: MessageContent[];
      seq: number;
    }
  | {
      type: "tool.started";
      toolCallId: string;
      messageId: string;
      name: string;
      input: unknown;
      seq: number;
    }
  | { type: "tool.delta"; toolCallId: string; chunk: unknown; seq: number }
  | { type: "tool.completed"; toolCallId: string; output: ToolOutput; seq: number }
  | { type: "tool.failed"; toolCallId: string; error: ToolError; seq: number }
  | { type: "run.completed"; runId: string; usage?: Usage; seq: number }
  | { type: "run.failed"; runId: string; error: RunError; seq: number }
  | { type: "session.updated"; sessionId: string; title?: string; updatedAt: string; seq: number };

export interface RenderMessage {
  id: string;
  role: ChatRole;
  status: "streaming" | "completed";
  content: MessageContent[];
  text: string;
  customType?: string;
}

export interface RenderToolCall {
  id: string;
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
  seenSeq: Set<number>;
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
    messages: [],
    messageById: new Map(),
    tools: new Map(),
    runs: new Map(),
    thinking: new Map(),
    gaps: [],
  };
}
