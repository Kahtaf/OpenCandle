import { SessionManager } from "@earendil-works/pi-coding-agent";

export function continueOpenCandleSession(cwd: string, sessionDir?: string): SessionManager {
  return SessionManager.continueRecent(cwd, sessionDir);
}
