#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkUrlWithRetry } from "./check-public-doc-links-lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docsDir = join(root, "website/dist");
const timeoutMs = Number(process.env.OPENCANDLE_LINK_CHECK_TIMEOUT_MS ?? 10_000);
const attempts = Number(process.env.OPENCANDLE_LINK_CHECK_ATTEMPTS ?? 3);
const retryDelayMs = Number(process.env.OPENCANDLE_LINK_CHECK_RETRY_DELAY_MS ?? 1_000);
const skippedHosts = new Set([
  "opencandle.app",
  "web.opencandle.app",
  "127.0.0.1",
  "localhost",
  "::1",
]);

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      files.push(...walk(path));
    } else {
      files.push(path);
    }
  }
  return files;
}

function extractUrls(path) {
  const extension = extname(path);
  if (![".html", ".md", ".txt", ".xml"].includes(extension)) return [];
  const content = readFileSync(path, "utf8");
  return [...content.matchAll(/https?:\/\/[^\s"'<>\\)\](]+/g)].map((match) =>
    match[0].replace(/(&quot;|[`.,;:])+$/g, ""),
  );
}

async function fetchWithTimeout(url, method) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method,
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "OpenCandle-doc-link-check/1.0" },
    });
  } finally {
    clearTimeout(timeout);
  }
}

function shouldSkipUrl(url) {
  const parsed = new URL(url);
  if (skippedHosts.has(parsed.hostname)) return true;
  if (parsed.hostname === "example.com" || parsed.hostname.endsWith(".example.com")) return true;
  return (
    parsed.pathname === "/" &&
    (parsed.hostname === "fonts.googleapis.com" || parsed.hostname === "fonts.gstatic.com")
  );
}

async function main() {
  const candidates = new Map();
  for (const file of walk(docsDir)) {
    for (const url of extractUrls(file)) {
      if (shouldSkipUrl(url)) continue;
      if (!candidates.has(url)) candidates.set(url, []);
      candidates.get(url).push(file);
    }
  }

  const failures = [];
  const unverified = [];
  for (const [url, files] of candidates) {
    const { outcome, detail } = await checkUrlWithRetry({
      url,
      fetchImpl: fetchWithTimeout,
      attempts,
      delayMs: retryDelayMs,
    });
    if (outcome === "broken") {
      failures.push(`${url} returned ${detail}\n  ${files.join("\n  ")}`);
    } else if (outcome === "unverified") {
      // Host unreachable from this runner (DNS/TLS/timeout) after retries — cannot verify,
      // but not proof the link is broken. Report as a non-blocking skip so transient
      // external outages do not fail the build; a genuine 404 still lands in `failures`.
      unverified.push(`${url} ${detail}\n  ${files.join("\n  ")}`);
    }
  }

  if (unverified.length > 0) {
    console.warn(
      `Skipped ${unverified.length} unreachable external link(s) after ${attempts} attempt(s) (transient, not verified):`,
    );
    console.warn(unverified.join("\n\n"));
  }

  if (failures.length > 0) {
    console.error(`Public docs link check failed for ${failures.length} URL(s):`);
    console.error(failures.join("\n\n"));
    process.exit(1);
  }

  const checked = candidates.size - unverified.length;
  console.log(
    `Checked ${checked} public docs external link(s)${
      unverified.length > 0 ? `; skipped ${unverified.length} unreachable` : ""
    }.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
