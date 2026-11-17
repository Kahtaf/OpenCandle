import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { getConfig } from "../config.js";
import { ensureParentDir, resolveOpenCandlePath } from "./opencandle-paths.js";

export const LSE_WEEKLY_BYTE_CAP = 13_421_772_800;
export const LSE_SOFT_BYTE_THRESHOLD = 10_737_418_240;

export interface LseByteBudgetUsage {
  weekStart: string;
  bytesUsed: number;
  allowanceBytes: number; // -1 means unlimited on paid plans
  blockedUntil?: number;
  blockReason?: string;
}

export function lseCredentialId(): string {
  return createHash("sha256")
    .update(getConfig().lseApiKey ?? "")
    .digest("hex")
    .slice(0, 16);
}

function currentWeek(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

function budgetPath(): string {
  // The obsolete monthly meter is deliberately not read or migrated.
  return resolveOpenCandlePath("lse-v3-usage.json");
}

function readUsage(): LseByteBudgetUsage {
  const weekStart = currentWeek();
  const empty = { weekStart, bytesUsed: 0, allowanceBytes: LSE_WEEKLY_BYTE_CAP };
  if (!existsSync(budgetPath())) return empty;
  try {
    const parsed = JSON.parse(
      readFileSync(budgetPath(), "utf-8"),
    ) as Partial<LseByteBudgetUsage> & { credentialId?: string };
    if (
      parsed.weekStart !== weekStart ||
      parsed.credentialId !== lseCredentialId() ||
      typeof parsed.bytesUsed !== "number" ||
      !Number.isFinite(parsed.bytesUsed) ||
      typeof parsed.allowanceBytes !== "number" ||
      !Number.isFinite(parsed.allowanceBytes) ||
      parsed.allowanceBytes < -1
    )
      return empty;
    const blockedUntil =
      typeof parsed.blockedUntil === "number" &&
      Number.isFinite(parsed.blockedUntil) &&
      parsed.blockedUntil > 0
        ? parsed.blockedUntil
        : undefined;
    return {
      weekStart,
      bytesUsed: Math.max(0, parsed.bytesUsed),
      allowanceBytes: parsed.allowanceBytes,
      ...(blockedUntil ? { blockedUntil, blockReason: parsed.blockReason } : {}),
    };
  } catch {
    return empty;
  }
}

function writeUsage(usage: LseByteBudgetUsage): void {
  ensureParentDir(budgetPath());
  writeFileSync(
    budgetPath(),
    `${JSON.stringify({ ...usage, credentialId: lseCredentialId() }, null, 2)}\n`,
    "utf-8",
  );
}

export function recordBytes(n: number): void {
  if (!Number.isFinite(n) || n < 0) return;
  const usage = readUsage();
  writeUsage({ ...usage, bytesUsed: usage.bytesUsed + n });
}

export function getUsage(): LseByteBudgetUsage {
  return readUsage();
}

export function isOverSoftThreshold(): boolean {
  const usage = readUsage();
  // An expired refusal must permit a fresh server usage probe, even if the
  // previous snapshot was over the soft threshold.
  if (usage.blockedUntil !== undefined) return usage.blockedUntil > Date.now();
  return usage.allowanceBytes >= 0 && usage.bytesUsed >= usage.allowanceBytes * 0.8;
}

export function markExhausted(reason = "allowance-exhausted", retryAfterSeconds?: number): void {
  const usage = readUsage();
  const reset = new Date();
  reset.setUTCHours(24, 0, 0, 0);
  if (reason === "allowance-exhausted") {
    reset.setUTCDate(reset.getUTCDate() + ((8 - reset.getUTCDay()) % 7));
  }
  const blockedUntil =
    retryAfterSeconds !== undefined && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? Date.now() + retryAfterSeconds * 1_000
      : reset.getTime();
  writeUsage({
    ...usage,
    blockedUntil,
    blockReason: reason,
  });
}

export function syncLseUsage(
  weekly: { allowance_bytes: number; used_bytes: number },
  rows: { per_day: number; used_today: number; resets_in_seconds: number },
): void {
  const usage = readUsage();
  writeUsage({
    weekStart: usage.weekStart,
    bytesUsed: weekly.used_bytes,
    allowanceBytes: weekly.allowance_bytes,
  });
  if (rows.per_day >= 0 && rows.used_today >= rows.per_day)
    markExhausted("rows-exhausted", rows.resets_in_seconds);
}
