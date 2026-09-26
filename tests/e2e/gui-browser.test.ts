import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runOpenCandleSession } from "../harness/opencandle-runner.js";
import {
  arrayValue,
  expectVisible,
  fetchGuiSessionSnapshot,
  isOpenCandleCustomEntry,
  opencandleEntrySequence,
  recordValue,
  resolveChromiumExecutable,
  runGuiChat,
  startNewChat,
  stringValue,
  submitPrompt,
  waitForRunIdle,
  writeParityEvidence,
} from "../support/gui/browser-helpers.js";

const runGuiBrowser = process.env.OPENCANDLE_GUI_BROWSER === "1";
const guiUrl = process.env.OPENCANDLE_GUI_URL ?? "http://127.0.0.1:14567";
const parityPrompt = process.env.OPENCANDLE_GUI_TUI_PARITY_PROMPT ?? "analyze NVDA";

/**
 * Live GUI smoke lane. Needs a running GUI server at OPENCANDLE_GUI_URL and a
 * working model/provider setup: cases here dispatch real agent runs. The
 * deterministic mocked HTTP/WS/SSE cases live in gui-integration.test.ts.
 */
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

    // Not the home route: "/" auto-starts a fresh session whenever the current
    // one has content (shouldStartFreshHomeSession), and earlier tests in this
    // file leave content behind. That request is dispatched from a React effect
    // after the WebSocket boot message, so `networkidle` does not wait for it —
    // it can land after this test creates its own session and replace the very
    // session the run below is dispatched to. Settings is a plain route that
    // never resets the session, so the run's session stays put.
    await page.goto(`${guiUrl}/settings`, { waitUntil: "networkidle" });
    const newSession = await page.evaluate(async () => {
      const response = await fetch("/api/session/new", { method: "POST" });
      if (!response.ok) throw new Error(`new session failed: ${response.status}`);
      return response.json();
    });
    const sessionId = stringValue(recordValue(newSession).sessionId);
    expect(sessionId).toBeTruthy();

    await page.goto(`${guiUrl}/sessions/${encodeURIComponent(sessionId)}`, {
      waitUntil: "networkidle",
    });
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
    // The 2026-07-04 finding recorded here ("/analyze emits no
    // opencandle-workflow entry, so the projector never sees comprehensive
    // analysis") no longer holds: the transform path emits that entry, and a
    // run that reaches its terminal answer is moved out of activeAnalyses into
    // recentResearch. The analystsDone-from-entries math stays owned by the
    // projector unit tests over real entry shapes.
    expect(arrayValue(dashboard.activeAnalyses)).toHaveLength(0);
    const recentResearch = arrayValue(dashboard.recentResearch).map(recordValue);
    const completedAnalysis = recentResearch.find(
      (entry) => stringValue(entry.workflow) === "comprehensive_analysis",
    );
    expect(completedAnalysis).toBeDefined();
    expect(stringValue(recordValue(completedAnalysis).sessionId)).toBe(sessionId);

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
