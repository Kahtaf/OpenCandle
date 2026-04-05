/**
 * Twitter scraping POC — hybrid approach:
 * 1. Camoufox for login (persistent Firefox profile with cookies)
 * 2. @the-convocation/twitter-scraper for search (handles x-client-transaction-id)
 *
 * Usage: npx tsx scripts/twitter-poc.ts [query]
 */
import { Camoufox } from "camoufox-js";
import { Scraper, SearchMode } from "@the-convocation/twitter-scraper";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { BrowserContext } from "playwright-core";

const PROFILE_DIR = join(homedir(), ".opencandle", "browser-profile");
const query = process.argv[2] || "$AAPL";

// ──────────────────────────────────────────────────────────
// Step 1: Get Twitter cookies (from Camoufox profile or login)
// ──────────────────────────────────────────────────────────

/** Read cookies from Firefox profile's cookies.sqlite */
function readFirefoxCookies(
  profileDir: string,
  domain: string,
): Array<{ name: string; value: string; domain: string; path: string }> {
  const dbPath = join(profileDir, "cookies.sqlite");
  if (!existsSync(dbPath)) return [];

  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db
      .prepare(
        `SELECT name, value, host as domain, path FROM moz_cookies WHERE host LIKE ?`,
      )
      .all(`%${domain}%`) as Array<{
      name: string;
      value: string;
      domain: string;
      path: string;
    }>;
    return rows;
  } finally {
    db.close();
  }
}

/** Check if we have auth cookies in the Firefox profile */
function hasAuthCookiesInProfile(profileDir: string): boolean {
  const cookies = readFirefoxCookies(profileDir, "x.com").concat(
    readFirefoxCookies(profileDir, "twitter.com"),
  );
  const authNames = ["auth_token", "ct0", "twid"];
  const found = cookies.filter((c) => authNames.includes(c.name));
  return found.length >= 2;
}

/** Launch Camoufox for interactive login */
async function loginWithCamoufox(): Promise<void> {
  console.log("🚀 Launching Camoufox for Twitter login...\n");
  mkdirSync(PROFILE_DIR, { recursive: true });

  const context = (await Camoufox({
    headless: false,
    user_data_dir: PROFILE_DIR,
    geoip: true,
    humanize: true,
    os: "macos",
    block_webrtc: true,
    window: [1440, 900],
  })) as unknown as BrowserContext;

  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();

  await page.goto("https://x.com/login", {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });

  console.log("🔑 Log in via the browser window.");
  console.log("   Waiting for auth cookies...\n");

  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    const cookies = await context.cookies("https://x.com");
    const authNames = ["auth_token", "ct0", "twid"];
    const found = cookies.filter((c) => authNames.includes(c.name));
    if (found.length >= 2) {
      await page.waitForTimeout(3000); // let page settle
      console.log(
        `✅ Login successful! (${found.map((c) => c.name).join(", ")})\n`,
      );
      await context.close();
      return;
    }
    await page.waitForTimeout(2000);
  }

  await context.close();
  throw new Error("Login timed out after 5 minutes");
}

// ──────────────────────────────────────────────────────────
// Step 2: Search using twitter-scraper with cookies
// ──────────────────────────────────────────────────────────

