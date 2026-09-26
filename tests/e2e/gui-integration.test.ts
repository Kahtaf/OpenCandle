import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  browserCoverageEnabled,
  startBrowserCoverage,
  stopBrowserCoverage,
} from "../helpers/browser-coverage.js";
import {
  createExternalTrafficGuard,
  expectVisible,
  hasScrollableAncestor,
  isPointerTarget,
  resolveChromiumExecutable,
} from "../support/gui/browser-helpers.js";
import {
  installConcurrentSessionRunMock,
  installMockHttpBootstrap,
  installMockMarketState,
  installMockSocket,
  installTwoClientCoordinatorMock,
  longTranscriptEntries,
  toolRunEntries,
} from "../support/gui/browser-mocks.js";
import { type IsolatedGuiServer, startIsolatedGuiServer } from "../support/gui/server.js";

const runGuiIntegration = process.env.OPENCANDLE_GUI_INTEGRATION === "1";

/**
 * Deterministic browser integration lane. Every case serves the real GUI bundle
 * from an isolated local server (temporary HOME/OPENCANDLE_HOME, blanked model
 * and provider credentials, OS-allocated port) while HTTP/WS/SSE are mocked in
 * the page. Cases that need a live model or the TUI parity harness stay in
 * gui-browser.test.ts; this lane never calls a model or the public internet.
 */
