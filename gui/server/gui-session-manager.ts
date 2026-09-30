import { existsSync } from "node:fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";

export function createInitialGuiSessionManager(cwd: string, sessionDir?: string): SessionManager {
  return SessionManager.create(cwd, sessionDir);
}

/**
 * Fresh sessions created while the server's current session is still running.
 *
 * Starting a new chat normally replaces the Pi runtime's current session, which
 * tears down the current AgentSession. That is not possible while a run is in
 * flight there, so a new chat started meanwhile gets its own session instead:
 * it stays in memory here (Pi writes the file only once the first reply lands)
 * and its runs go through the same dedicated-session path as any reopened,
 * non-current session. Once the session is on disk the saved-session list owns
 * resolution again.
 */
export interface DetachedSessionRegistry {
  create(cwd: string, sessionDir: string): SessionManager;
  get(sessionId: string): SessionManager | undefined;
}

const DEFAULT_DETACHED_SESSION_LIMIT = 32;

export function createDetachedSessionRegistry(
  options: { limit?: number } = {},
): DetachedSessionRegistry {
  const limit = Math.max(1, options.limit ?? DEFAULT_DETACHED_SESSION_LIMIT);
  const sessions = new Map<string, SessionManager>();

  return {
    create(cwd, sessionDir) {
      const manager = SessionManager.create(cwd, sessionDir);
      sessions.set(manager.getSessionId(), manager);
      while (sessions.size > limit) {
        const oldest = sessions.keys().next().value;
        if (oldest === undefined) break;
        sessions.delete(oldest);
      }
      return manager;
    },
    get(sessionId) {
      const manager = sessions.get(sessionId);
      if (!manager) return undefined;
      const sessionFile = manager.getSessionFile();
      if (sessionFile && existsSync(sessionFile)) {
        sessions.delete(sessionId);
        return undefined;
      }
      return manager;
    },
  };
}
