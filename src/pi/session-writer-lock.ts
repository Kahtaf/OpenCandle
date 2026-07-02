import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export type ProcessKind = "tui" | "gui";

export interface WriterLock {
  pid: number;
  processKind: ProcessKind;
  acquiredAt: string;
  lastHeartbeat: string;
  protocolVersion?: number;
  scope?: string;
  ownerId?: string;
  coordinatorEndpoint?: string;
  coordinatorSecret?: string;
  recoveryState?: "ambiguous" | "live";
}

export interface AcquireOptions {
  pid?: number;
  ownerId?: string;
  coordinatorEndpoint?: string;
  coordinatorSecret?: string;
  staleGraceMs?: number;
  now?: () => Date;
  isPidAlive?: (pid: number) => boolean;
}

export type AcquireResult =
  | { role: "writer"; lock: WriterLock }
  | { role: "follower"; lock: WriterLock };

export interface SessionLockScopeSource {
  getSessionFile(): string | undefined;
  getSessionDir(): string;
}

const DEFAULT_STALE_GRACE_MS = 15_000;
const WRITER_LOCK_PROTOCOL_VERSION = 1;
const PROCESS_STARTED_AT = new Date(Date.now() - process.uptime() * 1000).toISOString();

export async function acquireWriterLock(
  scopePath: string,
  processKind: ProcessKind,
  options: AcquireOptions = {},
): Promise<AcquireResult> {
  mkdirSync(dirname(lockPath(scopePath)), { recursive: true });
  const identity = lockIdentity(options);
  const staleGraceMs = options.staleGraceMs ?? DEFAULT_STALE_GRACE_MS;
  const pidAlive = options.isPidAlive ?? isPidAlive;
  const now = options.now ?? (() => new Date());

  const created = tryCreate(scopePath, processKind, identity, now);
  if (created) return { role: "writer", lock: created };

  const existing = readWriterLock(scopePath);
  if (existing) {
    const status = classifyLock(existing, staleGraceMs, pidAlive);
    if (status !== "recoverable")
      return { role: "follower", lock: withRecoveryState(existing, status) };
  }

  await sleep(staleGraceMs);
  const afterGrace = readWriterLock(scopePath);
  if (afterGrace) {
    const status = classifyLock(afterGrace, staleGraceMs, pidAlive);
    if (status !== "recoverable") {
      return { role: "follower", lock: withRecoveryState(afterGrace, status) };
    }
  }

  try {
    unlinkSync(lockPath(scopePath));
  } catch {
    // Missing or concurrently removed is fine; the next create decides ownership.
  }

  const recovered = tryCreate(scopePath, processKind, identity, now);
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

export function refreshWriterLock(
  scopePath: string,
  holder: number | { pid?: number; ownerId?: string; now?: () => Date } = process.pid,
): void {
  const identity =
    typeof holder === "number"
      ? { pid: holder, ownerId: holder === process.pid ? defaultOwnerId(holder) : undefined }
      : { pid: holder.pid ?? process.pid, ownerId: holder.ownerId, now: holder.now };
  const lock = readWriterLock(scopePath);
  if (!lock || !isSameLockOwner(lock, identity)) return;
  writeFileSync(
    lockPath(scopePath),
    JSON.stringify(
      { ...lock, lastHeartbeat: (identity.now?.() ?? new Date()).toISOString() },
      null,
      2,
    ),
  );
}

export function releaseWriterLock(
  scopePath: string,
  holder: number | { pid?: number; ownerId?: string } = process.pid,
): void {
  const identity =
    typeof holder === "number"
      ? { pid: holder, ownerId: holder === process.pid ? defaultOwnerId(holder) : undefined }
      : { pid: holder.pid ?? process.pid, ownerId: holder.ownerId };
  const lock = readWriterLock(scopePath);
  if (!lock || !isSameLockOwner(lock, identity)) return;
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

export function migrateWriterLockScope(
  fromScopePath: string,
  toScopePath: string,
  holder: { pid?: number; ownerId?: string } = {},
): boolean {
  if (fromScopePath === toScopePath) return true;
  const identity = { pid: holder.pid ?? process.pid, ownerId: holder.ownerId };
  const lock = readWriterLock(fromScopePath);
  if (!lock || !isSameLockOwner(lock, identity)) return false;

  mkdirSync(dirname(lockPath(toScopePath)), { recursive: true });
  const nextLock = { ...lock, scope: toScopePath };
  let fd: number | undefined;
  try {
    fd = openSync(lockPath(toScopePath), "wx", 0o600);
    writeFileSync(fd, JSON.stringify(nextLock, null, 2));
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }

  try {
    unlinkSync(lockPath(fromScopePath));
  } catch {
    // Best effort; destination lock is now authoritative for the canonical scope.
  }
  return true;
}

function tryCreate(
  scopePath: string,
  processKind: ProcessKind,
  identity: {
    pid: number;
    ownerId?: string;
    coordinatorEndpoint?: string;
    coordinatorSecret?: string;
  },
  nowFn: () => Date,
): WriterLock | null {
  const now = nowFn().toISOString();
  const lock: WriterLock = {
    pid: identity.pid,
    processKind,
    acquiredAt: now,
    lastHeartbeat: now,
    protocolVersion: WRITER_LOCK_PROTOCOL_VERSION,
    scope: scopePath,
    ...(identity.ownerId ? { ownerId: identity.ownerId } : {}),
    ...(identity.coordinatorEndpoint ? { coordinatorEndpoint: identity.coordinatorEndpoint } : {}),
    ...(identity.coordinatorSecret ? { coordinatorSecret: identity.coordinatorSecret } : {}),
  };
  try {
    const fd = openSync(lockPath(scopePath), "wx", 0o600);
    try {
      writeFileSync(fd, JSON.stringify(lock, null, 2));
    } finally {
      closeSync(fd);
    }
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

function classifyLock(
  lock: WriterLock,
  staleGraceMs: number,
  pidAlive: (pid: number) => boolean,
): "current" | "ambiguous" | "recoverable" {
  const heartbeat = Date.parse(lock.lastHeartbeat);
  const hasFreshHeartbeat = Number.isFinite(heartbeat) && Date.now() - heartbeat <= staleGraceMs;
  if (!pidAlive(lock.pid)) return "recoverable";
  if (hasFreshHeartbeat) return "current";
  return lock.ownerId ? "current" : "ambiguous";
}

function withRecoveryState(lock: WriterLock, status: "current" | "ambiguous"): WriterLock {
  if (status === "current") return { ...lock, recoveryState: "live" };
  return { ...lock, recoveryState: "ambiguous" };
}

function isSameLockOwner(lock: WriterLock, identity: { pid: number; ownerId?: string }): boolean {
  if (lock.pid !== identity.pid) return false;
  if (lock.ownerId) return lock.ownerId === identity.ownerId;
  return !identity.ownerId;
}

function lockIdentity(options: AcquireOptions): {
  pid: number;
  ownerId?: string;
  coordinatorEndpoint?: string;
  coordinatorSecret?: string;
} {
  const pid = options.pid ?? process.pid;
  const ownerId =
    options.ownerId === undefined && pid === process.pid ? defaultOwnerId(pid) : options.ownerId;
  return {
    pid,
    ...(ownerId ? { ownerId } : {}),
    ...(options.coordinatorEndpoint ? { coordinatorEndpoint: options.coordinatorEndpoint } : {}),
    ...(options.coordinatorSecret ? { coordinatorSecret: options.coordinatorSecret } : {}),
  };
}

function defaultOwnerId(pid: number): string {
  return `${pid}:${process.ppid}:${PROCESS_STARTED_AT}`;
}

function lockPath(scopePath: string): string {
  return isFileScope(scopePath) ? `${scopePath}.writer.lock` : join(scopePath, "writer.lock");
}

function isFileScope(scopePath: string): boolean {
  if (scopePath.endsWith(".jsonl")) return true;
  try {
    return statSync(scopePath).isFile();
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