async function searchWithScraper(
  searchQuery: string,
  limit: number,
): Promise<void> {
  const scraper = new Scraper();

  // Extract cookies from Firefox profile
  const xCookies = readFirefoxCookies(PROFILE_DIR, "x.com");
  const twCookies = readFirefoxCookies(PROFILE_DIR, "twitter.com");
  const allCookies = [...xCookies, ...twCookies];

  console.log(`📦 Found ${allCookies.length} cookies from Firefox profile`);

  // Auth cookies we need
  const authToken = allCookies.find((c) => c.name === "auth_token");
  const ct0 = allCookies.find((c) => c.name === "ct0");
  const twid = allCookies.find((c) => c.name === "twid");

  if (!authToken || !ct0) {
    throw new Error("Missing auth_token or ct0 cookie. Need to login first.");
  }

  console.log(`   auth_token: ${authToken.value.slice(0, 10)}...`);
  console.log(`   ct0: ${ct0.value.slice(0, 10)}...`);
  console.log(`   twid: ${twid?.value ?? "(not found)"}\n`);

  // Set cookies on the scraper
  const cookieStrings = allCookies.map(
    (c) =>
      `${c.name}=${c.value}; Domain=${c.domain}; Path=${c.path}`,
  );
  await scraper.setCookies(cookieStrings);

  const loggedIn = await scraper.isLoggedIn();
  console.log(`🔐 Scraper logged in: ${loggedIn}\n`);

  if (!loggedIn) {
    throw new Error(
      "Scraper could not authenticate with the provided cookies.",
    );
  }

  // Search
  console.log(`🔍 Searching: "${searchQuery}" (limit: ${limit})\n`);

  const tweets: Array<Record<string, unknown>> = [];
  try {
    const results = scraper.searchTweets(searchQuery, limit, SearchMode.Latest);

    for await (const tweet of results) {
      tweets.push({
        text: tweet.text?.slice(0, 280) ?? "",
        author: tweet.username ?? "unknown",
        likes: tweet.likes ?? 0,
        retweets: tweet.retweets ?? 0,
        replies: tweet.replies ?? 0,
        views: tweet.views ?? null,
        created: tweet.timeParsed?.toISOString() ?? null,
        url: tweet.permanentUrl ?? null,
      });

      if (tweets.length >= limit) break;
    }
  } catch (err) {
    console.error(`   Search error: ${err}`);
    console.log("   Attempting with experimental transaction ID...\n");

    // Try with experimental features
    const scraper2 = new Scraper({
      experimental: {
        xClientTransactionId: true,
      },
    });
    await scraper2.setCookies(cookieStrings);

    const results2 = scraper2.searchTweets(
      searchQuery,
      limit,
      SearchMode.Latest,
    );
    for await (const tweet of results2) {
      tweets.push({
        text: tweet.text?.slice(0, 280) ?? "",
        author: tweet.username ?? "unknown",
        likes: tweet.likes ?? 0,
        retweets: tweet.retweets ?? 0,
        replies: tweet.replies ?? 0,
        views: tweet.views ?? null,
        created: tweet.timeParsed?.toISOString() ?? null,
        url: tweet.permanentUrl ?? null,
      });
      if (tweets.length >= limit) break;
    }
  }

  // Output
  console.log(`\n✅ Found ${tweets.length} tweets:\n`);
  console.log("─".repeat(60));

  for (const t of tweets.slice(0, 15)) {
    console.log(`@${t.author}: ${(t.text as string).slice(0, 140)}`);
    console.log(
      `  ❤️ ${t.likes}  🔁 ${t.retweets}  💬 ${t.replies}  👁 ${t.views ?? "?"}  🕐 ${t.created ?? "?"}`,
    );
    console.log(`  ${t.url ?? ""}`);
    console.log("");
  }

  if (tweets.length > 15) {
    console.log(`... and ${tweets.length - 15} more tweets`);
  }

  console.log("─".repeat(60));
}

// ──────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────

async function main() {
  console.log(`\n📋 Twitter Sentiment POC — query: "${query}"\n`);

  // Step 1: Ensure we have a logged-in session
  if (!hasAuthCookiesInProfile(PROFILE_DIR)) {
    console.log("📂 No auth cookies found. Launching Camoufox for login...\n");
    await loginWithCamoufox();
  } else {
    console.log("📂 Auth cookies found in Firefox profile. Skipping login.\n");
  }

  // Step 2: Search using the scraper library
  await searchWithScraper(query, 20);

  console.log("\n✅ POC complete!\n");
}

main().catch((err) => {
  console.error("\n❌ Fatal error:", err);
  process.exit(1);
});
