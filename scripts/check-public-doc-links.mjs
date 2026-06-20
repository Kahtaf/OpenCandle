#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docsDir = join(root, "website/dist");
const timeoutMs = Number(process.env.OPENCANDLE_LINK_CHECK_TIMEOUT_MS ?? 10_000);
const acceptedStatuses = new Set([401, 403, 429]);
const skippedHosts = new Set(["opencandle.app", "127.0.0.1", "localhost", "::1"]);

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
  return [...content.matchAll(/https?:\/\/[^\s"'<>\\)]+/g)].map((match) =>
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

async function checkUrl(url) {
  const head = await fetchWithTimeout(url, "HEAD");
  if (head.status !== 405 && head.status !== 501) return head.status;
  const get = await fetchWithTimeout(url, "GET");
  return get.status;
}

function isAcceptedStatus(status) {
  return (status >= 200 && status < 400) || acceptedStatuses.has(status);
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
  for (const [url, files] of candidates) {
    try {
      const status = await checkUrl(url);
      if (!isAcceptedStatus(status)) {
        failures.push(`${url} returned HTTP ${status}\n  ${files.join("\n  ")}`);
      }
    } catch (error) {
      failures.push(
        `${url} failed: ${error instanceof Error ? error.message : String(error)}\n  ${files.join("\n  ")}`,
      );
    }
  }

  if (failures.length > 0) {
    console.error(`Public docs link check failed for ${failures.length} URL(s):`);
    console.error(failures.join("\n\n"));
    process.exit(1);
  }

  console.log(`Checked ${candidates.size} public docs external link(s).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
