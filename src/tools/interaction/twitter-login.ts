import { mkdirSync } from "node:fs";
import type { BrowserContext } from "playwright-core";
import { Type } from "@sinclair/typebox";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

interface TwitterLoginResult {
  success: boolean;
  message: string;
}

export async function runTwitterLogin(notify: (msg: string) => void): Promise<TwitterLoginResult> {
  const { getBrowserProfileDir } = await import("../../infra/opencandle-paths.js");
  const { Camoufox } = await import("camoufox-js");

  const profileDir = getBrowserProfileDir();
  mkdirSync(profileDir, { recursive: true });

  notify("Launching browser for Twitter login...");

  const context = (await Camoufox({
    headless: false,
    user_data_dir: profileDir,
    geoip: true,
    humanize: true,
    os: "macos",
    block_webrtc: true,
    window: [1440, 900],
  })) as unknown as BrowserContext;

  try {
    const pages = context.pages();
    const page = pages.length > 0 ? pages[0] : await context.newPage();

    await page.goto("https://x.com/login", {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    notify("Log in via the browser window. Waiting for auth cookies...");

    const deadline = Date.now() + 300_000;
    while (Date.now() < deadline) {
      try {
        const cookies = await context.cookies("https://x.com");
        const authNames = ["auth_token", "ct0", "twid"];
        const found = cookies.filter((c) => authNames.includes(c.name));
        if (found.length >= 2) {
          await page.waitForTimeout(3000);
          await context.close();
          return { success: true, message: `Twitter login successful! (${found.map((c) => c.name).join(", ")})` };
        }
      } catch {
        return { success: false, message: "Twitter login cancelled (browser closed)." };
      }
      await page.waitForTimeout(2000);
    }

    await context.close();
    return { success: false, message: "Twitter login timed out after 5 minutes." };
  } catch (error) {
    try { await context.close(); } catch { /* already closed */ }
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, message: `Twitter login failed: ${msg}` };
  }
}

export function registerTwitterLoginTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "trigger_twitter_login",
    label: "Twitter Login",
    description:
      "Open a browser window for the user to log in to Twitter/X. Call this when get_twitter_sentiment reports that login is needed and the user has confirmed they want to proceed. Returns success/failure. After success, retry get_twitter_sentiment.",
    promptSnippet:
      "trigger_twitter_login: Opens a browser for Twitter/X login. Use when Twitter sentiment is unavailable due to missing session.",
    parameters: Type.Object({}),

    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      if (!ctx?.hasUI) {
        return {
          content: [{ type: "text", text: "Cannot open browser in non-interactive mode. Twitter login requires a terminal session with UI." }],
          details: { success: false },
        };
      }

      const result = await runTwitterLogin((msg) => ctx.ui.notify(msg, "info"));

      return {
        content: [{ type: "text", text: result.message }],
        details: { success: result.success },
      };
    },
  });
}
