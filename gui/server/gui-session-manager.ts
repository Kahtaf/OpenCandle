import { SessionManager } from "@earendil-works/pi-coding-agent";

export function createInitialGuiSessionManager(cwd: string, sessionDir?: string): SessionManager {
  return SessionManager.create(cwd, sessionDir);
}