describe.skipIf(!runGuiIntegration)("GUI browser integration (mocked transports)", () => {
  let browser: Browser;
  let guiUrl: string;
  let server: IsolatedGuiServer;
  let traffic: ReturnType<typeof createExternalTrafficGuard>;
  const coveragePages: Page[] = [];

  beforeAll(async () => {
    server = await startIsolatedGuiServer({ cwd: process.cwd() });
    guiUrl = server.baseUrl;
    traffic = createExternalTrafficGuard(guiUrl);
    browser = await chromium.launch({
      executablePath: resolveChromiumExecutable(),
      headless: true,
    });
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await server?.stop();
  });

  afterEach(async () => {
    // Stop coverage and close every page opened by the case, even when an
    // assertion threw, so raw captures are written before the page goes away.
    const label = expect.getState().currentTestName ?? "gui-integration";
    for (const page of coveragePages.splice(0)) {
      if (page.isClosed()) continue;
      await stopBrowserCoverage(page, label);
      await page.close();
    }
    traffic?.assertClean();
  });

  async function newPage(options?: Parameters<Browser["newPage"]>[0]): Promise<Page> {
    const created = await browser.newPage(options);
    await traffic.guard(created);
    if (browserCoverageEnabled()) {
      await startBrowserCoverage(created);
    }
    coveragePages.push(created);
    return created;
  }

  it("renders missing API-key onboarding in a browser", async () => {
    const mocked = await newPage({ viewport: { width: 815, height: 938 } });
    await installMockSocket(mocked, {
      modelSetup: {
        requirement: "connect_auth",
        providers: [
          {
            id: "google",
            label: "Google Gemini",
            envVar: "GEMINI_API_KEY",
            defaultModel: "gemini-2.5-flash",
            signupUrl: "https://aistudio.google.com/app/apikey",
          },
        ],
        availableModels: [],
      },
    });

    await mocked.goto(guiUrl, { waitUntil: "networkidle" });

    // First run auto-opens the onboarding carousel as a modal dialog; the key
    // form is its last step, and the provider is chosen before its key.
    const setupDialog = mocked.getByRole("dialog", { name: "Welcome to OpenCandle" });
    await expectVisible(setupDialog);
    await expectVisible(mocked.getByText("Market research, on your machine"));

    await setupDialog.getByRole("button", { name: "Skip" }).click();
    await expectVisible(setupDialog.getByRole("heading", { name: "Connect an AI model" }));
    await setupDialog.getByRole("button", { name: /Google Gemini/ }).click();
    await expectVisible(mocked.getByLabel("API key"));
    await expectVisible(mocked.getByRole("button", { name: "Save key" }));

    // Setup must not strand the user: Escape dismisses, and drafting is then
    // fully available with sending still blocked until a model is connected.
    await mocked.keyboard.press("Escape");
    await setupDialog.waitFor({ state: "hidden" });
    const composer = mocked.getByLabel("Message OpenCandle");
    await expect(composer.isEnabled()).resolves.toBe(true);
    await composer.click();
    await mocked.keyboard.type("Draft while I find my key");
    await expect(composer.inputValue()).resolves.toBe("Draft while I find my key");
    await expect(mocked.getByRole("button", { name: "Send message" }).isDisabled()).resolves.toBe(
      true,
    );

    // Re-entry stays discoverable from the composer's model control.
    await mocked.getByRole("button", { name: "No model connected" }).click();
    await expectVisible(mocked.getByRole("menuitem", { name: "Manage model keys…" }));
  });

  it("lets users manage model keys from the composer selector", async () => {
    const mocked = await newPage({ viewport: { width: 1024, height: 720 } });
    await installMockSocket(mocked, {
      modelSetup: {
        requirement: "ready",
        currentModel: "openai/gpt-5-mini",
        providers: [
          {
            id: "openai",
            label: "OpenAI",
            envVar: "OPENAI_API_KEY",
            defaultModel: "gpt-5-mini",
            signupUrl: "https://platform.openai.com/api-keys",
          },
        ],
        availableModels: [
          { provider: "openai", id: "gpt-5-mini", label: "openai/gpt-5-mini" },
          { provider: "openai", id: "gpt-4.1-mini", label: "openai/gpt-4.1-mini" },
        ],
      },
    });

    await mocked.goto(guiUrl, { waitUntil: "networkidle" });
    const modelSelector = mocked.getByRole("button", { name: "gpt-5-mini" });
    const manageModelKeys = mocked.getByRole("menuitem", { name: "Manage model keys…" });
    await modelSelector.click();
    const modelMenuId = await modelSelector.getAttribute("aria-controls");
    expect(modelMenuId).toBeTruthy();
    const modelMenu = mocked.locator(`[id="${modelMenuId}"]`);
    await expectVisible(manageModelKeys);
    await modelSelector.click();
    await manageModelKeys.waitFor({ state: "hidden" });
    await mocked.waitForTimeout(200);
    await expect(modelMenu.evaluate((element) => getComputedStyle(element).display)).resolves.toBe(
      "none",
    );

    await modelSelector.click();
    await mocked.getByRole("menuitemradio", { name: /gpt-4\.1-mini/ }).click();
    await expectVisible(mocked.getByRole("button", { name: "gpt-4.1-mini" }));

    await mocked.getByRole("button", { name: "gpt-4.1-mini" }).click();
    await expectVisible(manageModelKeys);
    await manageModelKeys.click();
    // Key management is a settings page now, not a dialog over the chat.
    await mocked.waitForURL(/\/settings\/model$/);
    await expectVisible(mocked.locator('[data-slot="model-section"]'));
    await expectVisible(mocked.getByRole("heading", { name: "Connect a model" }));
    await expect(mocked.getByRole("dialog").count()).resolves.toBe(0);
  });

  it("explains unavailable onboarding while setup access reconnects", async () => {
    const mocked = await newPage({ viewport: { width: 1024, height: 720 } });
    await installMockSocket(mocked, {
      role: "follower",
      modelSetup: {
        requirement: "connect_auth",
        providers: [
          {
            id: "google",
            label: "Google Gemini",
            envVar: "GEMINI_API_KEY",
            defaultModel: "gemini-2.5-flash",
            signupUrl: "https://aistudio.google.com/app/apikey",
          },
        ],
        availableModels: [],
      },
    });

    await mocked.goto(guiUrl, { waitUntil: "networkidle" });

    await mocked.getByRole("button", { name: "Skip" }).click();
    await expectVisible(mocked.getByText("Model setup changes are unavailable"));
    await expect(mocked.getByLabel("Message OpenCandle").isEnabled()).resolves.toBe(true);
    // A local follower cannot even choose a provider, so the whole key path
    // stays unreachable rather than only the Save action.
    await expect(mocked.getByRole("button", { name: /Google Gemini/ }).isDisabled()).resolves.toBe(
      true,
    );
  });

  it("keeps the composer focused on send and supports keyboard catalog controls", async () => {
    const mocked = await newPage({ viewport: { width: 1024, height: 720 } });
    await installMockSocket(mocked, {
      entries: [
        {
          type: "message",
          id: "assistant-1",
          timestamp: new Date().toISOString(),
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Reusable assistant text" }],
          },
        },
      ],
    });

    await mocked.goto(guiUrl, { waitUntil: "networkidle" });
    await expectVisible(mocked.getByRole("button", { name: "Send message" }));
    await expect(mocked.getByRole("button", { name: "Stop response" }).count()).resolves.toBe(0);
    await expect(mocked.getByRole("button", { name: "Retry last prompt" }).count()).resolves.toBe(
      0,
    );
    await expect(
      mocked.getByRole("button", { name: "Copy latest assistant response" }).count(),
    ).resolves.toBe(0);

    await mocked.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
    await expectVisible(mocked.getByRole("dialog", { name: "Catalog" }));
    await mocked.keyboard.press("Escape");
    await mocked.getByRole("dialog", { name: "Catalog" }).waitFor({ state: "detached" });
  }, 30_000);

  it("sends portfolio attachments through the shared chat request", async () => {
    const mocked = await newPage({ viewport: { width: 1024, height: 720 } });
    await installMockSocket(mocked, {
      dashboard: {
        watchlist: [],
        activeAnalyses: [],
        recentResearch: [],
        dataQuality: { softGaps: [], hardSkips: [] },
        lastTurn: {
          routeKind: "workflow",
          workflow: "portfolio_builder",
          symbols: ["AAPL", "MSFT"],
          slotSources: { user: 1, default: 1 },
          priorTurnCount: 2,
          savedStateIncluded: true,
          attachmentCount: 1,
          validation: { passed: false, mismatchCount: 2 },
        },
      },
    });
    await installMockMarketState(mocked, {
      portfolios: [{ id: 1, name: "Portfolio" }],
      watchlists: [{ id: 1, name: "Default", isDefault: true }],
    });
    await mocked.addInitScript(() => {
      const originalFetch = window.fetch.bind(window);
      window.__chatRunRequests = [];
      window.fetch = (input, init) => {
        const url = typeof input === "string" ? input : input.url;
        if (url.endsWith("/api/sessions/mock-session/runs")) {
          const body = init?.body ? JSON.parse(String(init.body)) : {};
          window.__chatRunRequests.push(body);
          const encoder = new TextEncoder();
          const stream = new ReadableStream({
            start(controller) {
              const send = (payload) =>
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
              send({ type: "run.started", runId: "portfolio-run", seq: 1 });
              send({
                type: "message.created",
                messageId: "portfolio-user",
                role: "user",
                seq: 2,
              });
              send({
                type: "message.completed",
                messageId: "portfolio-user",
                content: [{ type: "text", text: body.prompt }],
                attachments: [{ kind: "portfolio", label: "Portfolio" }],
                seq: 3,
              });
              send({ type: "run.completed", runId: "portfolio-run", seq: 4 });
              controller.close();
            },
          });
          return Promise.resolve(
            new Response(stream, {
              status: 200,
              headers: { "content-type": "text/event-stream" },
            }),
          );
        }
        return originalFetch(input, init);
      };
    });

    await mocked.goto(guiUrl, { waitUntil: "networkidle" });
    await mocked.getByRole("button", { name: "Attach context" }).click();
    await mocked.getByRole("menuitem", { name: "Portfolio" }).click();
    await expectVisible(mocked.getByText("Portfolio").first());
    await mocked.getByLabel("Message OpenCandle").fill("am I too concentrated?");
    await mocked.getByRole("button", { name: "Send" }).click();

    await expectVisible(mocked.getByText("am I too concentrated?").first());
    await expectVisible(mocked.getByText("Portfolio").first());
    await mocked.waitForFunction(() => window.__chatRunRequests?.length === 1);
    const requestBody = await mocked.evaluate(() => window.__chatRunRequests[0]);
    expect(requestBody).toMatchObject({
      prompt: "am I too concentrated?",
      sessionId: "mock-session",
      attachments: [{ kind: "portfolio" }],
    });
  }, 30_000);

  it("autocompletes cashtags and opens entity chip popovers", async () => {
    const mocked = await newPage({ viewport: { width: 1440, height: 960 } });
    await installMockSocket(mocked);
    await installMockMarketState(mocked, {
      instrumentCandidates: [
        {
          symbol: "AA",
          name: "Alcoa Corp.",
          quoteType: "EQUITY",
          assetType: "equity",
          exchange: "NYQ",
          provider: "yahoo",
          score: 100,
        },
      ],
      watchlist: [{ id: 1, instrumentId: 1, symbol: "AA", name: "Alcoa Corp." }],
      quoteSnapshot: {
        watchlistQuotes: [
          {
            itemId: 1,
            instrumentId: 1,
            symbol: "AA",
            status: "ok",
            price: 32.45,
            changePercent: 1.2,
          },
        ],
        portfolioQuotes: [],
        portfolioSummary: null,
      },
    });
    await mocked.addInitScript(() => {
      const fetchImpl = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = new URL(typeof input === "string" ? input : input.url, window.location.origin);
        if (!url.pathname.endsWith("/api/sessions/mock-session/runs")) {
          return fetchImpl(input, init);
        }
        const prompt = JSON.parse(String(init?.body ?? "{}")).prompt;
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            for (const event of [
              { type: "run.started", sessionId: "mock-session", runId: "cashtag-run", seq: 1 },
              {
                type: "message.completed",
                sessionId: "mock-session",
                messageId: "cashtag-user",
                role: "user",
                content: [{ type: "text", text: prompt }],
                seq: 2,
              },
              { type: "run.completed", sessionId: "mock-session", runId: "cashtag-run", seq: 3 },
            ]) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\\n\\n`));
            }
            controller.close();
          },
        });
        return Promise.resolve(
          new Response(stream, { headers: { "content-type": "text/event-stream" } }),
        );
      };
    });

    await mocked.goto(guiUrl, { waitUntil: "networkidle" });
    const composer = mocked.getByLabel("Message OpenCandle");
    await composer.fill("$AA");
    await expectVisible(mocked.getByRole("listbox", { name: "Ticker suggestions" }), 5_000);
    await mocked.keyboard.press("Enter");
    await expect(composer.inputValue()).resolves.toBe("$AA ");

    await mocked.getByRole("button", { name: "Send message" }).click();
    const chip = mocked.locator('[data-symbol="AA"]').first();
    await expectVisible(chip);
    await chip.click();
    await expectVisible(mocked.getByText("Alcoa Corp.").first());
    await expectVisible(mocked.getByText("$32.45"));
  }, 30_000);

  it("reconnects stale GUI sockets when the browser returns to the foreground", async () => {
    const mocked = await newPage({ viewport: { width: 1024, height: 720 } });
    await installMockSocket(mocked);

    await mocked.goto(guiUrl, { waitUntil: "networkidle" });
    await expectVisible(mocked.getByRole("button", { name: "Send message" }));

    await mocked.evaluate(() => window.__mockWebSocketInstances.at(-1).close());
    await expectVisible(mocked.getByText("Reconnecting to the GUI session."));

    await mocked.evaluate(() => window.dispatchEvent(new Event("focus")));

    await mocked.waitForFunction(() => window.__mockWebSocketInstances.length >= 2);
    await mocked.getByText("Reconnecting to the GUI session.").waitFor({ state: "detached" });
    await expect(mocked.getByLabel("Message OpenCandle").isEnabled()).resolves.toBe(true);
  });

  it("collapses and restores the desktop sidebar", async () => {
    const mocked = await newPage({ viewport: { width: 1024, height: 720 } });
    await installMockSocket(mocked);

    await mocked.goto(guiUrl, { waitUntil: "networkidle" });
    await expectVisible(mocked.getByRole("button", { name: "New chat", exact: true }));
    await mocked.getByRole("button", { name: "Collapse sidebar" }).click();
    await mocked
      .getByRole("button", { name: "New chat", exact: true })
      .waitFor({ state: "detached" });
    await expectVisible(mocked.getByRole("button", { name: "Expand sidebar" }));
    await mocked.getByRole("button", { name: "Expand sidebar" }).click();
    await expectVisible(mocked.getByRole("button", { name: "New chat", exact: true }));
  });

  it("uses the sidebar app shell as market-state navigation", async () => {
    const mocked = await newPage({ viewport: { width: 1024, height: 720 } });
    await installMockSocket(mocked);
    await installMockMarketState(mocked, {
      instrumentCandidates: [
        {
          symbol: "AA",
          name: "Alcoa Corp.",
          quoteType: "EQUITY",
          assetType: "equity",
          exchange: "NYQ",
          provider: "yahoo",
          score: 100,
        },
      ],
    });

    await mocked.goto(`${guiUrl}/watchlists`, { waitUntil: "networkidle" });
    await expectVisible(mocked.getByRole("button", { name: "New chat", exact: true }));
    await expectVisible(mocked.getByRole("heading", { name: "Watchlists" }));
    await expect(mocked.getByRole("button", { name: "Quotes" }).count()).resolves.toBe(0);
    await expectVisible(mocked.getByRole("link", { name: "Portfolios" }));
    await expect(mocked.getByLabel("Market state sections").count()).resolves.toBe(0);
    await expect(
      mocked.getByRole("heading", { name: "Watchlists" }).evaluate(hasScrollableAncestor),
    ).resolves.toBe(true);
    await expect(
      mocked.getByText("Market State", { exact: true }).evaluate(hasScrollableAncestor),
    ).resolves.toBe(true);

    const addTickerAction = mocked.getByRole("button", { name: "Add ticker" }).first();
    await addTickerAction.click();
    await expectVisible(mocked.getByRole("heading", { name: "Add Ticker", exact: true }).first());
    await mocked.getByRole("combobox", { name: "Search ticker or company" }).fill("Alcoa");
    const watchlistAlcoaOption = mocked.getByRole("option", { name: /AA Alcoa Corp\./ });
    await expectVisible(watchlistAlcoaOption);
    await expect(watchlistAlcoaOption.evaluate(isPointerTarget)).resolves.toBe(true);
    await watchlistAlcoaOption.click();
    await expectVisible(mocked.getByText("Selected AA"));
    await mocked.getByRole("button", { name: "Close panel" }).click();

    await mocked.getByRole("link", { name: "Portfolios" }).click();
    await mocked.waitForURL("**/portfolios", { timeout: 5_000 });
    await expectVisible(mocked.getByRole("heading", { name: "Portfolios" }));
    await mocked.getByRole("button", { name: "Add holding" }).first().click();
    await mocked.getByRole("combobox", { name: "Search ticker or company" }).fill("Alcoa");
    const alcoaOption = mocked.getByRole("option", { name: /AA Alcoa Corp\./ });
    await expectVisible(alcoaOption);
    await expect(alcoaOption.evaluate(isPointerTarget)).resolves.toBe(true);
    await alcoaOption.click();
    await expectVisible(mocked.getByText("Selected AA"));
    await mocked.getByRole("button", { name: "Close panel" }).click();

    await mocked.getByRole("button", { name: "Collapse sidebar" }).click();
    await mocked
      .getByRole("button", { name: "New chat", exact: true })
      .waitFor({ state: "detached" });
    await expectVisible(mocked.getByRole("button", { name: "Expand sidebar" }));
    await mocked.getByRole("button", { name: "Expand sidebar" }).click();
    await expectVisible(mocked.getByRole("link", { name: "Alerts" }));

    await mocked.setViewportSize({ width: 390, height: 844 });
    await mocked.goto(`${guiUrl}/alerts`, { waitUntil: "networkidle" });
    await expectVisible(mocked.getByRole("button", { name: "Open sidebar" }));
    await mocked.getByRole("button", { name: "Open sidebar" }).click();
    await expectVisible(mocked.getByRole("dialog", { name: "Sessions" }));
    await expectVisible(mocked.getByRole("button", { name: "New chat", exact: true }));
    await expectVisible(mocked.getByRole("link", { name: "Reports" }));
    await mocked.goto(`${guiUrl}/portfolios`, { waitUntil: "networkidle" });
    await mocked.getByRole("button", { name: "Add holding" }).first().click();
    await mocked.getByRole("combobox", { name: "Search ticker or company" }).fill("Alcoa");
    const mobileAlcoaOption = mocked.getByRole("option", { name: /AA Alcoa Corp\./ });
    await expectVisible(mobileAlcoaOption);
    await expect(mobileAlcoaOption.evaluate(isPointerTarget)).resolves.toBe(true);
    await mobileAlcoaOption.click();
    await expectVisible(mocked.getByText("Selected AA"));
  });

  it("keeps reconnecting market-state pages readable and disables mutations", async () => {
    const mocked = await newPage({ viewport: { width: 1024, height: 720 } });
    await installMockSocket(mocked, { role: "follower" });
    await installMockMarketState(mocked, {
      watchlists: [{ id: 1, name: "Default", isDefault: true }],
      watchlist: [
        {
          id: 1,
          watchlistId: 1,
          instrumentId: 1,
          symbol: "AAPL",
          name: "Apple Inc.",
          assetType: "equity",
          exchange: "NMS",
        },
      ],
    });

    await mocked.goto(`${guiUrl}/alerts`, { waitUntil: "networkidle" });
    await expectVisible(mocked.getByRole("heading", { name: "Alerts" }));
    await expectVisible(mocked.getByText("Saved-state changes are unavailable"));
    await expectVisible(mocked.getByRole("heading", { name: "Active rules" }));
    await expect(
      mocked.getByRole("button", { name: "Create alert" }).first().isDisabled(),
    ).resolves.toBe(true);
    await expectVisible(mocked.getByText("Manual checks only"));

    await mocked.goto(`${guiUrl}/watchlists`, { waitUntil: "networkidle" });
    await expectVisible(mocked.getByRole("heading", { name: "Watchlists" }));
    await expect(
      mocked.getByRole("button", { name: "Add ticker" }).first().isDisabled(),
    ).resolves.toBe(true);
  });

  it("keeps restored mobile tool timelines collapsed and manually openable", async () => {
    const mocked = await newPage({ viewport: { width: 815, height: 938 } });
    await mocked.addInitScript(() => {
      window.WebSocket = function BrokenWebSocket() {
        throw new TypeError("WebSocket is not a constructor");
      };
      const entries = [
        {
          type: "message",
          id: "assistant-tools-1",
          timestamp: new Date().toISOString(),
          message: {
            role: "assistant",
            content: [
              {
                type: "toolCall",
                id: "tool-call-sofi",
                name: "get_stock_quote",
                arguments: { symbol: "SOFI" },
              },
            ],
          },
        },
      ];
      const events = [
        { type: "message.created", messageId: "assistant-tools-1", role: "assistant", seq: 1 },
        {
          type: "tool.started",
          toolCallId: "tool-call-sofi",
          messageId: "assistant-tools-1",
          name: "get_stock_quote",
          input: { symbol: "SOFI" },
          seq: 2,
        },
        {
          type: "message.completed",
          messageId: "assistant-tools-1",
          content: [{ type: "tool", toolCallId: "tool-call-sofi" }],
          seq: 3,
        },
      ];
      window.fetch = (input) => {
        const url = typeof input === "string" ? input : input.url;
        if (url.endsWith("/api/bootstrap")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                role: "writer",
                sessionId: "mock-session",
                sessions: [],
                catalog: { tools: [], workflows: [], providers: [] },
                modelSetup: { requirement: "ready", providers: [], availableModels: [] },
                askUserPrompts: [],
                snapshot: {
                  sessionId: "mock-session",
                  entries,
                  events,
                  state: {
                    watchlist: [],
                    activeAnalyses: [],
                    recentResearch: [],
                    dataQuality: { softGaps: [], hardSkips: [] },
                  },
                },
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              },
            ),
          );
        }
        return Promise.resolve(new Response("Not found", { status: 404, statusText: "Not found" }));
      };
    });

    await mocked.goto(guiUrl, { waitUntil: "networkidle" });
    const dialog = mocked.getByRole("dialog", { name: "Tool run timeline" });
    await expect(dialog.count()).resolves.toBe(0);
  });

  it("closes an open tool drawer when navigating to another session", async () => {
    const mocked = await newPage({ viewport: { width: 1024, height: 720 } });
    await installMockHttpBootstrap(mocked, {
      sessionId: "session-a",
      entries: toolRunEntries("tool-call-aapl", "AAPL"),
      sessionBootstraps: {
        "session-b": {
          entries: [
            {
              type: "message",
              id: "session-b-user",
              timestamp: new Date().toISOString(),
              message: { role: "user", content: "Session B prompt" },
            },
            {
              type: "message",
              id: "session-b-assistant",
              timestamp: new Date().toISOString(),
              message: { role: "assistant", content: "Session B answer" },
            },
          ],
        },
      },
    });

    await mocked.goto(guiUrl, { waitUntil: "networkidle" });
    const card = mocked.locator("button").filter({ hasText: "1 of 1 step" });
    await expectVisible(card.first());
    await card.first().click();
    await expectVisible(mocked.getByRole("button", { name: "Close drawer" }));

    await mocked.goto(`${guiUrl}/sessions/session-b`, { waitUntil: "networkidle" });
    await expectVisible(mocked.getByText("Session B prompt"));
    await expect(mocked.getByRole("button", { name: "Close drawer" }).count()).resolves.toBe(0);
  });

  it("restores deep-linked transcript anchors and offers jump to latest", async () => {
    const mocked = await newPage({ viewport: { width: 1024, height: 720 } });
    await installMockHttpBootstrap(mocked, {
      entries: longTranscriptEntries(44),
    });

    await mocked.goto(`${guiUrl}/?messageId=user-31`, { waitUntil: "networkidle" });
    await mocked.waitForSelector('[data-message-id="user-31"]');
    await mocked.waitForFunction(() => {
      const viewport = document.querySelector("[data-chat-transcript]");
      const anchor = document.querySelector('[data-message-id="user-31"]');
      if (!viewport || !anchor) return false;
      const viewportBox = viewport.getBoundingClientRect();
      const anchorBox = anchor.getBoundingClientRect();
      const top = anchorBox.top - viewportBox.top;
      return top >= 0 && top < viewport.clientHeight / 4;
    });
    const anchorPosition = await mocked.evaluate(() => {
      const viewport = document.querySelector("[data-chat-transcript]");
      const anchor = document.querySelector('[data-message-id="user-31"]');
      const viewportBox = viewport.getBoundingClientRect();
      const anchorBox = anchor.getBoundingClientRect();
      return {
        top: anchorBox.top - viewportBox.top,
        quarter: viewport.clientHeight / 4,
      };
    });
    expect(anchorPosition.top).toBeGreaterThanOrEqual(0);
    expect(anchorPosition.top).toBeLessThan(anchorPosition.quarter);

    await mocked.locator("[data-chat-transcript]").evaluate((element) => {
      element.scrollTop = 0;
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await expectVisible(mocked.getByRole("button", { name: "Jump to latest" }));
    await mocked.getByRole("button", { name: "Jump to latest" }).click();
    const nearBottom = await mocked.locator("[data-chat-transcript]").evaluate((element) => {
      return element.scrollHeight - element.scrollTop - element.clientHeight <= 48;
    });
    expect(nearBottom).toBe(true);
  });

  it("shows configured providers with a masked hint and a replace-only key input", async () => {
    const mocked = await newPage({ viewport: { width: 1024, height: 720 } });
    await installMockSocket(mocked, {
      catalog: {
        tools: [],
        workflows: [],
        providers: [
          {
            id: "fred",
            displayName: "FRED",
            source: "file",
            status: "file",
            configured: true,
            maskedKeyHint: "…-key",
            envVar: "FRED_API_KEY",
            unlocks: ["interest rates"],
            fallbackDescription: null,
            signupUrl: "https://fredaccount.stlouisfed.org/apikeys",
            instructionsHint: "Free, about 30 seconds",
          },
        ],
      },
    });

    // Providers live in Settings now; the catalog keeps run surfaces only.
    await mocked.goto(`${guiUrl}/settings/providers`, { waitUntil: "networkidle" });
    await mocked.getByRole("button", { name: /FRED/ }).click();

    // The saved secret never reaches the DOM: the input starts empty and the
    // configured state is communicated with a masked hint instead.
    const input = mocked.getByRole("textbox", { name: "API key" });
    await expect(input.inputValue()).resolves.toBe("");
    await expect(input.getAttribute("type")).resolves.toBe("password");
    await expectVisible(mocked.getByText("Configured").first());
    await expectVisible(mocked.getByText(/…-key/).first());
    await expectVisible(mocked.getByRole("button", { name: "Replace key" }));

    const pageContent = await mocked.content();
    expect(pageContent).not.toContain("fred-file-key");
  });

  it("opens session context menu and sends rename/delete actions", async () => {
    const mocked = await newPage({ viewport: { width: 1024, height: 720 } });
    await installMockSocket(mocked, {
      sessions: [
        {
          id: "session-1",
          path: "/tmp/opencandle-session-1.jsonl",
          name: "DRAM options",
          firstMessage: "DRAM options",
          modified: new Date().toISOString(),
        },
      ],
    });
    await mocked.addInitScript(() => {
      window.confirm = () => true;
    });

    await mocked.goto(guiUrl, { waitUntil: "networkidle" });
    const row = mocked.getByRole("button", { name: "DRAM options", exact: true });
    await row.hover();
    await mocked.getByRole("button", { name: "Session options for DRAM options" }).click();
    await mocked.getByRole("menuitem", { name: "Rename" }).click();
    await mocked.getByRole("textbox", { name: "Rename session" }).fill("DRAM LEAPS");
    await mocked.keyboard.press("Enter");
    await expectVisible(mocked.getByRole("button", { name: "DRAM LEAPS", exact: true }));

    const renamedRow = mocked.getByRole("button", { name: "DRAM LEAPS", exact: true });
    await renamedRow.hover();
    await mocked.getByRole("button", { name: "Session options for DRAM LEAPS" }).click();
    await mocked.getByRole("menuitem", { name: "Delete chat" }).click();
    await renamedRow.waitFor({ state: "detached" });

    const messages = await mocked.evaluate(() => window.__wsMessages);
    expect(messages).toContainEqual(
      expect.objectContaining({
        type: "session.rename",
        path: "/tmp/opencandle-session-1.jsonl",
        name: "DRAM LEAPS",
      }),
    );
    expect(messages).toContainEqual(
      expect.objectContaining({
        type: "session.delete",
        path: "/tmp/opencandle-session-1.jsonl",
      }),
    );
  });

  it("streams assistant text incrementally and keeps specialized tool cards", async () => {
    const mocked = await newPage({ viewport: { width: 1024, height: 720 } });
    await installMockSocket(mocked);
    await mocked.addInitScript(() => {
      window.fetch = (input) => {
        const url = typeof input === "string" ? input : input.url;
        if (url.includes("/api/sessions/actual-run-session/bootstrap")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                role: "writer",
                sessionId: "actual-run-session",
                sessions: [],
                catalog: { tools: [], workflows: [], providers: [] },
                modelSetup: { requirement: "ready", providers: [], availableModels: [] },
                askUserPrompts: [],
                snapshot: {
                  sessionId: "actual-run-session",
                  entries: [],
                  events: [
                    {
                      type: "message.completed",
                      sessionId: "actual-run-session",
                      messageId: "assistant-live",
                      role: "assistant",
                      content: [{ type: "text", text: "Routed answer" }],
                      seq: 1,
                    },
                  ],
                  state: {
                    watchlist: [],
                    activeAnalyses: [],
                    recentResearch: [],
                    dataQuality: { softGaps: [], hardSkips: [] },
                  },
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          );
        }
        const encoder = new TextEncoder();
        let releaseRemainder: (() => void) | undefined;
        window.__releaseSseRemainder = () => releaseRemainder?.();
        const stream = new ReadableStream({
          async start(controller) {
            const send = (payload) =>
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
            send({ type: "run.started", runId: "mock-run", sessionId: "mock-session", seq: 1 });
            send({
              type: "thinking.delta",
              runId: "mock-run",
              text: "Checking option expirations",
              seq: 2,
            });
            send({
              type: "message.created",
              messageId: "assistant-live",
              role: "assistant",
              seq: 3,
            });
            send({
              type: "message.delta",
              messageId: "assistant-live",
              text: "First chunk",
              seq: 4,
            });
            await new Promise((resolve) => {
              releaseRemainder = resolve;
            });
            send({
              type: "thinking.completed",
              runId: "mock-run",
              text: "Checking option expirations",
              seq: 5,
            });
            send({
              type: "message.delta",
              messageId: "assistant-live",
              text: " second chunk",
              seq: 6,
            });
            await new Promise((resolve) => setTimeout(resolve, 25));
            send({
              type: "tool.started",
              toolCallId: "call-1",
              messageId: "assistant-live",
              name: "get_stock_quote",
              input: { symbol: "NVDA" },
              seq: 7,
            });
            send({
              type: "tool.completed",
              toolCallId: "call-1",
              output: {
                content: [{ type: "text", text: "NVDA quote" }],
                details: { symbol: "NVDA", price: 185.25, changePercent: 1.2, volume: 123456 },
                isError: false,
              },
              seq: 8,
            });
            send({
              type: "message.completed",
              messageId: "assistant-live",
              content: [
                { type: "text", text: "First chunk second chunk" },
                { type: "tool", toolCallId: "call-1" },
              ],
              seq: 9,
            });
            send({ type: "run.completed", runId: "mock-run", seq: 10 });
            controller.close();
          },
        });
        return Promise.resolve(
          new Response(stream, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
        );
      };
    });

    await mocked.goto(guiUrl, { waitUntil: "networkidle" });
    await mocked.getByLabel("Message OpenCandle").fill("Mock streaming prompt");
    await mocked.getByRole("button", { name: "Send" }).click();

    await expectVisible(mocked.getByText("First chunk"));
    await expect(mocked.getByText("second chunk").count()).resolves.toBe(0);

    await mocked.evaluate(() => window.__releaseSseRemainder?.());
    await expectVisible(mocked.getByText("second chunk"));
    await expectVisible(mocked.getByText("Market lookup").first());
    await expectVisible(mocked.getByText("1 of 1 step").first());
  }, 30_000);

  it("shows the submitted user message before delayed server run events", async () => {
    const mocked = await newPage({ viewport: { width: 1024, height: 720 } });
    await installMockSocket(mocked);
    await mocked.addInitScript(() => {
      window.fetch = () => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            await new Promise((resolve) => {
              window.__releaseDelayedRun = resolve;
            });
            const send = (payload) =>
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
            send({ type: "run.started", runId: "delayed-run", sessionId: "mock-session", seq: 1 });
            send({
              type: "message.created",
              messageId: "assistant-live",
              role: "assistant",
              seq: 2,
            });
            send({
              type: "message.delta",
              messageId: "assistant-live",
              text: "Delayed answer",
              seq: 3,
            });
            send({ type: "run.completed", runId: "delayed-run", seq: 4 });
            controller.close();
          },
        });
        return Promise.resolve(
          new Response(stream, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
        );
      };
    });

    await mocked.goto(guiUrl, { waitUntil: "networkidle" });
    await mocked.getByLabel("Message OpenCandle").fill("Delayed prompt");
    await mocked.getByRole("button", { name: "Send" }).click();

    await expectVisible(mocked.getByText("Delayed prompt"));
    await expectVisible(mocked.getByText("Request received…"));
    await expect(mocked.getByText("Delayed answer").count()).resolves.toBe(0);

    await mocked.evaluate(() => window.__releaseDelayedRun?.());
    await expectVisible(mocked.getByText("Delayed answer"));
  }, 30_000);

  it("routes a home prompt to the server-emitted run session", async () => {
    const mocked = await newPage({ viewport: { width: 1024, height: 720 } });
    await installMockSocket(mocked);
    await mocked.addInitScript(() => {
      window.fetch = () => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            const send = (payload) =>
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
            send({
              type: "run.started",
              runId: "mock-run",
              sessionId: "actual-run-session",
              seq: 1,
            });
            send({
              type: "message.created",
              messageId: "assistant-live",
              role: "assistant",
              seq: 2,
            });
            send({
              type: "message.delta",
              messageId: "assistant-live",
              text: "Routed answer",
              seq: 3,
            });
            send({
              type: "message.completed",
              messageId: "assistant-live",
              content: [{ type: "text", text: "Routed answer" }],
              seq: 4,
            });
            send({ type: "run.completed", runId: "mock-run", seq: 5 });
            controller.close();
          },
        });
        return Promise.resolve(
          new Response(stream, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
        );
      };
    });

    await mocked.goto(guiUrl, { waitUntil: "networkidle" });
    await mocked.getByLabel("Message OpenCandle").fill("Prompt from fresh home");
    await mocked.getByRole("button", { name: "Send" }).click();

    await mocked.waitForURL("**/sessions/actual-run-session", { timeout: 5_000 });
  }, 30_000);

  it("falls back to HTTP chat runs when WebSocket is unavailable", async () => {
    const mocked = await newPage({ viewport: { width: 1024, height: 720 } });
    const pageErrors: string[] = [];
    mocked.on("pageerror", (error) => pageErrors.push(error.message));
    await mocked.addInitScript(() => {
      window.WebSocket = function BrokenWebSocket() {
        throw new TypeError("WebSocket is not a constructor");
      };
      window.__fetchRequests = [];
      window.fetch = (input, init) => {
        const url = typeof input === "string" ? input : input.url;
        window.__fetchRequests.push({ url, body: init?.body ? String(init.body) : "" });
        if (url.endsWith("/api/bootstrap")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                role: "writer",
                supportsSessionActions: true,
                sessionId: "fallback-session",
                sessions: [],
                catalog: {
                  tools: [{ name: "fallback_tool", displayName: "Fallback Tool", enabled: true }],
                  workflows: [],
                  providers: [],
                },
                modelSetup: { requirement: "ready", providers: [], availableModels: [] },
                askUserPrompts: [],
                snapshot: {
                  sessionId: "fallback-session",
                  entries: [],
                  events: [],
                  state: {
                    watchlist: [],
                    activeAnalyses: [],
                    recentResearch: [],
                    dataQuality: { softGaps: [], hardSkips: [] },
                  },
                },
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              },
            ),
          );
        }
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            const send = (payload) =>
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
            send({
              type: "run.started",
              runId: "fallback-run",
              sessionId: "fallback-session",
              seq: 1,
            });
            send({
              type: "message.created",
              messageId: "fallback-message",
              role: "assistant",
              seq: 2,
            });
            send({
              type: "message.delta",
              messageId: "fallback-message",
              text: "Fallback run worked",
              seq: 3,
            });
            send({ type: "run.completed", runId: "fallback-run", seq: 4 });
            controller.close();
          },
        });
        return Promise.resolve(
          new Response(stream, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
        );
      };
    });

    await mocked.goto(guiUrl, { waitUntil: "networkidle" });
    await expectVisible(mocked.getByLabel("Message OpenCandle"));
    await mocked.waitForFunction(
      () => {
        const textarea = document.querySelector("textarea");
        return textarea && !textarea.disabled;
      },
      null,
      { timeout: 5_000 },
    );
    await mocked.getByRole("button", { name: "New chat", exact: true }).click();
    expect(pageErrors).toEqual([]);
    await mocked.getByLabel("Message OpenCandle").fill("Fallback browser prompt");
    await mocked.getByRole("button", { name: "Send" }).click();

    await expectVisible(mocked.getByText("Fallback run worked"));
    const fetchRequests = await mocked.evaluate(() => window.__fetchRequests);
    expect(fetchRequests).toContainEqual(
      expect.objectContaining({ url: "/api/sessions/fallback-session/runs" }),
    );
    const runRequest = fetchRequests.find(
      (request) => request.url === "/api/sessions/fallback-session/runs",
    );
    expect(JSON.parse(runRequest.body)).toMatchObject({ prompt: "Fallback browser prompt" });
  }, 30_000);

  it("disables empty-state suggestions while home waits for a fresh session", async () => {
    const mocked = await newPage({ viewport: { width: 1024, height: 720 } });
    await installMockSocket(mocked, {
      // A fresh home session is only prepared for a session the server has
      // actually persisted to disk (shouldStartFreshHomeSession checks
      // gui.currentSessionPersisted); a session with entries that never
      // reports itself as persisted stays on its transcript instead of
      // clearing to the empty-state suggestions this test exercises.
      sessionPersisted: true,
      entries: [
        {
          type: "message",
          id: "stale-user-1",
          timestamp: new Date().toISOString(),
          message: { role: "user", content: "Previous prompt" },
        },
      ],
    });
    await mocked.addInitScript(() => {
      window.__fetchCount = 0;
      window.fetch = (input) => {
        window.__fetchCount += 1;
        const url = String(input);
        if (url.endsWith("/api/session/new")) {
          // The pending-fresh-session effect calls this for real while the
          // stale transcript is hidden. Hold it open so the test can assert
          // the disabled window before letting it resolve to a genuinely
          // empty session -- otherwise the empty-state suggestions this
          // test checks would fall back to the stale transcript (a broken
          // creation) or flip enabled again (an instant one) before the
          // assertions below run.
          return new Promise((resolve) => {
            window.__releaseFreshSession = () =>
              resolve(
                new Response(
                  JSON.stringify({
                    role: "writer",
                    sessionId: "fresh-session",
                    sessionPersisted: true,
                    coordination: { sessionId: "fresh-session", status: "ready" },
                    catalog: { tools: [], workflows: [], providers: [] },
                    modelSetup: { requirement: "ready", providers: [], availableModels: [] },
                    askUserPrompts: [],
                    sessions: [],
                    snapshot: { sessionId: "fresh-session", entries: [], events: [] },
                  }),
                  { status: 200, headers: { "content-type": "application/json" } },
                ),
              );
          });
        }
        return Promise.resolve(new Response("", { status: 204 }));
      };
    });

    await mocked.goto(guiUrl, { waitUntil: "networkidle" });
    const suggestion = mocked.getByRole("button", { name: "What is NVDA trading at?" });
    await expectVisible(suggestion);
    const baselineFetchCount = await mocked.evaluate(() => window.__fetchCount);
    await expect(suggestion.isDisabled()).resolves.toBe(true);
    await suggestion.click({ force: true });
    await expect(mocked.evaluate(() => window.__fetchCount)).resolves.toBe(baselineFetchCount);

    await mocked.evaluate(() => window.__releaseFreshSession?.());
    // Re-enabling happens after the released fresh session round-trips through
    // React, so poll for the settled state rather than racing a single frame.
    await expect.poll(() => suggestion.isDisabled(), { timeout: 5_000 }).toBe(false);
  }, 30_000);

  it("keeps two browser clients on one coordinated session without role wording", async () => {
    const first = await newPage({ viewport: { width: 1024, height: 720 } });
    const second = await newPage({ viewport: { width: 1024, height: 720 } });
    const sessionId = "coordinated-session";
    await installTwoClientCoordinatorMock(first, sessionId);
    await installTwoClientCoordinatorMock(second, sessionId);

    await first.goto(`${guiUrl}/sessions/${sessionId}`, { waitUntil: "networkidle" });
    await second.goto(`${guiUrl}/sessions/${sessionId}`, { waitUntil: "networkidle" });
    await expectVisible(first.getByRole("heading", { name: "What are we watching?" }));
    await expectVisible(second.getByRole("heading", { name: "What are we watching?" }));

    await first.getByLabel("Message OpenCandle").fill("First browser prompt");
    await first.getByRole("button", { name: "Send" }).click();
    await second.getByLabel("Message OpenCandle").fill("Second browser prompt");
    await second.getByRole("button", { name: "Send" }).click();

    await expectVisible(first.getByText("First browser answer"));
    await expectVisible(second.getByText("OpenCandle is still working in this session").first());
    await expect(first.getByText(/writer|follower|read-only|takeover/i).count()).resolves.toBe(0);
    await expect(second.getByText(/writer|follower|read-only|takeover/i).count()).resolves.toBe(0);

    const firstRequests = await first.evaluate(() => window.__coordinatedRequests);
    const secondRequests = await second.evaluate(() => window.__coordinatedRequests);
    expect([...firstRequests, ...secondRequests]).toEqual([
      expect.objectContaining({
        url: `/api/sessions/${sessionId}/runs`,
        prompt: "First browser prompt",
      }),
      expect.objectContaining({
        url: `/api/sessions/${sessionId}/runs`,
        prompt: "Second browser prompt",
      }),
    ]);
  }, 30_000);

  it("drives two routed sessions concurrently and stops only the targeted session", async () => {
    const first = await newPage({ viewport: { width: 1024, height: 720 } });
    const second = await newPage({ viewport: { width: 1024, height: 720 } });
    await installConcurrentSessionRunMock(first, {
      sessionId: "session-a",
      prompt: "Background session prompt",
      holdOpen: true,
      answer: "Session A should not complete before stop",
    });
    await installConcurrentSessionRunMock(second, {
      sessionId: "session-b",
      prompt: "Foreground session prompt",
      holdOpen: false,
      answer: "Session B completed independently",
    });

    await first.goto(`${guiUrl}/sessions/session-a`, { waitUntil: "networkidle" });
    await second.goto(`${guiUrl}/sessions/session-b`, { waitUntil: "networkidle" });
    await first.getByLabel("Message OpenCandle").fill("Background session prompt");
    await first.getByRole("button", { name: "Send message" }).click();
    await expectVisible(first.getByRole("button", { name: "Stop response" }));

    await second.getByLabel("Message OpenCandle").fill("Foreground session prompt");
    await second.getByRole("button", { name: "Send message" }).click();
    await expectVisible(second.getByText("Session B completed independently"));

    await first.getByRole("button", { name: "Stop response" }).click();
    // Scope to the visible toast description by exact text. Radix also mounts a
    // screen-reader announcer ("Notification Stopped response.") with
    // role=status, so the non-exact text locator is ambiguous once that
    // announcement lands in the same frame.
    await expectVisible(first.getByText("Stopped response.", { exact: true }));
    const firstRequests = await first.evaluate(() => window.__concurrentSessionRequests);
    const secondRequests = await second.evaluate(() => window.__concurrentSessionRequests);
    expect(firstRequests).toContainEqual(
      expect.objectContaining({
        sessionId: "session-a",
        prompt: "Background session prompt",
        aborted: true,
      }),
    );
    expect(secondRequests).toContainEqual(
      expect.objectContaining({
        sessionId: "session-b",
        prompt: "Foreground session prompt",
        aborted: false,
      }),
    );
  }, 30_000);

  // These cases replace the GUI source-text assertions that used to live in
  // tests/unit/gui-web/session-drawer-focus.test.ts (deleted) and the
  // source/CSS case of tests/unit/gui-web/transcript-scroller.test.ts (removed;
  // its two pure anchor cases remain).

  // Replacement for session-drawer-focus.test.ts: opening the mobile drawer
  // moves focus inside it, and Escape dismisses it.
  it("moves focus into the mobile session drawer and closes it on Escape", async () => {
    const mocked = await newPage({ viewport: { width: 390, height: 844 } });
    await installMockSocket(mocked);
    await installMockMarketState(mocked);
    await mocked.goto(`${guiUrl}/alerts`, { waitUntil: "networkidle" });

    const trigger = mocked.getByRole("button", { name: "Open sidebar" });
    await expectVisible(trigger);
    await trigger.click();

    const dialog = mocked.getByRole("dialog", { name: "Sessions" });
    await expectVisible(dialog);
    await mocked.waitForFunction(() => {
      const openDialog = document.querySelector('[role="dialog"]');
      return Boolean(openDialog?.contains(document.activeElement));
    });
    const focusedTag = await mocked.evaluate(() => document.activeElement?.tagName ?? "");
    expect(focusedTag).not.toBe("BODY");

    await mocked.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
  }, 30_000);

  // Regression guard for a fixed focus bug: the drawer opener is a plain button
  // rather than a Drawer.Trigger, so Radix/vaul alone left focus on <body>
  // after closing the mobile drawer. SessionDrawer now restores focus to the
  // opener via `returnFocusRef` in `onCloseAutoFocus`. The old source check
  // only asserted the open-side autoFocus and never covered this.
  it("returns focus to the mobile drawer trigger after Escape", async () => {
    const mocked = await newPage({ viewport: { width: 390, height: 844 } });
    await installMockSocket(mocked);
    await installMockMarketState(mocked);
    await mocked.goto(`${guiUrl}/alerts`, { waitUntil: "networkidle" });

    const trigger = mocked.getByRole("button", { name: "Open sidebar" });
    await expectVisible(trigger);
    await trigger.focus();
    await trigger.click();

    const dialog = mocked.getByRole("dialog", { name: "Sessions" });
    await expectVisible(dialog);
    await mocked.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });

    // Focus must return to the opener; before the fix this timed out with
    // focus left on <body>.
    await mocked.waitForFunction(
      () => {
        const active = document.activeElement;
        return (
          active instanceof HTMLElement && active.getAttribute("aria-label") === "Open sidebar"
        );
      },
      null,
      { timeout: 3_000 },
    );
  }, 30_000);

  it("keeps the Latest control as a real floating hit target over the transcript", async () => {
    const mocked = await newPage({ viewport: { width: 1024, height: 720 } });
    await installMockHttpBootstrap(mocked, { entries: longTranscriptEntries(44) });

    await mocked.goto(guiUrl, { waitUntil: "networkidle" });
    await mocked.waitForSelector("[data-chat-transcript]");
    await mocked.locator("[data-chat-transcript]").evaluate((element) => {
      element.scrollTop = 0;
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
    });

    const latest = mocked.getByRole("button", { name: "Jump to latest" });
    await expectVisible(latest);

    const geometry = await latest.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const wrapper = element.parentElement;
      // The Latest control floats in a sibling layer over the scroll viewport,
      // so it is not a descendant of [data-chat-transcript].
      const transcript = document.querySelector("[data-chat-transcript]");
      if (!wrapper || !transcript) throw new Error("Latest control is not over a transcript");
      const transcriptBox = transcript.getBoundingClientRect();
      const wrapperStyle = getComputedStyle(wrapper);
      const buttonStyle = getComputedStyle(element);
      const beforeStyle = getComputedStyle(element, "::before");
      return {
        height: rect.height,
        centerX: rect.left + rect.width / 2,
        centerY: rect.top + rect.height / 2,
        top: rect.top,
        transcriptTop: transcriptBox.top,
        transcriptBottom: transcriptBox.bottom,
        wrapperPosition: wrapperStyle.position,
        wrapperPointerEvents: wrapperStyle.pointerEvents,
        buttonPointerEvents: buttonStyle.pointerEvents,
        beforeTop: beforeStyle.top,
        beforeBottom: beforeStyle.bottom,
      };
    });

    // The pill floats over the transcript viewport instead of reserving a row.
    expect(geometry.wrapperPosition).toBe("absolute");
    expect(geometry.centerY).toBeGreaterThan(geometry.transcriptTop);
    expect(geometry.centerY).toBeLessThan(geometry.transcriptBottom);
    // Same 28px chrome as the hosted status pill, not a full-height row.
    expect(geometry.height).toBeGreaterThanOrEqual(26);
    expect(geometry.height).toBeLessThanOrEqual(30);
    // Only the pill takes pointer events so it never blocks transcript clicks.
    expect(geometry.wrapperPointerEvents).toBe("none");
    expect(geometry.buttonPointerEvents).toBe("auto");
    // The pseudo-element expands the real pointer target beyond the pill.
    expect(geometry.beforeTop).toBe("-6px");
    expect(geometry.beforeBottom).toBe("-6px");

    // Both the visible pill centre and the expanded target edge hit the pill.
    const hits = await mocked.evaluate(
      ({ centerX, centerY, top }) => {
        const at = (x: number, y: number) =>
          document.elementFromPoint(x, y)?.closest("button")?.getAttribute("aria-label") ?? "";
        return { centre: at(centerX, centerY), expandedEdge: at(centerX, top - 3) };
      },
      { centerX: geometry.centerX, centerY: geometry.centerY, top: geometry.top },
    );
    expect(hits.centre).toBe("Jump to latest");
    expect(hits.expandedEdge).toBe("Jump to latest");

    await latest.click();
    const nearBottom = await mocked.locator("[data-chat-transcript]").evaluate((element) => {
      return element.scrollHeight - element.scrollTop - element.clientHeight <= 48;
    });
    expect(nearBottom).toBe(true);
  }, 30_000);
});
