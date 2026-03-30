export interface SessionMetadata {
  id: string;
  startedAt: string;
  endedAt?: string;
  cwd: string;
}

export type LogEventType =
  | "session_start"
  | "user_message"
  | "assistant_message"
  | "tool_call_start"
  | "tool_call_end"
  | "workflow_selected"
  | "slot_resolution"
  | "memory_write"
  | "session_end";

export interface LogEvent {
  type: LogEventType;
  timestamp: string;
  sessionId: string;
  payload: unknown;
}
