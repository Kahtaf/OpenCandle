let optimisticUserMessageCounter = 0;

export function createOptimisticUserMessageEvents(prompt, sessionId) {
  const text = String(prompt || "").trim();
  if (!text) return [];
  const normalizedSessionId = String(sessionId ?? "").trim();
  const messageId = `optimistic-user-${Date.now()}-${++optimisticUserMessageCounter}`;
  return [
    {
      type: "message.created",
      messageId,
      role: "user",
      sessionId: normalizedSessionId,
      seq: -2,
    },
    {
      type: "message.completed",
      messageId,
      sessionId: normalizedSessionId,
      content: [{ type: "text", text }],
      seq: -1,
    },
  ];
}
