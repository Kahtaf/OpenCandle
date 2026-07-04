import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, chromium, type Locator, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ModelSetupRequirement } from "../../gui/server/model-setup.js";

const runGuiReleaseSmoke = process.env.OPENCANDLE_GUI_RELEASE_SMOKE === "1";
const releaseStatusValues = new Set<ModelSetupRequirement>([
  "ready",
  "select_model",
  "connect_auth",
]);

describe.skipIf(!runGuiReleaseSmoke)("GUI release-gate smoke", () => {
  let browser: Browser;
  let page: Page;
  let serverProcess: ChildProcessWithoutNullStreams;
  let baseUrl: string;
  let smokeHome: string;
  let serverLog = "";

  beforeAll(async () => {
    smokeHome = mkdtempSync(join(tmpdir(), "opencandle-gui-release-smoke-"));
    const port = await allocatePort();
    baseUrl = `http://127.0.0.1:${port}`;
    serverProcess = spawn("npm", ["run", "gui"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOME: join(smokeHome, "home"),
        OPENCANDLE_HOME: join(smokeHome, "opencandle"),
        OPENCANDLE_GUI_HOST: "127.0.0.1",
        OPENCANDLE_GUI_PORT: String(port),
        GEMINI_API_KEY: "",
        GOOGLE_API_KEY: "",
        OPENAI_API_KEY: "",
        ANTHROPIC_API_KEY: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    serverProcess.stdout.on("data", (chunk) => {
      serverLog += chunk.toString();
    });
    serverProcess.stderr.on("data", (chunk) => {
      serverLog += chunk.toString();
    });

    await waitForHealth(`${baseUrl}/health`, () => serverLog);

    browser = await chromium.launch({
      executablePath: resolveChromiumExecutable(),
      headless: true,
    });
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  });

  afterAll(async () => {
    writeEvidence("gui-server.log", serverLog);
    await browser?.close();
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill("SIGTERM");
      await waitForExit(serverProcess);
    }
    if (smokeHome) rmSync(smokeHome, { recursive: true, force: true });
  });

  it("boots the GUI server and exposes health without credentials", async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.ok).toBe(true);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
  });

  it("renders the home route and first-run model setup in a real browser", async () => {
    await page.goto(baseUrl, { waitUntil: "networkidle" });

    await expectVisible(page.getByText("OpenCandle").first());
    await expectVisible(page.getByText("Connect an AI model"));

    const bootstrap = await page.evaluate(async () => {
      const response = await fetch("/api/bootstrap");
      return response.json();
    });
    expect(releaseStatusValues.has(bootstrap.modelSetup.requirement)).toBe(true);
    expect(bootstrap.modelSetup.requirement).toBe("connect_auth");
    expect(JSON.stringify(bootstrap.modelSetup)).not.toContain("needs_api_key");

    // Shipped 0.11.0 behavior: the composer stays usable for drafting during
    // first-run setup; only sending is blocked until a model is ready.
    await expect(page.getByLabel("Message OpenCandle").isEnabled()).resolves.toBe(true);
    await page.getByLabel("Message OpenCandle").fill("Draft while I find my key");
    await expect(page.getByRole("button", { name: "Send message" }).isDisabled()).resolves.toBe(
      true,
    );

    const screenshot = await page.screenshot({ fullPage: true });
    writeEvidence("first-run-home.png", screenshot);
  });
});

async function allocatePort(): Promise<number> {
  const server = createServer();
  return await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") resolve(address.port);
        else reject(new Error("Failed to allocate a local port"));
      });
    });
  });
}

async function waitForHealth(url: string, log: () => string): Promise<void> {
  const deadline = Date.now() + 45_000;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = `${response.status} ${response.statusText}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`GUI server did not become healthy: ${lastError}\n${log()}`);
}

async function waitForExit(process: ChildProcessWithoutNullStreams): Promise<void> {
  if (process.exitCode !== null || process.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 5_000);
    process.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function expectVisible(locator: Locator, timeout = 10_000) {
  await locator.waitFor({ state: "visible", timeout });
  await expect(locator.isVisible()).resolves.toBe(true);
}

function resolveChromiumExecutable(): string {
  const configured = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (configured) return configured;
  const bundled = chromium.executablePath();
  if (existsSync(bundled)) return bundled;
  const macChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (existsSync(macChrome)) return macChrome;
  return bundled;
}

function writeEvidence(fileName: string, content: string | Uint8Array): void {
  const evidenceDir = process.env.OPENCANDLE_GUI_SMOKE_EVIDENCE_DIR;
  if (!evidenceDir) return;
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(join(evidenceDir, fileName), content);
}
