/**
 * Shared stealth browser infrastructure using Camoufox (anti-detection Firefox).
 * Provides a singleton browser instance that any tool can use for scraping.
 *
 * Usage:
 *   import { StealthBrowser } from "../infra/browser.js";
 *   const data = await StealthBrowser.fetchJson<MyType>(url);
 *   const result = await StealthBrowser.evaluate(url, () => document.title);
 */
import { Camoufox } from "camoufox-js";
import type { Browser, Page } from "playwright-core";

let browser: Browser | null = null;
let page: Page | null = null;
let launching: Promise<void> | null = null;

async function ensureBrowser(): Promise<Page> {
  if (page && browser?.isConnected()) return page;

  // Prevent concurrent launches
  if (launching) {
    await launching;
    if (page && browser?.isConnected()) return page;
  }

  launching = (async () => {
    const b = await Camoufox({ headless: true });
    browser = b;
    page = await b.newPage();
  })();

  await launching;
  launching = null;
  return page!;
}

export const StealthBrowser = {
  /**
   * Navigate to a URL, run a JS function in the page context, and return the result.
   */
  async evaluate<T>(url: string, fn: () => T | Promise<T>): Promise<T> {
    const p = await ensureBrowser();
    await p.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    return p.evaluate(fn);
  },

  /**
   * Fetch JSON from a URL using the browser's session (cookies, TLS fingerprint).
   * Useful for APIs that block Node.js fetch but allow real browsers.
   */
  async fetchJson<T>(url: string, options?: { cookies?: string }): Promise<T> {
    const p = await ensureBrowser();

    const result = await p.evaluate(async (fetchUrl: string) => {
      const res = await fetch(fetchUrl, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    }, url);

    return result as T;
  },

  /**
   * Run a custom async function in the browser page context.
   * The page must already be on a relevant domain for cookies to work.
   */
  async run<T>(fn: (page: Page) => Promise<T>): Promise<T> {
    const p = await ensureBrowser();
    return fn(p);
  },

  /**
   * Navigate to a URL and establish session cookies for that domain.
   */
  async initSession(url: string): Promise<void> {
    const p = await ensureBrowser();
    await p.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
  },

  /**
   * Close the browser. It will be re-launched on next use.
   */
  async close(): Promise<void> {
    if (browser) {
      await browser.close().catch(() => {});
      browser = null;
      page = null;
    }
  },
};

// Clean up on process exit
process.on("exit", () => {
  browser?.close().catch(() => {});
});
