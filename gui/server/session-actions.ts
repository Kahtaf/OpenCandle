import { unlink } from "node:fs/promises";
import { SessionManager } from "@earendil-works/pi-coding-agent";

export async function renameSessionFile(
  cwd: string,
  sessionDir: string,
  sessionPath: string,
  nextName: string,
): Promise<void> {
  const target = await resolveListedSession(cwd, sessionDir, sessionPath);
  const name = nextName.trim();
  if (!name) throw new Error("Session name cannot be empty");
  const manager = SessionManager.open(target.path);
  manager.appendSessionInfo(name);
}

export async function deleteSessionFile(
  cwd: string,
  sessionDir: string,
  sessionPath: string,
): Promise<void> {
  const target = await resolveListedSession(cwd, sessionDir, sessionPath);
  await unlink(target.path);
}

async function resolveListedSession(cwd: string, sessionDir: string, sessionPath: string) {
  const sessions = await SessionManager.list(cwd, sessionDir);
  const target = sessions.find((session) => session.path === sessionPath);
  if (!target) throw new Error("Unknown saved session");
  return target;
}
