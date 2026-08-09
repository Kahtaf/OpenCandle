import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Browser, chromium, type Locator, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runOpenCandleSession } from "../harness/opencandle-runner.js";

const runGuiBrowser = process.env.OPENCANDLE_GUI_BROWSER === "1";
const guiUrl = process.env.OPENCANDLE_GUI_URL ?? "http://127.0.0.1:14567";
const parityPrompt = process.env.OPENCANDLE_GUI_TUI_PARITY_PROMPT ?? "analyze NVDA";

describe.skipIf(!runGuiBrowser)("GUI browser smoke", () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({
      executablePath: resolveChromiumExecutable(),
      headless: true,
    });
    page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  });

  afterAll(async () => {
    await browser?.close();
  });

  it("loads the app with session history and financial context", async () => {
    await page.goto(guiUrl, { waitUntil: "load" });

    await expectVisible(page.getByText("OpenCandle").first());
    await expectVisible(page.getByRole("button", { name: "New chat", exact: true }).first());
    await expectVisible(page.getByRole("button", { name: /Browse workflows and tools/ }).first());
  });

  it("renders a stock quote prompt and updates context", async () => {
    await page.goto(guiUrl, { waitUntil: "load" });
    await page
      .getByLabel("Message OpenCandle")
      .fill("Get the latest quote for NVDA. Show key fields briefly.");
    await page.getByRole("button", { name: "Send" }).click();

    await expectVisible(page.getByText("Stock Quote").first(), 45_000);
    await expectVisible(page.getByText("NVDA").first());
    await expectVisible(page.getByRole("button", { name: "Attach context" }));
  }, 60_000);

  it("renders options, filings, macro, and news tool cards", async () => {
    await page.goto(guiUrl, { waitUntil: "load" });

    await submitPrompt(page, "Show options chain for AAPL");
    await expectVisible(page.getByText("Options chain").first(), 45_000);
    await expectVisible(page.getByText("AAPL").first(), 45_000);
    await waitForRunIdle(page);

    await startNewChat(page);
    await submitPrompt(page, "Use get_sec_filings to show recent SEC filings for MSFT");
    await expectVisible(page.getByText("SEC filings").first(), 45_000);
    await expectVisible(page.getByText("MSFT").first(), 45_000);
    await waitForRunIdle(page);

    await startNewChat(page);
    await submitPrompt(page, "Use get_fear_greed to show the current market fear and greed index");
    await expectVisible(page.getByText("Fear & greed").first(), 45_000);
    await waitForRunIdle(page);

    await startNewChat(page);
    await submitPrompt(page, "Use search_web for latest TSLA financial news headlines");
    await expectVisible(page.getByText("Web search").first(), 45_000);
    await expectVisible(page.getByText("TSLA").first(), 45_000);
  }, 240_000);

  it("shows chat history on mobile", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(guiUrl, { waitUntil: "load" });
    await page.getByRole("button", { name: "Open sidebar" }).click();

    await expectVisible(page.getByRole("dialog", { name: "Sessions" }));
    await expectVisible(page.getByRole("textbox", { name: "Search" }));
  });

  it("captures desktop and mobile screenshots", async () => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(guiUrl, { waitUntil: "load" });
    const desktop = await page.screenshot({ fullPage: true });
    expect(desktop.byteLength).toBeGreaterThan(10_000);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Open sidebar" }).click();
    const mobile = await page.screenshot({ fullPage: true });
    expect(mobile.byteLength).toBeGreaterThan(10_000);
  });

  it("renders missing API-key onboarding in a browser", async () => {
    const mocked = await browser.newPage({ viewport: { width: 815, height: 938 } });
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
    await mocked.close();
  });

  it("lets users manage model keys from the composer selector", async () => {
    const mocked = await browser.newPage({ viewport: { width: 1024, height: 720 } });
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
    await mocked.close();
  });

  it("explains unavailable onboarding while setup access reconnects", async () => {
    const mocked = await browser.newPage({ viewport: { width: 1024, height: 720 } });
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
    await mocked.close();
  });

  it("keeps the composer focused on send and supports keyboard catalog controls", async () => {
    const mocked = await browser.newPage({ viewport: { width: 1024, height: 720 } });
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
    await mocked.close();
  }, 30_000);

  it("sends portfolio attachments through the shared chat request", async () => {
    const mocked = await browser.newPage({ viewport: { width: 1024, height: 720 } });
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

    await mocked.close();
  }, 30_000);

  it("autocompletes cashtags and opens entity chip popovers", async () => {
    const mocked = await browser.newPage({ viewport: { width: 1440, height: 960 } });
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
    await mocked.close();
  }, 30_000);

  it("reconnects stale GUI sockets when the browser returns to the foreground", async () => {
    const mocked = await browser.newPage({ viewport: { width: 1024, height: 720 } });
    await installMockSocket(mocked);

    await mocked.goto(guiUrl, { waitUntil: "networkidle" });
    await expectVisible(mocked.getByRole("button", { name: "Send message" }));

    await mocked.evaluate(() => window.__mockWebSocketInstances.at(-1).close());
    await expectVisible(mocked.getByText("Reconnecting to the GUI session."));

    await mocked.evaluate(() => window.dispatchEvent(new Event("focus")));

    await mocked.waitForFunction(() => window.__mockWebSocketInstances.length >= 2);
    await mocked.getByText("Reconnecting to the GUI session.").waitFor({ state: "detached" });
    await expect(mocked.getByLabel("Message OpenCandle").isEnabled()).resolves.toBe(true);
    await mocked.close();
  });

  it("collapses and restores the desktop sidebar", async () => {
    const mocked = await browser.newPage({ viewport: { width: 1024, height: 720 } });
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
    await mocked.close();
  });

  it("uses the sidebar app shell as market-state navigation", async () => {
    const mocked = await browser.newPage({ viewport: { width: 1024, height: 720 } });
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
    await mocked.getByRole("button", { name: "Add holding" }).click();
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
    await mocked.getByRole("button", { name: "Add holding" }).click();
    await mocked.getByRole("combobox", { name: "Search ticker or company" }).fill("Alcoa");
    const mobileAlcoaOption = mocked.getByRole("option", { name: /AA Alcoa Corp\./ });
    await expectVisible(mobileAlcoaOption);
    await expect(mobileAlcoaOption.evaluate(isPointerTarget)).resolves.toBe(true);
    await mobileAlcoaOption.click();
    await expectVisible(mocked.getByText("Selected AA"));
    await mocked.close();
  });

  it("keeps reconnecting market-state pages readable and disables mutations", async () => {
    const mocked = await browser.newPage({ viewport: { width: 1024, height: 720 } });
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
    await mocked.close();
  });

  it("keeps restored mobile tool timelines collapsed and manually openable", async () => {
    const mocked = await browser.newPage({ viewport: { width: 815, height: 938 } });
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
    await mocked.close();
  });

  it("closes an open tool drawer when navigating to another session", async () => {
    const mocked = await browser.newPage({ viewport: { width: 1024, height: 720 } });
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
    await mocked.close();
  });

  it("restores deep-linked transcript anchors and offers jump to latest", async () => {
    const mocked = await browser.newPage({ viewport: { width: 1024, height: 720 } });
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
    await mocked.close();
  });

  it("shows configured providers with a masked hint and a replace-only key input", async () => {
    const mocked = await browser.newPage({ viewport: { width: 1024, height: 720 } });
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
    await mocked.close();
  });

  it("opens session context menu and sends rename/delete actions", async () => {
    const mocked = await browser.newPage({ viewport: { width: 1024, height: 720 } });
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
    await mocked.close();
  });

  it("streams assistant text incrementally and keeps specialized tool cards", async () => {
    const mocked = await browser.newPage({ viewport: { width: 1024, height: 720 } });
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
    await mocked.close();
  }, 30_000);

  it("shows the submitted user message before delayed server run events", async () => {
    const mocked = await browser.newPage({ viewport: { width: 1024, height: 720 } });
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
    await expectVisible(mocked.getByText("Working"));
    await expect(mocked.getByText("Delayed answer").count()).resolves.toBe(0);

    await mocked.evaluate(() => window.__releaseDelayedRun?.());
    await expectVisible(mocked.getByText("Delayed answer"));
    await mocked.close();
  }, 30_000);

  it("routes a home prompt to the server-emitted run session", async () => {
    const mocked = await browser.newPage({ viewport: { width: 1024, height: 720 } });
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
    await mocked.close();
  }, 30_000);

  it("falls back to HTTP chat runs when WebSocket is unavailable", async () => {
    const mocked = await browser.newPage({ viewport: { width: 1024, height: 720 } });
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
    await mocked.close();
  }, 30_000);

  it("disables empty-state suggestions while home waits for a fresh session", async () => {
    const mocked = await browser.newPage({ viewport: { width: 1024, height: 720 } });
    await installMockSocket(mocked, {
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
      window.fetch = () => {
        window.__fetchCount += 1;
        return Promise.resolve(new Response("", { status: 204 }));
      };
    });

    await mocked.goto(guiUrl, { waitUntil: "networkidle" });
    const baselineFetchCount = await mocked.evaluate(() => window.__fetchCount);
    const suggestion = mocked.getByRole("button", { name: "What is NVDA trading at?" });
    await expect(suggestion.isDisabled()).resolves.toBe(true);
    await suggestion.click({ force: true });
    await expect(mocked.evaluate(() => window.__fetchCount)).resolves.toBe(baselineFetchCount);
    await mocked.close();
  }, 30_000);

  it("keeps two browser clients on one coordinated session without role wording", async () => {
    const first = await browser.newPage({ viewport: { width: 1024, height: 720 } });
    const second = await browser.newPage({ viewport: { width: 1024, height: 720 } });
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
    await first.close();
    await second.close();
  }, 30_000);

  it("drives two routed sessions concurrently and stops only the targeted session", async () => {
    const first = await browser.newPage({ viewport: { width: 1024, height: 720 } });
    const second = await browser.newPage({ viewport: { width: 1024, height: 720 } });
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
    await expectVisible(first.getByText("Stopped response."));
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
    await first.close();
    await second.close();
  }, 30_000);

  // Previously it.fails for the GUI chat-run settle-timeout defect (fixed:
  // waitForSessionTurnSettlement now detects stall instead of capping total
  // runtime). it.fails also passed on ANY error — credential loss, dead
  // server, 410 — so it could not distinguish the known gap from breakage.
  it("keeps opencandle trace and dashboard projection in parity with the TUI path", async () => {
    await page.setViewportSize({ width: 1440, height: 960 });

    const tui = await runOpenCandleSession({
      prompt: parityPrompt,
      cwd: process.cwd(),
      timeoutMs: 900_000,
    });
    const tuiSequence = opencandleEntrySequence(tui.agentTrace.customEntries ?? []);
    expect(tuiSequence).toContain("opencandle-analyst-step");

    await page.goto(guiUrl, { waitUntil: "networkidle" });
    const newSession = await page.evaluate(async () => {
      const response = await fetch("/api/session/new", { method: "POST" });
      if (!response.ok) throw new Error(`new session failed: ${response.status}`);
      return response.json();
    });
    const sessionId = stringValue(recordValue(newSession).sessionId);
    expect(sessionId).toBeTruthy();

    const guiRunEvents = await runGuiChat(page, sessionId, parityPrompt);
    const guiSnapshot = await fetchGuiSessionSnapshot(page, sessionId);
    const guiEntries = arrayValue(recordValue(guiSnapshot).entries);
    const guiCustomEntries = guiEntries.filter(isOpenCandleCustomEntry);
    const guiSequence = opencandleEntrySequence(guiCustomEntries);
    const runEventTypes = guiRunEvents.map((event) => recordValue(event).type);
    const diagnosticScreenshot = await page.screenshot({ fullPage: true });
    writeParityEvidence("gui-tui-parity-preassert.json", {
      prompt: parityPrompt,
      sessionId,
      tuiSequence,
      guiSequence,
      guiEntryCount: guiEntries.length,
      guiCustomEntryCount: guiCustomEntries.length,
      runEvents: runEventTypes,
    });
    writeParityEvidence("gui-tui-parity-preassert.png", diagnosticScreenshot);

    expect(runEventTypes).toContain("run.completed");
    // TUI and GUI are two independent live model runs; exact entry-sequence
    // equality flakes on model nondeterminism (disclaimer counts, step
    // interleaving). The parity contract is structural: both paths emit the
    // same set of opencandle pipeline entry types, and both produce a full
    // analyst roster. opencandle-turn-gap is excluded — it records provider
    // fallbacks, which depend on live data availability at run time, not on
    // which surface dispatched the run.
    const RUN_CONDITIONAL_TYPES = new Set(["opencandle-turn-gap"]);
    const pipelineTypes = (sequence: string[]) =>
      new Set(sequence.filter((customType) => !RUN_CONDITIONAL_TYPES.has(customType)));
    expect(pipelineTypes(guiSequence)).toEqual(pipelineTypes(tuiSequence));

    const analystStageCount = guiCustomEntries.filter((entry) => {
      if (!isOpenCandleCustomEntry(entry)) return false;
      const record = recordValue(entry);
      if (stringValue(record.customType) !== "opencandle-analyst-step") return false;
      const stage = stringValue(recordValue(record.data).stage) ?? "";
      return stage.startsWith("analyst_");
    }).length;
    expect(analystStageCount).toBeGreaterThan(0);

    const dashboard = recordValue(recordValue(guiSnapshot).state);
    // FINDING (2026-07-04): the /analyze transform path emits no
    // "opencandle-workflow" entry (only router-dispatch paths in
    // src/pi/opencandle-extension.ts do), so the projector's analysis
    // tracking — activeAnalyses during the run, recentResearch after —
    // never sees comprehensive analysis at all. Emitting that entry is an
    // ask-first extension change; until then the truthful projection
    // contract for a completed /analyze run is "no tracked analyses", and
    // the analystsDone-from-entries math is owned by the projector unit
    // tests over real entry shapes.
    expect(arrayValue(dashboard.activeAnalyses)).toHaveLength(0);
    const recentResearch = arrayValue(dashboard.recentResearch).map(recordValue);
    expect(
      recentResearch.find((entry) => stringValue(entry.workflow) === "comprehensive_analysis"),
    ).toBeUndefined();

    const screenshot = await page.screenshot({ fullPage: true });
    writeParityEvidence("gui-tui-parity.json", {
      prompt: parityPrompt,
      sessionId,
      tuiSequence,
      guiSequence,
      analystStageCount,
      dashboardActiveAnalyses: arrayValue(dashboard.activeAnalyses),
      dashboardRecentResearch: recentResearch,
      runEvents: guiRunEvents.map((event) => recordValue(event).type),
    });
    writeParityEvidence("gui-tui-parity-desktop.png", screenshot);
  }, 1_800_000);
});

