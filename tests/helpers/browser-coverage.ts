import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright-core";

// Browser coverage is an opt-in lane. Unless OPENCANDLE_BROWSER_COVERAGE=1 the
// helper is a no-op, so browser journeys run unchanged without the overhead.
const DEFAULT_RAW_DIR = join("coverage", "browser", "raw");

export function browserCoverageEnabled(): boolean {
  return process.env.OPENCANDLE_BROWSER_COVERAGE === "1";
}

/** Start raw V8 JS coverage. Await before navigating the page. */
export async function startBrowserCoverage(page: Page): Promise<void> {
  if (!browserCoverageEnabled()) {
    return;
  }
  await page.coverage.startJSCoverage({
    resetOnNavigation: false,
    reportAnonymousScripts: false,
  });
}

/**
 * Stop raw coverage and write one unique capture (url/source/functions) under
 * coverage/browser/raw/. Await before closing the page. Returns the raw file
 * path, or null when the lane is disabled.
 */
export async function stopBrowserCoverage(page: Page, label: string): Promise<string | null> {
  if (!browserCoverageEnabled()) {
    return null;
  }
  const entries = await page.coverage.stopJSCoverage();
  const rawDir = process.env.OPENCANDLE_BROWSER_COVERAGE_DIR ?? DEFAULT_RAW_DIR;
  mkdirSync(rawDir, { recursive: true });
  const safeLabel = label.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "page";
  const capturedAt = new Date().toISOString();
  const file = join(
    rawDir,
    `${capturedAt.replace(/[:.]/g, "-")}-${process.pid}-${randomUUID().slice(0, 8)}-${safeLabel}.json`,
  );
  let origin: string | null = null;
  try {
    origin = new URL(page.url()).origin;
  } catch {
    origin = null;
  }
  // Browser provenance for the report; never fail the lane if the page or
  // driver does not expose it.
  let browserVersion: string | null = null;
  try {
    browserVersion = page.context().browser()?.version() ?? null;
  } catch {
    browserVersion = null;
  }
  let userAgent: string | null = null;
  try {
    userAgent = await page.evaluate(() => navigator.userAgent);
  } catch {
    userAgent = null;
  }
  writeFileSync(
    file,
    JSON.stringify({ label, origin, browserVersion, userAgent, capturedAt, entries }, null, 2),
    "utf8",
  );
  return file;
}
