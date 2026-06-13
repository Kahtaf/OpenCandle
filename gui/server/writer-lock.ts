import { mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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

const DEFAULT_STALE_GRACE_MS = 15_000;

export async function acquireWriterLock(
  sessionDir: string,
  processKind: ProcessKind,
  options: AcquireOptions = {},
): Promise<AcquireResult> {
  mkdirSync(sessionDir, { recursive: true });
  const pid = options.pid ?? process.pid;
  const staleGraceMs = options.staleGraceMs ?? DEFAULT_STALE_GRACE_MS;

  const created = tryCreate(sessionDir, processKind, pid);
  if (created) return { role: "writer", lock: created };

  const existing = readWriterLock(sessionDir);
  if (existing && isLockCurrent(existing, staleGraceMs)) {
    return { role: "follower", lock: existing };
  }

  await sleep(staleGraceMs);
  const afterGrace = readWriterLock(sessionDir);
  if (afterGrace && isLockCurrent(afterGrace, staleGraceMs)) {
    return { role: "follower", lock: afterGrace };
  }

  try {
    unlinkSync(lockPath(sessionDir));
  } catch {
    // Missing or concurrently removed is fine; the next create decides ownership.
  }

  const recovered = tryCreate(sessionDir, processKind, pid);
  if (recovered) return { role: "writer", lock: recovered };

  const current = readWriterLock(sessionDir) ?? afterGrace ?? existing;
  if (!current) throw new Error("Unable to determine active writer lock");
  return { role: "follower", lock: current };
}

export function readWriterLock(sessionDir: string): WriterLock | null {
  try {
    return JSON.parse(readFileSync(lockPath(sessionDir), "utf8")) as WriterLock;
  } catch {
    return null;
  }
}

export function refreshWriterLock(sessionDir: string, pid = process.pid): void {
  const lock = readWriterLock(sessionDir);
  if (!lock || lock.pid !== pid) return;
  writeFileSync(
    lockPath(sessionDir),
    JSON.stringify({ ...lock, lastHeartbeat: new Date().toISOString() }, null, 2),
  );
}

export function releaseWriterLock(sessionDir: string, pid = process.pid): void {
  const lock = readWriterLock(sessionDir);
  if (!lock || lock.pid !== pid) return;
  try {
    unlinkSync(lockPath(sessionDir));
  } catch {
    // Best effort shutdown cleanup.
  }
}

function tryCreate(sessionDir: string, processKind: ProcessKind, pid: number): WriterLock | null {
  const now = new Date().toISOString();
  const lock: WriterLock = { pid, processKind, acquiredAt: now, lastHeartbeat: now };
  try {
    const fd = openSync(lockPath(sessionDir), "wx");
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

function lockPath(sessionDir: string): string {
  return join(sessionDir, "writer.lock");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
