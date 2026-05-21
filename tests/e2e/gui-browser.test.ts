import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Locator, type Page } from "playwright-core";

const runGuiBrowser = process.env.OPENCANDLE_GUI_BROWSER === "1";
const guiUrl = process.env.OPENCANDLE_GUI_URL ?? "http://127.0.0.1:14567";

describe.skipIf(!runGuiBrowser)("GUI browser smoke", () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({
      executablePath: chromium.executablePath(),
      headless: true,
    });
    page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  });

  afterAll(async () => {
    await browser?.close();
  });

  it("loads the app with session history and financial context", async () => {
    await page.goto(guiUrl, { waitUntil: "networkidle" });

    await expectVisible(page.getByText("OpenCandle").first());
    await expectVisible(page.getByRole("button", { name: "New chat" }).first());
    await expectVisible(page.getByRole("button", { name: "Open context" }).first());
  });

  it("renders a stock quote prompt and updates context", async () => {
    await page.goto(guiUrl, { waitUntil: "networkidle" });
    await page.getByLabel("Message OpenCandle").fill("Get the latest quote for NVDA. Show key fields briefly.");
    await page.getByRole("button", { name: "Send" }).click();

    await expectVisible(page.getByText("Stock Quote").first(), 45_000);
    await expectVisible(page.getByText("NVDA").first());
    await page.getByRole("button", { name: "Open context" }).click();
    await expectVisible(page.getByRole("dialog", { name: "Context" }));
    await expectVisible(page.getByText("Recent quotes"));
  }, 60_000);

  it("renders options, filings, macro, and news tool cards", async () => {
    await page.goto(guiUrl, { waitUntil: "networkidle" });

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
  }, 120_000);

  it("shows chat history on mobile", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(guiUrl, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Open sidebar" }).click();

    await expectVisible(page.getByRole("dialog", { name: "Sessions" }));
    await expectVisible(page.getByRole("textbox", { name: "Search" }));
  });

  it("captures desktop and mobile screenshots", async () => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(guiUrl, { waitUntil: "networkidle" });
    const desktop = await page.screenshot({ fullPage: true });
    expect(desktop.byteLength).toBeGreaterThan(10_000);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Open sidebar" }).click();
    const mobile = await page.screenshot({ fullPage: true });
    expect(mobile.byteLength).toBeGreaterThan(10_000);
  });

  it("renders missing API-key onboarding in a browser", async () => {
    const mocked = await browser.newPage({ viewport: { width: 1024, height: 720 } });
    await installMockSocket(mocked, {
      modelSetup: {
        requirement: "needs_api_key",
        providers: [
          { id: "google", label: "Google Gemini", envVar: "GEMINI_API_KEY", defaultModel: "gemini-2.5-flash", signupUrl: "https://aistudio.google.com/app/apikey" },
        ],
        availableModels: [],
      },
    });

    await mocked.goto(guiUrl, { waitUntil: "networkidle" });

    await expectVisible(mocked.getByText("Connect an AI model"));
    await expectVisible(mocked.getByLabel("API key"));
    await expectVisible(mocked.getByRole("button", { name: "Save key" }));
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
          message: { role: "assistant", content: [{ type: "text", text: "Reusable assistant text" }] },
        },
      ],
    });

    await mocked.goto(guiUrl, { waitUntil: "networkidle" });
    await expectVisible(mocked.getByRole("button", { name: "Send message" }));
    await expect(mocked.getByRole("button", { name: "Stop response" }).count()).resolves.toBe(0);
    await expect(mocked.getByRole("button", { name: "Retry last prompt" }).count()).resolves.toBe(0);
    await expect(mocked.getByRole("button", { name: "Copy latest assistant response" }).count()).resolves.toBe(0);

    await mocked.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
    await expectVisible(mocked.getByRole("dialog", { name: "Catalog" }));
    await mocked.keyboard.press("Escape");
    await mocked.getByRole("dialog", { name: "Catalog" }).waitFor({ state: "detached" });
    await mocked.close();
  }, 30_000);

  it("collapses and restores the desktop sidebar", async () => {
    const mocked = await browser.newPage({ viewport: { width: 1024, height: 720 } });
    await installMockSocket(mocked);

    await mocked.goto(guiUrl, { waitUntil: "networkidle" });
    await expectVisible(mocked.getByRole("button", { name: "New chat" }));
    await mocked.getByRole("button", { name: "Collapse sidebar" }).click();
    await mocked.getByRole("button", { name: "New chat" }).waitFor({ state: "detached" });
    await expectVisible(mocked.getByRole("button", { name: "Expand sidebar" }));
    await mocked.getByRole("button", { name: "Expand sidebar" }).click();
    await expectVisible(mocked.getByRole("button", { name: "New chat" }));
    await mocked.close();
  });

  it("prefills provider config keys masked and can reveal them", async () => {
    const mocked = await browser.newPage({ viewport: { width: 1024, height: 720 } });
    await installMockSocket(mocked, {
      catalog: {
        tools: [],
        workflows: [],
        providers: [{
          id: "fred",
          displayName: "FRED",
          source: "file",
          status: "Configured",
          apiKey: "fred-file-key",
          envVar: "FRED_API_KEY",
          unlocks: ["interest rates"],
          fallbackDescription: null,
          signupUrl: "https://fredaccount.stlouisfed.org/apikeys",
          instructionsHint: "Free, about 30 seconds",
        }],
      },
    });

    await mocked.goto(guiUrl, { waitUntil: "networkidle" });
    await mocked.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
    await mocked.getByRole("button", { name: /Providers/ }).click();
    await mocked.getByRole("button", { name: /FRED/ }).click();

    const input = mocked.getByRole("textbox", { name: "API key" });
    await expect(input.inputValue()).resolves.toBe("fred-file-key");
    await expect(input.getAttribute("type")).resolves.toBe("password");

    await mocked.getByRole("button", { name: "Show API key" }).click();
    await expect(input.getAttribute("type")).resolves.toBe("text");
    await mocked.getByRole("button", { name: "Hide API key" }).click();
    await expect(input.getAttribute("type")).resolves.toBe("password");
    await mocked.close();
  });

  it("opens session context menu and sends rename/delete actions", async () => {
    const mocked = await browser.newPage({ viewport: { width: 1024, height: 720 } });
    await installMockSocket(mocked, {
      sessions: [{
        id: "session-1",
        path: "/tmp/opencandle-session-1.jsonl",
        name: "DRAM options",
        firstMessage: "DRAM options",
        modified: new Date().toISOString(),
      }],
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
    expect(messages).toContainEqual({
      type: "session.rename",
      path: "/tmp/opencandle-session-1.jsonl",
      name: "DRAM LEAPS",
    });
    expect(messages).toContainEqual({
      type: "session.delete",
      path: "/tmp/opencandle-session-1.jsonl",
    });
    await mocked.close();
  });

  it("streams assistant text incrementally and keeps specialized tool cards", async () => {
    const mocked = await browser.newPage({ viewport: { width: 1024, height: 720 } });
    await installMockSocket(mocked);
    await mocked.addInitScript(() => {
      window.fetch = () => {
        const encoder = new TextEncoder();
        let releaseRemainder;
        window.__releaseSseRemainder = () => releaseRemainder?.();
        const stream = new ReadableStream({
          async start(controller) {
            const send = (payload) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
            send({ type: "run.started", runId: "mock-run", sessionId: "mock-session", seq: 1 });
            send({ type: "thinking.delta", runId: "mock-run", text: "Checking option expirations", seq: 2 });
            send({ type: "message.created", messageId: "assistant-live", role: "assistant", seq: 3 });
            send({ type: "message.delta", messageId: "assistant-live", text: "First chunk", seq: 4 });
            await new Promise((resolve) => { releaseRemainder = resolve; });
            send({ type: "thinking.completed", runId: "mock-run", text: "Checking option expirations", seq: 5 });
            send({ type: "message.delta", messageId: "assistant-live", text: " second chunk", seq: 6 });
            await new Promise((resolve) => setTimeout(resolve, 25));
            send({ type: "tool.started", toolCallId: "call-1", messageId: "assistant-live", name: "get_stock_quote", input: { symbol: "NVDA" }, seq: 7 });
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
            send({ type: "message.completed", messageId: "assistant-live", content: [{ type: "text", text: "First chunk second chunk" }, { type: "tool", toolCallId: "call-1" }], seq: 9 });
            send({ type: "run.completed", runId: "mock-run", seq: 10 });
            controller.close();
          },
        });
        return Promise.resolve(new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }));
      };
    });

    await mocked.goto(guiUrl, { waitUntil: "networkidle" });
    await mocked.getByLabel("Message OpenCandle").fill("Mock streaming prompt");
    await mocked.getByRole("button", { name: "Send" }).click();

    await expectVisible(mocked.getByText("First chunk"));
    await expectVisible(mocked.getByText("Analyzing"));
    await expectVisible(mocked.getByText("Checking option expirations"));
    await expect(mocked.getByText("second chunk").count()).resolves.toBe(0);

    await mocked.evaluate(() => window.__releaseSseRemainder?.());
    await expectVisible(mocked.getByText("second chunk"));
    await expectVisible(mocked.getByText("Market lookup").first());
    await expectVisible(mocked.getByText("1 of 1 step").first());
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
            const send = (payload) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
            send({ type: "run.started", runId: "mock-run", sessionId: "actual-run-session", seq: 1 });
            send({ type: "message.created", messageId: "assistant-live", role: "assistant", seq: 2 });
            send({ type: "message.delta", messageId: "assistant-live", text: "Routed answer", seq: 3 });
            send({ type: "run.completed", runId: "mock-run", seq: 4 });
            controller.close();
          },
        });
        return Promise.resolve(new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }));
      };
    });

    await mocked.goto(guiUrl, { waitUntil: "networkidle" });
    await mocked.getByLabel("Message OpenCandle").fill("Prompt from fresh home");
    await mocked.getByRole("button", { name: "Send" }).click();

    await mocked.waitForURL("**/sessions/actual-run-session", { timeout: 5_000 });
    await expectVisible(mocked.getByText("Routed answer"));
    await mocked.close();
  }, 30_000);
});

