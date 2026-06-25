import { mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type ProcessKind = "tui" | "gui";

export interface WriterLock {
  pid: number;
  processKind: ProcessKind;
  acquiredAt: string;
  lastHeartbeat: string;
}

export interface AcquireOptions {
  pid?: number;
  staleGraceMs?: number;
}

export type AcquireResult =
  | { role: "writer"; lock: WriterLock }
  | { role: "follower"; lock: WriterLock };

export interface SessionLockScopeSource {
  getSessionFile(): string | undefined;
  getSessionDir(): string;
}

const DEFAULT_STALE_GRACE_MS = 15_000;

export async function acquireWriterLock(
  scopePath: string,
  processKind: ProcessKind,
  options: AcquireOptions = {},
): Promise<AcquireResult> {
  mkdirSync(dirname(lockPath(scopePath)), { recursive: true });
  const pid = options.pid ?? process.pid;
  const staleGraceMs = options.staleGraceMs ?? DEFAULT_STALE_GRACE_MS;

  const created = tryCreate(scopePath, processKind, pid);
  if (created) return { role: "writer", lock: created };

  const existing = readWriterLock(scopePath);
  if (existing && isLockCurrent(existing, staleGraceMs)) {
    return { role: "follower", lock: existing };
  }

  await sleep(staleGraceMs);
  const afterGrace = readWriterLock(scopePath);
  if (afterGrace && isLockCurrent(afterGrace, staleGraceMs)) {
    return { role: "follower", lock: afterGrace };
  }

  try {
    unlinkSync(lockPath(scopePath));
  } catch {
    // Missing or concurrently removed is fine; the next create decides ownership.
  }

  const recovered = tryCreate(scopePath, processKind, pid);
  if (recovered) return { role: "writer", lock: recovered };

  const current = readWriterLock(scopePath) ?? afterGrace ?? existing;
  if (!current) throw new Error("Unable to determine active writer lock");
  return { role: "follower", lock: current };
}

export function readWriterLock(scopePath: string): WriterLock | null {
  try {
    return JSON.parse(readFileSync(lockPath(scopePath), "utf8")) as WriterLock;
  } catch {
    return null;
  }
}

export function refreshWriterLock(scopePath: string, pid = process.pid): void {
  const lock = readWriterLock(scopePath);
  if (!lock || lock.pid !== pid) return;
  writeFileSync(
    lockPath(scopePath),
    JSON.stringify({ ...lock, lastHeartbeat: new Date().toISOString() }, null, 2),
  );
}

export function releaseWriterLock(scopePath: string, pid = process.pid): void {
  const lock = readWriterLock(scopePath);
  if (!lock || lock.pid !== pid) return;
  try {
    unlinkSync(lockPath(scopePath));
  } catch {
    // Best effort shutdown cleanup.
  }
}

export const acquireSessionWriterLock = acquireWriterLock;
export const refreshSessionWriterLock = refreshWriterLock;
export const releaseSessionWriterLock = releaseWriterLock;

export function writerLockScopeForSession(sessionManager: SessionLockScopeSource): string {
  return sessionManager.getSessionFile() ?? sessionManager.getSessionDir();
}

function tryCreate(scopePath: string, processKind: ProcessKind, pid: number): WriterLock | null {
  const now = new Date().toISOString();
  const lock: WriterLock = { pid, processKind, acquiredAt: now, lastHeartbeat: now };
  try {
    const fd = openSync(lockPath(scopePath), "wx");
    writeFileSync(fd, JSON.stringify(lock, null, 2));
    return lock;
  } catch {
    return null;
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isLockCurrent(lock: WriterLock, staleGraceMs: number): boolean {
  const heartbeat = Date.parse(lock.lastHeartbeat);
  return (
    isPidAlive(lock.pid) && Number.isFinite(heartbeat) && Date.now() - heartbeat <= staleGraceMs
  );
}

function lockPath(scopePath: string): string {
  return isFileScope(scopePath) ? `${scopePath}.writer.lock` : join(scopePath, "writer.lock");
}

function isFileScope(scopePath: string): boolean {
  try {
    return statSync(scopePath).isFile();
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
