import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, chromium, type Locator, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ModelSetupRequirement } from "../../gui/server/model-setup.js";
import { FIRST_RUN_ONBOARDING_SEEN_KEY } from "../../gui/web/src/features/onboarding/setup-dismissal.js";

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
  let probeBaseUrl: string;
  let probeServer: HttpServer;
  let smokeHome: string;
  let serverLog = "";

  beforeAll(async () => {
    smokeHome = mkdtempSync(join(tmpdir(), "opencandle-gui-release-smoke-"));
    const port = await allocatePort();
    baseUrl = `http://127.0.0.1:${port}`;
    ({ server: probeServer, baseUrl: probeBaseUrl } = await startModelKeyProbeStub());
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
        // Keyed data providers are blanked too: the GUI server loads the
        // repo .env, and the diagnostics journey asserts the cold-home
        // never-configured provider presentation.
        ALPHA_VANTAGE_API_KEY: "",
        FRED_API_KEY: "",
        OPENCANDLE_MODEL_KEY_PROBE_BASE_URL: probeBaseUrl,
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
    // Every test below is written as a first run: it navigates to the home
    // route and expects the setup dialog to auto-open. The product remembers
    // per browser profile that onboarding has been seen, and this suite shares
    // one profile across tests, so the first test's opening would otherwise
    // suppress the dialog for all the tests after it. Forget the record on
    // every navigation, which is what a genuinely fresh profile would look
    // like. Do not do this by weakening the product: the persistence itself is
    // covered by tests/unit/gui-web/first-run-setup-dialog.test.ts.
    await page.addInitScript((key: string) => {
      try {
        localStorage.removeItem(key);
      } catch {
        // A profile without storage access is already a fresh first run.
      }
    }, FIRST_RUN_ONBOARDING_SEEN_KEY);
  });

  afterAll(async () => {
    writeEvidence("gui-server.log", serverLog);
    await browser?.close();
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill("SIGTERM");
      await waitForExit(serverProcess);
    }
    await closeServer(probeServer);
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
    // First-run setup auto-opens as a modal dialog over the home surface.
    const setupDialog = page.getByRole("dialog", { name: "Welcome to OpenCandle" });
    await expectVisible(setupDialog);
    await expectVisible(page.getByText("Market research, on your machine"));

    const bootstrap = await page.evaluate(async () => {
      const response = await fetch("/api/bootstrap");
      return response.json();
    });
    expect(releaseStatusValues.has(bootstrap.modelSetup.requirement)).toBe(true);
    expect(bootstrap.modelSetup.requirement).toBe("connect_auth");
    expect(JSON.stringify(bootstrap.modelSetup)).not.toContain("needs_api_key");

    const screenshot = await page.screenshot({ fullPage: true });
    writeEvidence("first-run-home.png", screenshot);

    await page.getByRole("button", { name: "Skip" }).click();
    await expectVisible(page.getByRole("heading", { name: "Connect an AI model" }));
  });

  // The invariant: first-run setup must not strand the user. It is dismissible
  // by Escape AND by the close control, and once dismissed the composer is
  // FULLY usable — a real pointer click at its centre plus real keystrokes, no
  // point-hunting around an overlapping dialog. Sending stays blocked until a
  // model is connected. Do not weaken any of this to an `isEnabled()` check.
  it("dismisses first-run setup with Escape and frees the composer", async () => {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    const setupDialog = page.getByRole("dialog", { name: "Welcome to OpenCandle" });
    await expectVisible(setupDialog);

    await page.keyboard.press("Escape");
    await setupDialog.waitFor({ state: "hidden" });

    const composer = page.getByLabel("Message OpenCandle");
    await expect(composer.isEnabled()).resolves.toBe(true);
    // Nothing may sit on top of the composer's centre once setup is dismissed.
    const centreHitsComposer = await page.evaluate(() => {
      const composerEl = document.getElementById("chat-composer");
      if (!composerEl) return false;
      const box = composerEl.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return hit === composerEl;
    });
    expect(centreHitsComposer).toBe(true);

    await composer.click();
    await page.keyboard.type("Draft while I find my key");
    await expect(composer.inputValue()).resolves.toBe("Draft while I find my key");
    await expect(page.getByRole("button", { name: "Send message" }).isDisabled()).resolves.toBe(
      true,
    );
  });

  it("dismisses first-run setup from its close control", async () => {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    const setupDialog = page.getByRole("dialog", { name: "Welcome to OpenCandle" });
    await expectVisible(setupDialog);

    await setupDialog.getByRole("button", { name: "Close dialog" }).click();
    await setupDialog.waitFor({ state: "hidden" });

    const composer = page.getByLabel("Message OpenCandle");
    await composer.click();
    await page.keyboard.type("Drafting after closing setup");
    await expect(composer.inputValue()).resolves.toBe("Drafting after closing setup");
  });

  it("rejects an invalid OpenAI key inline without connecting a model", async () => {
    await page.goto(baseUrl, { waitUntil: "networkidle" });

    await page.getByRole("button", { name: "Skip" }).click();
    const setupCard = page.locator('[data-slot="connect-model-panel"]');
    await setupCard.getByRole("button", { name: /^OpenAI/ }).click();
    await setupCard.getByRole("textbox", { name: "API key" }).fill("garbage-openai-key");
    await setupCard.getByRole("button", { name: "Save key" }).click();

    await expectVisible(
      setupCard.getByRole("alert").filter({ hasText: "Key was rejected by OpenAI" }),
    );
    // Escape must still dismiss after a failed save. A Radix Toast mounts its
    // own dismissable layer, and DismissableLayer routes Escape only to the
    // highest layer — so re-adding a toast for an error already shown inline
    // here would silently make Escape dead. That is what this asserts.
    // The composer sits behind the modal, so dismiss before asserting that the
    // rejected key connected no model.
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await expectVisible(page.getByRole("button", { name: "No model connected" }));
  });

  it("rejects a Google API_KEY_INVALID response from the local probe stub", async () => {
    await page.goto(baseUrl, { waitUntil: "networkidle" });

    await page.getByRole("button", { name: "Skip" }).click();
    const setupCard = page.locator('[data-slot="connect-model-panel"]');
    await setupCard.getByRole("button", { name: /^Google Gemini/ }).click();
    await setupCard.getByRole("textbox", { name: "API key" }).fill("garbage-google-key");
    await setupCard.getByRole("button", { name: "Save key" }).click();

    await expectVisible(
      setupCard.getByRole("alert").filter({ hasText: "Key was rejected by Google Gemini" }),
    );
    // The composer sits behind the modal, so dismiss before asserting that the
    // rejected key connected no model.
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await expectVisible(page.getByRole("button", { name: "No model connected" }));
  });

  it("reports a blocked cold home while optional providers are ready", async () => {
    await page.goto(`${baseUrl}/diagnostics`, { waitUntil: "networkidle" });

    const warnings = page.getByText("Warnings", { exact: true }).locator("xpath=..");
    await expectVisible(warnings.getByText("0", { exact: true }));

    // Never-configured optional keyed providers report skip (0.12.0), not a
    // warning: the Alpha Vantage credential row reads as optional with a
    // Connect action. The section-level badge is deliberately not asserted —
    // it folds in live public-provider reachability probes (Yahoo,
    // TradingView, Polymarket), which this smoke must not depend on.
    const providersSection = page
      .getByRole("heading", { name: "Providers", exact: true })
      .locator("xpath=../..");
    const alphaVantageRow = providersSection.getByRole("row").filter({ hasText: "Alpha Vantage" });
    await expectVisible(alphaVantageRow.getByText("Not connected — optional."));
    await expectVisible(alphaVantageRow.getByRole("button", { name: "Connect" }));
    await expectVisible(
      page.getByRole("main").locator("header").getByText("Blocked", { exact: true }),
    );
  });

  it("opens model-key management from the disconnected composer", async () => {
    await page.goto(baseUrl, { waitUntil: "networkidle" });

    // Re-entry after dismissing first-run setup must stay discoverable: the
    // composer's model control is the way back in.
    const setupDialog = page.getByRole("dialog", { name: "Welcome to OpenCandle" });
    await expectVisible(setupDialog);
    await page.keyboard.press("Escape");
    await setupDialog.waitFor({ state: "hidden" });

    await page.getByRole("button", { name: "No model connected" }).click();
    const manageKeys = page.getByRole("menuitem", { name: "Manage model keys…" });
    await expectVisible(manageKeys);
    await manageKeys.click();

    // Manage-keys lands on Settings -> Model, which opens straight on the
    // provider choice: one option per supported model provider, each leading
    // to its own key form.
    await page.waitForURL(/\/settings\/model$/);
    const modelSection = page.locator('[data-slot="model-section"]');
    await expectVisible(modelSection);
    await expect(
      modelSection.locator('[data-slot="provider-option"]').count(),
    ).resolves.toBeGreaterThanOrEqual(3);
    await modelSection.getByRole("button", { name: /^OpenAI/ }).click();
    await expectVisible(modelSection.getByRole("textbox", { name: "API key" }));
  });
});

async function allocatePort(): Promise<number> {
  const server = createNetServer();
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

async function startModelKeyProbeStub(): Promise<{ server: HttpServer; baseUrl: string }> {
  const server = createHttpServer((request, response) => {
    if (request.url === "/v1beta/models") {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { details: [{ reason: "API_KEY_INVALID" }] } }));
      return;
    }
    response.writeHead(401, { "content-type": "text/plain" });
    response.end("Unauthorized");
  });
  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") resolve(address.port);
      else reject(new Error("Failed to start model-key probe stub"));
    });
  });
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

async function closeServer(server: HttpServer | undefined): Promise<void> {
  if (!server?.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
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
