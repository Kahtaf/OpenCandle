import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { ensureParentDir, resolveOpenCandlePath } from "./opencandle-paths.js";

export const LSE_MONTHLY_BYTE_CAP = 53_687_091_200;
export const LSE_SOFT_BYTE_THRESHOLD = 42_949_672_960;

export interface LseByteBudgetUsage {
  month: string;
  bytesUsed: number;
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function budgetPath(): string {
  return resolveOpenCandlePath("lse-byte-budget.json");
}

function readUsage(): LseByteBudgetUsage {
  const month = currentMonth();
  const path = budgetPath();
  if (!existsSync(path)) return { month, bytesUsed: 0 };

  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<LseByteBudgetUsage>;
    const bytesUsed = parsed.bytesUsed;
    if (parsed.month !== month || typeof bytesUsed !== "number" || !Number.isFinite(bytesUsed)) {
      return { month, bytesUsed: 0 };
    }
    return { month, bytesUsed: bytesUsed < 0 ? 0 : bytesUsed };
  } catch {
    return { month, bytesUsed: 0 };
  }
}

function writeUsage(usage: LseByteBudgetUsage): void {
  const path = budgetPath();
  ensureParentDir(path);
  writeFileSync(path, `${JSON.stringify(usage, null, 2)}\n`, "utf-8");
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
  return readUsage().bytesUsed >= LSE_SOFT_BYTE_THRESHOLD;
}

export function markExhausted(): void {
  writeUsage({ month: currentMonth(), bytesUsed: LSE_MONTHLY_BYTE_CAP });
}