function resolveChromiumExecutable(): string {
  const configured = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (configured) return configured;
  const bundled = chromium.executablePath();
  if (existsSync(bundled)) return bundled;
  const macChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (existsSync(macChrome)) return macChrome;
  return bundled;
}

async function submitPrompt(page: Page, prompt: string): Promise<void> {
  await waitForRunIdle(page);
  await page.getByLabel("Message OpenCandle").fill(prompt);
  const sendButton = page.getByRole("button", { name: "Send" });
  await page.waitForFunction(
    () => {
      const button = document.querySelector('button[aria-label="Send message"]');
      return button instanceof HTMLButtonElement && !button.disabled;
    },
    null,
    { timeout: 45_000 },
  );
  await sendButton.click();
}

async function startNewChat(page: Page): Promise<void> {
  await waitForRunIdle(page);
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expectVisible(page.getByRole("heading", { name: "What are we watching?" }));
}

async function expectVisible(locator: Locator, timeout = 5_000): Promise<void> {
  await locator.waitFor({ state: "visible", timeout });
  await expect(locator.isVisible()).resolves.toBe(true);
}

function isPointerTarget(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  return (
    document
      .elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      ?.closest('[role="option"]') === element
  );
}

async function waitForRunIdle(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const panel = document.querySelector("[data-run-state]");
      return panel?.getAttribute("data-run-state") === "ready";
    },
    null,
    { timeout: 90_000 },
  );
}

