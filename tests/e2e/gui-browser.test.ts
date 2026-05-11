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
    await expectVisible(page.getByRole("button", { name: "Start new chat" }).first());
    await expectVisible(page.getByText("Financial Context"));
  });

  it("renders a stock quote prompt and updates context", async () => {
    await page.goto(guiUrl, { waitUntil: "networkidle" });
    await page.getByLabel("Message OpenCandle").fill("Get the latest quote for NVDA. Show key fields briefly.");
    await page.getByRole("button", { name: "Send" }).click();

    await expectVisible(page.getByText("Stock Quote").first(), 45_000);
    await expectVisible(page.getByText("NVDA").first());
    await expectVisible(page.getByText("Financial Context"));
  }, 60_000);

  it("renders options, filings, macro, and news tool cards", async () => {
    await page.goto(guiUrl, { waitUntil: "networkidle" });

    await submitPrompt(page, "Show options chain for AAPL");
    await expectVisible(page.getByText("Options Chain").first(), 45_000);
    await expectVisible(page.locator("code", { hasText: "\"symbol\":\"AAPL\"" }).last(), 45_000);
    await waitForRunIdle(page);

    await submitPrompt(page, "Show recent SEC filings for MSFT");
    await expectVisible(page.getByText("SEC Filings").first(), 45_000);
    await expectVisible(page.locator("code", { hasText: "\"symbol\":\"MSFT\"" }).last(), 45_000);
    await waitForRunIdle(page);

    await submitPrompt(page, "Show FRED CPI inflation data");
    await expectVisible(page.getByText("Macro Series").first(), 45_000);
    await expectVisible(page.locator("code", { hasText: "\"series_id\":\"CPIAUCSL\"" }).last(), 45_000);
    await waitForRunIdle(page);

    await submitPrompt(page, "Latest news headlines for TSLA");
    await expectVisible(page.getByText("News and Search").first(), 45_000);
    await expectVisible(page.locator("code", { hasText: "TSLA financial news" }).last(), 45_000);
  }, 120_000);

  it("shows chat history on mobile", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(guiUrl, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Open chat history" }).click();

    await expectVisible(page.getByRole("dialog", { name: "Chat history" }));
    await expectVisible(page.getByRole("textbox", { name: "Search sessions" }));
  });

  it("captures desktop and mobile screenshots", async () => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(guiUrl, { waitUntil: "networkidle" });
    const desktop = await page.screenshot({ fullPage: true });
    expect(desktop.byteLength).toBeGreaterThan(10_000);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Open chat history" }).click();
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
    await expectVisible(mocked.getByRole("button", { name: "Save API Key" }));
    await mocked.close();
  });

  it("supports stop, retry failed run, copy, and keyboard catalog controls", async () => {
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
    await mocked.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText(value) {
            window.__copiedText = value;
            return Promise.resolve();
          },
        },
      });
      window.fetch = (_input, init) => new Promise((resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        window.__resolveRunFetch = () => resolve(new Response("data: {\"type\":\"run.failed\",\"runId\":\"mock\",\"error\":{\"message\":\"Mock failure\"},\"seq\":1}\n\n", {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }));
      });
    });

    await mocked.goto(guiUrl, { waitUntil: "networkidle" });
    await mocked.getByLabel("Message OpenCandle").fill("Mock slow prompt");
    await mocked.getByRole("button", { name: "Send" }).click();
    await expectVisible(mocked.getByText("Connecting").first());
    await mocked.getByRole("button", { name: "Stop response" }).click();
    await expectVisible(mocked.getByText(/Stopped response/));

    await mocked.getByLabel("Message OpenCandle").fill("Mock failed prompt");
    await mocked.getByRole("button", { name: "Send" }).click();
    await mocked.evaluate(() => window.__resolveRunFetch?.());
    await expectVisible(mocked.getByText("Failed").first());
    await expectVisible(mocked.getByRole("button", { name: "Retry last prompt" }));

    await mocked.getByRole("button", { name: "Copy latest assistant response" }).click();
    await mocked.waitForFunction(() => window.__copiedText === "Reusable assistant text");

    await mocked.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
    await expectVisible(mocked.getByRole("dialog", { name: "Catalog" }));
    await mocked.keyboard.press("Escape");
    await mocked.getByRole("dialog", { name: "Catalog" }).waitFor({ state: "detached" });
    await mocked.close();
  }, 30_000);

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
            send({ type: "message.created", messageId: "assistant-live", role: "assistant", seq: 2 });
            send({ type: "message.delta", messageId: "assistant-live", text: "First chunk", seq: 3 });
            await new Promise((resolve) => { releaseRemainder = resolve; });
            send({ type: "message.delta", messageId: "assistant-live", text: " second chunk", seq: 4 });
            send({ type: "tool.started", toolCallId: "call-1", messageId: "assistant-live", name: "get_stock_quote", input: { symbol: "NVDA" }, seq: 5 });
            send({
              type: "tool.completed",
              toolCallId: "call-1",
              output: {
                content: [{ type: "text", text: "NVDA quote" }],
                details: { symbol: "NVDA", price: 185.25, changePercent: 1.2, volume: 123456 },
                isError: false,
              },
              seq: 6,
            });
            send({ type: "message.completed", messageId: "assistant-live", content: [{ type: "text", text: "First chunk second chunk" }, { type: "tool", toolCallId: "call-1" }], seq: 7 });
            send({ type: "run.completed", runId: "mock-run", seq: 8 });
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
    await expect(mocked.getByText("second chunk").count()).resolves.toBe(0);

    await mocked.evaluate(() => window.__releaseSseRemainder?.());
    await expectVisible(mocked.getByText("second chunk"));
    await expectVisible(mocked.getByText("Stock Quote").first());
    await expectVisible(mocked.getByText("NVDA").first());
    await mocked.close();
  }, 30_000);
});

async function submitPrompt(page: Page, prompt: string): Promise<void> {
  await waitForRunIdle(page);
  await page.getByLabel("Message OpenCandle").fill(prompt);
  await page.getByRole("button", { name: "Send" }).click();
}

async function expectVisible(locator: Locator, timeout = 5_000): Promise<void> {
  await locator.waitFor({ state: "visible", timeout });
  await expect(locator.isVisible()).resolves.toBe(true);
}

async function waitForRunIdle(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const stop = document.querySelector("button[aria-label='Stop response']");
    return stop instanceof HTMLButtonElement && stop.disabled;
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

      constructor() {
        super();
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
          this.emit({ type: "sessions", sessions: mockOverrides.sessions ?? [] });
        });
      }

      send() {}

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
