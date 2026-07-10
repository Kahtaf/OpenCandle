import { type SessionInfo, SessionManager } from "@earendil-works/pi-coding-agent";

// Pi counts every `type: "message"` entry in messageCount (including tool-result
// messages), and falls back to the literal "(no messages)" firstMessage when a
// session has no user text. A session is worth listing only when the user named
// it or it carries actual conversation text.
const NO_MESSAGES_SENTINEL = "(no messages)";

export async function listDisplaySessions(cwd: string, sessionDir: string): Promise<SessionInfo[]> {
  const sessions = await SessionManager.list(cwd, sessionDir);
  return sessions.filter(
    (session) =>
      Boolean(session.name?.trim()) ||
      (session.messageCount > 0 && session.firstMessage !== NO_MESSAGES_SENTINEL),
  );
}