function hasScrollableAncestor(element: Element): boolean {
  let current = element.parentElement;
  while (current) {
    const style = window.getComputedStyle(current);
    if (style.overflowY === "auto" || style.overflowY === "scroll") return true;
    current = current.parentElement;
  }
  return false;
}

async function runGuiChat(
  page: Page,
  sessionId: string,
  prompt: string,
): Promise<Record<string, unknown>[]> {
  return page.evaluate(
    async ({ targetSessionId, targetPrompt }) => {
      const response = await fetch(`/api/sessions/${encodeURIComponent(targetSessionId)}/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: targetPrompt,
          sessionId: targetSessionId,
          actionId: `gui-tui-parity-${Date.now()}`,
        }),
      });
      if (!response.ok) {
        throw new Error(`chat run failed: ${response.status} ${await response.text()}`);
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("chat run response did not include an SSE body");
      const decoder = new TextDecoder();
      const events: Record<string, unknown>[] = [];
      let buffer = "";
      const parseEventChunk = (chunk: string) => {
        const line = chunk.split("\n").find((candidate) => candidate.startsWith("data: "));
        if (line) events.push(JSON.parse(line.slice("data: ".length)));
      };
      while (true) {
        const { value, done } = await reader.read();
        if (value) {
          buffer += decoder.decode(value, { stream: !done });
          const chunks = buffer.split("\n\n");
          buffer = chunks.pop() ?? "";
          for (const chunk of chunks) {
            parseEventChunk(chunk);
          }
        }
        if (done) break;
      }
      if (buffer.trim()) parseEventChunk(buffer);
      return events;
    },
    { targetSessionId: sessionId, targetPrompt: prompt },
  );
}

async function fetchGuiSessionSnapshot(page: Page, sessionId?: string): Promise<unknown> {
  return page.evaluate(async (targetSessionId) => {
    // Session-addressed bootstrap: the plain /api/bootstrap returns the
    // server's focused session, not the session the run was dispatched to.
    const path = targetSessionId
      ? `/api/sessions/${encodeURIComponent(targetSessionId)}/bootstrap`
      : "/api/bootstrap";
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`session bootstrap failed: ${response.status} ${await response.text()}`);
    }
    const bootstrap = await response.json();
    return bootstrap.snapshot;
  }, sessionId);
}

function opencandleEntrySequence(entries: unknown[]): string[] {
  return entries.map((entry) => String(recordValue(entry).customType));
}

function isOpenCandleCustomEntry(entry: unknown): boolean {
  const record = recordValue(entry);
  return record.type === "custom" && stringValue(record.customType)?.startsWith("opencandle-");
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function writeParityEvidence(fileName: string, content: unknown): void {
  const evidenceDir = process.env.OPENCANDLE_GUI_TUI_PARITY_EVIDENCE_DIR;
  if (!evidenceDir) return;
  mkdirSync(evidenceDir, { recursive: true });
  const path = join(evidenceDir, fileName);
  if (content instanceof Uint8Array) {
    writeFileSync(path, content);
    return;
  }
  writeFileSync(path, `${JSON.stringify(content, null, 2)}\n`);
}

function toolRunEntries(toolCallId: string, symbol: string) {
  return [
    {
      type: "message",
      id: `assistant-${symbol.toLowerCase()}-tool`,
      timestamp: new Date().toISOString(),
      message: {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: toolCallId,
            name: "get_stock_quote",
            arguments: { symbol },
          },
        ],
      },
    },
    {
      type: "message",
      id: `tool-result-${symbol.toLowerCase()}`,
      timestamp: new Date().toISOString(),
      message: {
        role: "toolResult",
        toolCallId,
        toolName: "get_stock_quote",
        content: `${symbol} quote`,
        details: { symbol },
      },
    },
  ];
}

function longTranscriptEntries(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const turn = index + 1;
    const role = turn % 2 === 0 ? "assistant" : "user";
    const id = `${role}-${turn}`;
    return {
      type: "message",
      id,
      timestamp: new Date().toISOString(),
      message: {
        role,
        content:
          role === "user"
            ? `User turn ${turn}: compare AAPL, MSFT, and NVDA with enough detail for scrolling.`
            : `Assistant turn ${turn}: here is a concise market summary with valuation, momentum, risk, and data quality notes.`,
      },
    };
  });
}

async function installMockHttpBootstrap(
  page: Page,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await page.addInitScript((mockOverrides) => {
    const bootSessionId = mockOverrides.sessionId ?? "mock-session";
    window.WebSocket = function BrokenWebSocket() {
      throw new TypeError("WebSocket is not a constructor");
    };
    window.fetch = (input) => {
      const rawUrl = typeof input === "string" ? input : input.url;
      const url = new URL(rawUrl, window.location.origin);
      if (url.pathname === "/api/bootstrap") {
        const entries = mockOverrides.entries ?? [];
        return Promise.resolve(
          new Response(
            JSON.stringify({
              role: mockOverrides.role ?? "writer",
              supportsSessionActions: mockOverrides.supportsSessionActions ?? false,
              sessionId: bootSessionId,
              sessions: mockOverrides.sessions ?? [],
              catalog: mockOverrides.catalog ?? { tools: [], workflows: [], providers: [] },
              modelSetup: mockOverrides.modelSetup ?? {
                requirement: "ready",
                providers: [],
                availableModels: [],
              },
              askUserPrompts: mockOverrides.askUserPrompts ?? [],
              snapshot: snapshotPayload(bootSessionId, entries, mockOverrides),
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          ),
        );
      }
      const match = url.pathname.match(/^\/api\/sessions\/([^/]+)\/bootstrap$/);
      if (match) {
        const sessionId = decodeURIComponent(match[1]);
        const snapshot = mockOverrides.sessionBootstraps?.[sessionId];
        if (!snapshot) return Promise.resolve(new Response("Not found", { status: 404 }));
        const entries = snapshot.entries ?? [];
        return Promise.resolve(
          new Response(JSON.stringify(snapshotPayload(sessionId, entries, snapshot)), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      return Promise.resolve(new Response("Not found", { status: 404 }));
    };

    function snapshotPayload(sessionId, entries, source) {
      return {
        sessionId,
        catalog: source.catalog ?? { tools: [], workflows: [], providers: [] },
        modelSetup: source.modelSetup ?? {
          requirement: "ready",
          providers: [],
          availableModels: [],
        },
        entries,
        events: source.events ?? entriesToEvents(entries, sessionId),
        state: source.state ?? {
          watchlist: [],
          activeAnalyses: [],
          recentResearch: [],
          dataQuality: { softGaps: [], hardSkips: [] },
        },
      };
    }

    function entriesToEvents(entries, fallbackSessionId) {
      let seq = 1;
      const events = [];
      const seenToolCalls = new Set();
      for (const entry of entries) {
        const sessionId = entry.sessionId ?? fallbackSessionId;
        if (entry.type !== "message") continue;
        const message = entry.message || {};
        if (message.role === "user" || message.role === "assistant") {
          events.push({
            type: "message.created",
            sessionId,
            messageId: entry.id,
            role: message.role,
            seq: seq++,
          });
          const content = [];
          for (const part of Array.isArray(message.content)
            ? message.content
            : [{ type: "text", text: String(message.content || "") }]) {
            if (part.type === "toolCall") {
              seenToolCalls.add(part.id);
              content.push({ type: "tool", toolCallId: part.id });
              events.push({
                type: "tool.started",
                sessionId,
                toolCallId: part.id,
                messageId: entry.id,
                name: part.name,
                input: part.arguments || {},
                seq: seq++,
              });
            } else {
              content.push(part);
            }
          }
          events.push({
            type: "message.completed",
            sessionId,
            messageId: entry.id,
            content,
            seq: seq++,
          });
        }
        if (message.role === "toolResult") {
          const toolCallId = message.toolCallId || `tool-${entry.id}`;
          if (!seenToolCalls.has(toolCallId)) {
            events.push({
              type: "tool.started",
              sessionId,
              toolCallId,
              messageId: entry.id,
              name: message.toolName || "tool",
              input: message.details?.args || {},
              seq: seq++,
            });
          }
          events.push({
            type: message.isError ? "tool.failed" : "tool.completed",
            sessionId,
            toolCallId,
            ...(message.isError
              ? {
                  error: {
                    message: String(message.content || ""),
                    details: message.details,
                  },
                }
              : {
                  output: {
                    content: [{ type: "text", text: String(message.content || "") }],
                    details: message.details,
                    isError: Boolean(message.isError),
                  },
                }),
            seq: seq++,
          });
        }
      }
      return events;
    }
  }, overrides);
}

async function installMockSocket(
  page: Page,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await page.addInitScript((mockOverrides) => {
    const bootSessionId = mockOverrides.sessionId ?? "mock-session";
    class MockWebSocket extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      readyState = MockWebSocket.OPEN;
      onopen = null;
      onmessage = null;
      onclose = null;
      onerror = null;
      sessions = [];

      constructor() {
        super();
        window.__mockWebSocketInstances = window.__mockWebSocketInstances || [];
        window.__mockWebSocketInstances.push(this);
        this.sessions = [...(mockOverrides.sessions ?? [])];
        setTimeout(() => {
          this.onopen?.(new Event("open"));
          this.emit({
            type: "boot",
            role: mockOverrides.role ?? "writer",
            supportsSessionActions: mockOverrides.supportsSessionActions ?? true,
            sessionId: bootSessionId,
            catalog: mockOverrides.catalog ?? { tools: [], workflows: [], providers: [] },
            modelSetup: mockOverrides.modelSetup ?? {
              requirement: "ready",
              providers: [],
              availableModels: [],
            },
          });
          this.emit({
            type: "state.snapshot",
            sessionId: bootSessionId,
            state: mockOverrides.dashboard ?? {
              watchlist: [],
              activeAnalyses: [],
              recentResearch: [],
              dataQuality: { softGaps: [], hardSkips: [] },
            },
            entries: mockOverrides.entries ?? [],
            events:
              mockOverrides.events ?? entriesToEvents(mockOverrides.entries ?? [], bootSessionId),
          });
          this.emit({ type: "sessions", sessions: this.sessions });
        }, 0);
      }

      send(message) {
        window.__wsMessages = window.__wsMessages || [];
        const parsed = JSON.parse(message);
        window.__wsMessages.push(parsed);
        if (parsed.type === "session.rename") {
          this.sessions = this.sessions.map((session) =>
            session.path === parsed.path ? { ...session, name: parsed.name } : session,
          );
          this.emit({ type: "sessions", sessions: this.sessions });
        }
        if (parsed.type === "session.delete") {
          this.sessions = this.sessions.filter((session) => session.path !== parsed.path);
          this.emit({ type: "sessions", sessions: this.sessions });
        }
        if (parsed.type === "model.setup.select_model") {
          this.emit({
            type: "model.setup",
            modelSetup: {
              ...(mockOverrides.modelSetup ?? {}),
              currentModel: `${parsed.provider}/${parsed.modelId}`,
            },
          });
        }
      }

      close() {
        this.readyState = MockWebSocket.CLOSED;
        this.onclose?.(new CloseEvent("close"));
      }

      emit(payload) {
        const event = new MessageEvent("message", { data: JSON.stringify(payload) });
        this.dispatchEvent(event);
        this.onmessage?.(event);
      }
    }

    function entriesToEvents(entries, fallbackSessionId = bootSessionId) {
      let seq = 1;
      const events = [];
      const seenToolCalls = new Set();
      for (const entry of entries) {
        const sessionId = entry.sessionId ?? fallbackSessionId;
        if (entry.type === "custom_message") {
          events.push({
            type: "custom.message",
            sessionId,
            messageId: entry.id,
            customType: entry.customType || "custom",
            content: normalizeContent(entry.content),
            seq: seq++,
          });
          continue;
        }
        if (entry.type !== "message") continue;
        const message = entry.message || {};
        if (message.role === "user") {
          events.push({
            type: "message.created",
            sessionId,
            messageId: entry.id,
            role: "user",
            seq: seq++,
          });
          events.push({
            type: "message.completed",
            sessionId,
            messageId: entry.id,
            content: normalizeContent(message.content),
            seq: seq++,
          });
          continue;
        }
        if (message.role === "assistant") {
          events.push({
            type: "message.created",
            sessionId,
            messageId: entry.id,
            role: "assistant",
            seq: seq++,
          });
          const content = [];
          for (const part of Array.isArray(message.content)
            ? message.content
            : normalizeContent(message.content)) {
            if (part.type === "toolCall") {
              seenToolCalls.add(part.id);
              content.push({ type: "tool", toolCallId: part.id });
              events.push({
                type: "tool.started",
                sessionId,
                toolCallId: part.id,
                messageId: entry.id,
                name: part.name,
                input: part.arguments || {},
                seq: seq++,
              });
            } else {
              content.push(part);
            }
          }
          events.push({
            type: "message.completed",
            sessionId,
            messageId: entry.id,
            content,
            seq: seq++,
          });
          continue;
        }
        if (message.role === "toolResult") {
          const toolCallId = message.toolCallId || `tool-${entry.id}`;
          if (!seenToolCalls.has(toolCallId)) {
            events.push({
              type: "tool.started",
              sessionId,
              toolCallId,
              messageId: entry.id,
              name: message.toolName || "tool",
              input: message.details?.args || {},
              seq: seq++,
            });
          }
          events.push({
            type: message.isError ? "tool.failed" : "tool.completed",
            sessionId,
            toolCallId,
            ...(message.isError
              ? { error: { message: textContent(message.content), details: message.details } }
              : {
                  output: {
                    content: normalizeContent(message.content),
                    details: message.details,
                    isError: Boolean(message.isError),
                  },
                }),
            seq: seq++,
          });
        }
      }
      return events;
    }

    function normalizeContent(content) {
      if (Array.isArray(content)) return content;
      return [{ type: "text", text: String(content || "") }];
    }

    function textContent(content) {
      return normalizeContent(content)
        .map((part) => part.text || "")
        .join("");
    }

    window.WebSocket = MockWebSocket;
  }, overrides);
}

async function installMockMarketState(
  page: Page,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await page.addInitScript((marketStateOverrides) => {
    const emptyMarketState = {
      instrumentCandidates: [],
      watchlist: [],
      portfolio: [],
      alerts: [],
      alertEvents: [],
      alertCheckRuns: [],
      reportTemplates: [],
      reportRuns: [],
      runnerLease: null,
      notifications: [],
      notificationDeliveryAttempts: [],
      quoteSnapshot: null,
    };
    const marketState = { ...emptyMarketState, ...marketStateOverrides };
    window.fetch = (input) => {
      const url = typeof input === "string" ? input : input.url;
      const parsedUrl = new URL(url, window.location.href);
      if (parsedUrl.pathname === "/api/instruments/search") {
        const query = parsedUrl.searchParams.get("q") || "";
        return Promise.resolve(
          new Response(
            JSON.stringify({
              query,
              candidates: marketState.instrumentCandidates,
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          ),
        );
      }
      if (parsedUrl.pathname === "/api/market-state") {
        const {
          instrumentCandidates: _instrumentCandidates,
          quoteSnapshot,
          ...snapshot
        } = marketState;
        return Promise.resolve(
          new Response(JSON.stringify(snapshot), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      if (parsedUrl.pathname === "/api/market-state/quotes") {
        return Promise.resolve(
          new Response(
            JSON.stringify(
              marketState.quoteSnapshot ?? {
                watchlistQuotes: [],
                portfolioQuotes: [],
                portfolioSummary: null,
              },
            ),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          ),
        );
      }
      if (parsedUrl.pathname === "/api/chat/run") {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            const send = (payload) =>
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
            send({ type: "run.started", runId: "mock-run", sessionId: "mock-session", seq: 1 });
            send({ type: "run.completed", runId: "mock-run", sessionId: "mock-session", seq: 2 });
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
      return Promise.resolve(new Response("Not found", { status: 404, statusText: "Not found" }));
    };
  }, overrides);
}

async function installTwoClientCoordinatorMock(page: Page, sessionId: string): Promise<void> {
  await page.addInitScript((mockSessionId) => {
    window.__coordinatedRequests = [];
    window.WebSocket = function BrokenWebSocket() {
      throw new TypeError("WebSocket is not a constructor");
    };
    window.fetch = async (input, init) => {
      const rawUrl = typeof input === "string" ? input : input.url;
      const url = new URL(rawUrl, window.location.origin);
      if (url.pathname === "/api/bootstrap" || url.pathname.endsWith("/bootstrap")) {
        return jsonResponse({
          role: "writer",
          supportsSessionActions: true,
          sessionId: mockSessionId,
          sessions: [],
          catalog: { tools: [], workflows: [], providers: [] },
          modelSetup: { requirement: "ready", providers: [], availableModels: [] },
          askUserPrompts: [],
          coordination: { sessionId: mockSessionId, status: "ready" },
          snapshot: {
            sessionId: mockSessionId,
            entries: [],
            events: [],
            state: {
              watchlist: [],
              activeAnalyses: [],
              recentResearch: [],
              dataQuality: { softGaps: [], hardSkips: [] },
            },
          },
        });
      }
      if (url.pathname === `/api/sessions/${mockSessionId}/runs`) {
        const body = JSON.parse(String(init?.body ?? "{}"));
        window.__coordinatedRequests.push({
          url: url.pathname,
          prompt: body.prompt,
          actionId: body.actionId,
        });
        if (body.prompt === "Second browser prompt") {
          return jsonResponse(
            {
              code: "session_busy",
              error: "OpenCandle is still working in this session. Try again when it finishes.",
            },
            409,
          );
        }
        const encoder = new TextEncoder();
        return new Response(
          new ReadableStream({
            start(controller) {
              const send = (event) => {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
              };
              send({ type: "run.started", sessionId: mockSessionId, runId: "run-1", seq: 1 });
              send({
                type: "message.completed",
                sessionId: mockSessionId,
                messageId: "assistant-1",
                role: "assistant",
                content: [{ type: "text", text: "First browser answer" }],
                seq: 2,
              });
              send({ type: "run.completed", sessionId: mockSessionId, runId: "run-1", seq: 3 });
              controller.close();
            },
          }),
          {
            status: 200,
            headers: { "content-type": "text/event-stream; charset=utf-8" },
          },
        );
      }
      return new Response("Not found", { status: 404 });
    };

    function jsonResponse(payload, status = 200) {
      return Promise.resolve(
        new Response(JSON.stringify(payload), {
          status,
          headers: { "content-type": "application/json" },
        }),
      );
    }
  }, sessionId);
}

async function installConcurrentSessionRunMock(
  page: Page,
  options: { sessionId: string; prompt: string; holdOpen: boolean; answer: string },
): Promise<void> {
  await page.addInitScript((mockOptions) => {
    window.__concurrentSessionRequests = [];
    window.WebSocket = function BrokenWebSocket() {
      throw new TypeError("WebSocket is not a constructor");
    };
    window.fetch = async (input, init = {}) => {
      const rawUrl = typeof input === "string" ? input : input.url;
      const url = new URL(rawUrl, window.location.origin);
      if (url.pathname === "/api/bootstrap" || url.pathname.endsWith("/bootstrap")) {
        return jsonResponse(buildBootstrap(mockOptions.sessionId));
      }
      if (url.pathname === `/api/sessions/${mockOptions.sessionId}/runs`) {
        const body = JSON.parse(String(init.body ?? "{}"));
        const request = {
          sessionId: body.sessionId,
          prompt: body.prompt,
          actionId: body.actionId,
          aborted: false,
        };
        window.__concurrentSessionRequests.push(request);
        const encoder = new TextEncoder();
        return new Response(
          new ReadableStream({
            start(controller) {
              init.signal?.addEventListener("abort", () => {
                request.aborted = true;
                controller.error(new DOMException("Aborted", "AbortError"));
              });
              const send = (event) =>
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
              send({
                type: "run.started",
                sessionId: mockOptions.sessionId,
                runId: "run-1",
                seq: 1,
              });
              if (mockOptions.holdOpen) return;
              send({
                type: "message.completed",
                sessionId: mockOptions.sessionId,
                messageId: "assistant-1",
                role: "assistant",
                content: [{ type: "text", text: mockOptions.answer }],
                seq: 2,
              });
              send({
                type: "run.completed",
                sessionId: mockOptions.sessionId,
                runId: "run-1",
                seq: 3,
              });
              controller.close();
            },
          }),
          {
            status: 200,
            headers: { "content-type": "text/event-stream; charset=utf-8" },
          },
        );
      }
      if (url.pathname === "/api/market-state/quotes") {
        return jsonResponse({ watchlistQuotes: [], portfolioQuotes: [], portfolioSummary: null });
      }
      return new Response("Not found", { status: 404 });
    };

    function buildBootstrap(sessionId) {
      return {
        role: "writer",
        supportsSessionActions: true,
        sessionId,
        sessions: [{ id: sessionId, name: sessionId, path: `${sessionId}.jsonl` }],
        catalog: { tools: [], workflows: [], providers: [] },
        modelSetup: { requirement: "ready", providers: [], availableModels: [] },
        askUserPrompts: [],
        coordination: { sessionId, status: "ready" },
        snapshot: {
          sessionId,
          entries: [],
          events: [],
          state: {
            watchlist: [],
            activeAnalyses: [],
            recentResearch: [],
            dataQuality: { softGaps: [], hardSkips: [] },
          },
        },
      };
    }

    function jsonResponse(payload, status = 200) {
      return Promise.resolve(
        new Response(JSON.stringify(payload), {
          status,
          headers: { "content-type": "application/json" },
        }),
      );
    }
  }, options);
}