async function submitPrompt(page: Page, prompt: string): Promise<void> {
  await waitForRunIdle(page);
  await page.getByLabel("Message OpenCandle").fill(prompt);
  await page.getByRole("button", { name: "Send" }).click();
}

async function startNewChat(page: Page): Promise<void> {
  await waitForRunIdle(page);
  await page.getByRole("button", { name: "New chat" }).click();
  await expectVisible(page.getByRole("heading", { name: "What are we watching?" }));
}

async function expectVisible(locator: Locator, timeout = 5_000): Promise<void> {
  await locator.waitFor({ state: "visible", timeout });
  await expect(locator.isVisible()).resolves.toBe(true);
}

async function waitForRunIdle(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const panel = document.querySelector("[data-run-state]");
    return panel?.getAttribute("data-run-state") === "ready";
  }, null, { timeout: 45_000 });
}

async function installMockSocket(page: Page, overrides: Record<string, unknown> = {}): Promise<void> {
  await page.addInitScript((mockOverrides) => {
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
        this.sessions = [...(mockOverrides.sessions ?? [])];
        queueMicrotask(() => {
          this.onopen?.(new Event("open"));
          this.emit({
            type: "boot",
            role: "writer",
            sessionId: "mock-session",
            catalog: mockOverrides.catalog ?? { tools: [], workflows: [], providers: [] },
            modelSetup: mockOverrides.modelSetup ?? { requirement: "ready", providers: [], availableModels: [] },
          });
          this.emit({
            type: "state.snapshot",
            sessionId: "mock-session",
            state: mockOverrides.dashboard ?? { watchlist: [], activeAnalyses: [], recentResearch: [], dataQuality: { softGaps: [], hardSkips: [] } },
            entries: mockOverrides.entries ?? [],
            events: [],
          });
          this.emit({ type: "sessions", sessions: this.sessions });
        });
      }

      send(message) {
        window.__wsMessages = window.__wsMessages || [];
        const parsed = JSON.parse(message);
        window.__wsMessages.push(parsed);
        if (parsed.type === "session.rename") {
          this.sessions = this.sessions.map((session) => (
            session.path === parsed.path ? { ...session, name: parsed.name } : session
          ));
          this.emit({ type: "sessions", sessions: this.sessions });
        }
        if (parsed.type === "session.delete") {
          this.sessions = this.sessions.filter((session) => session.path !== parsed.path);
          this.emit({ type: "sessions", sessions: this.sessions });
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

    window.WebSocket = MockWebSocket;
  }, overrides);
}
