export interface ChatRunSessionConflict {
  error: string;
  code: "session_changed";
}

export function chatRunSessionConflict(
  expectedSessionId: unknown,
  activeSessionId: string,
): ChatRunSessionConflict | null {
  const expected = typeof expectedSessionId === "string" ? expectedSessionId.trim() : "";
  if (!expected || expected === activeSessionId) return null;
  return {
    error: "The active session changed before this message was sent.",
    code: "session_changed",
  };
}
