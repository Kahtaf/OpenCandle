import { randomUUID } from "node:crypto";
import type { SessionMetadata } from "./types.js";

export function createSession(): SessionMetadata {
  return {
    id: randomUUID(),
    startedAt: new Date().toISOString(),
    cwd: process.cwd(),
  };
}

export function endSession(session: SessionMetadata): SessionMetadata {
  return {
    ...session,
    endedAt: new Date().toISOString(),
  };
}
