let optimisticUserMessageCounter = 0;

export function createOptimisticUserMessageEvents(prompt) {
  const text = String(prompt || "").trim();
  if (!text) return [];
  const messageId = `optimistic-user-${Date.now()}-${++optimisticUserMessageCounter}`;
  return [
    { type: "message.created", messageId, role: "user", seq: -2 },
    { type: "message.completed", messageId, content: [{ type: "text", text }], seq: -1 },
  ];
}
