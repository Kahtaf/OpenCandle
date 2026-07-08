let optimisticUserMessageCounter = 0;

export function createOptimisticUserMessageEvents(prompt, sessionId, options = {}) {
  const text = String(prompt || "").trim();
  if (!text) return [];
  const normalizedSessionId = String(sessionId ?? "").trim();
  const attachments = normalizeOptimisticAttachments(options.attachments);
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
      ...(attachments.length > 0 ? { attachments } : {}),
      seq: -1,
    },
  ];
}

function normalizeOptimisticAttachments(attachments) {
  return Array.from(attachments ?? [])
    .map((attachment) => ({
      kind: String(attachment?.kind || ""),
      label: String(attachment?.label || ""),
    }))
    .filter((attachment) => attachment.kind || attachment.label);
}
