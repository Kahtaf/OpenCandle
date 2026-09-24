import { existsSync } from "node:fs";
import { type Browser, chromium, type Page } from "playwright-core";

/**
 * Browser-side transport boundary for the deterministic GUI journey.
 *
 * Only the local GUI origin is allowed to reach the network stack. Google
 * Fonts and favicon requests are fulfilled from local fixtures; anything else
 * is aborted and recorded so an unexpected browser request fails the journey.
 */

export interface BrowserRequestGuard {
  unexpected: string[];
  install(page: Page): Promise<void>;
}

export function createBrowserRequestGuard(guiBaseUrl: string): BrowserRequestGuard {
  const unexpected: string[] = [];
  return {
    unexpected,
    async install(page: Page) {
      await page.route("**/*", async (route) => {
        const url = route.request().url();
        if (
          url.startsWith(guiBaseUrl) ||
          url.startsWith("data:") ||
          url.startsWith("blob:") ||
          url.startsWith("about:")
        ) {
          await route.continue();
          return;
        }
        if (url.startsWith("https://fonts.googleapis.com/")) {
          await route.fulfill({
            status: 200,
            contentType: "text/css; charset=utf-8",
            body: '/* fixture fonts */\n@font-face{font-family:"Inter";src:local("Arial");}',
          });
          return;
        }
        if (url.startsWith("https://fonts.gstatic.com/")) {
          await route.fulfill({ status: 200, contentType: "font/woff2", body: "" });
          return;
        }
        if (url.startsWith("https://www.google.com/s2/favicons")) {
          await route.fulfill({
            status: 200,
            contentType: "image/gif",
            body: Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64"),
          });
          return;
        }
        unexpected.push(url);
        await route.abort();
      });
    },
  };
}

export function resolveChromiumExecutable(): string {
  const configured = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (configured) return configured;
  const bundled = chromium.executablePath();
  if (existsSync(bundled)) return bundled;
  const macChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (existsSync(macChrome)) return macChrome;
  return bundled;
}

export async function launchJourneyBrowser(): Promise<Browser> {
  return chromium.launch({ executablePath: resolveChromiumExecutable(), headless: true });
}
