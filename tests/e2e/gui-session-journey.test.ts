import type { Locator, Page, Response as PlaywrightResponse } from "playwright-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type GuiJourneyHarness,
  startGuiJourneyHarness,
} from "../support/gui-journey/journey-harness.js";
import {
  ASK_USER_PROMPT,
  CANCEL_PROMPT,
  createHoldGate,
  createJourneyModelScript,
  PREFERENCE_PROMPT,
  QUOTE_PROMPT,
  SECOND_PROMPT,
  STREAM_HOLD_PROMPT,
  TOOL_HOLD_PROMPT,
} from "../support/gui-journey/journey-model.js";

/**
 * Full-stack deterministic GUI journeys.
 *
 * A real Playwright browser drives the real `gui/server/server.ts` child
 * process, which runs the real OpenCandle session loop against a local HTTP
 * model fixture and local external-data fixtures. Nothing in the GUI server,
 * coordinator, providers, or storage is faked; the only fixture is external
 * HTTP (model provider, Yahoo, Ticker Line, Google Fonts).
 *
 * The scripted model replies are fixture synthesis at the transport boundary:
 * they are not evidence of model intelligence. The assertions instead check
 * transport and persistence: the real tool result reaching the model, the
 * answer and tool event reaching the persisted Pi session, and session
 * isolation across reloads.
 *
 * Isolation: every case starts its own harness (temp HOME/agent/session dir,
 * model fixture, aux HTTP fixture, GUI child, and browser) in `beforeEach` and
 * tears it down in `afterEach`. Each case creates the sessions it needs, so no
 * case depends on another's state and every case runs independently (`-t`) and
 * under a shuffled seed.
 *
 * Cancellation semantics under test: only the explicit **Stop** control cancels
 * a run (it sends an authenticated cancel POST and the server must tear down
 * the in-flight provider request). Passive navigation/disconnect, such as a
 * reload or leaving the page, intentionally does NOT cancel; the run continues
 * to completion.
 *
 * Front-door command (builds the GUI web bundle, then runs this project):
 *   npm run test:gui:journey
 */

let harness: GuiJourneyHarness;
// A distinct prompt that must never run: it is POSTed while a held run owns the
// session, so admission must reject it rather than queue it.
const DISTINCT_CHAT_PROMPT = "A distinct second chat that must never run.";
// Holds are per-case; a fresh set is created in `beforeEach`.
let routerHold = createHoldGate();
let answerHold = createHoldGate();
let toolHold = createHoldGate();
// The fixture quotes are always served unless the held-tool case arms the hold.
const quoteHoldActive = { value: false };

describe("GUI session journey", () => {
  beforeEach(async () => {
    routerHold = createHoldGate();
    answerHold = createHoldGate();
    toolHold = createHoldGate();
    quoteHoldActive.value = false;

    harness = await startGuiJourneyHarness({
      modelScript: createJourneyModelScript({ routerHold, answerHold }),
      fixture: {
        holdQuote: {
          symbol: "NVDA",
          isActive: () => quoteHoldActive.value,
          gate: toolHold,
        },
      },
    });
  });

  afterEach(async () => {
    // Release any gate a cancelled or failed case left held before teardown.
    routerHold.release();
    answerHold.release();
    toolHold.release();
    await harness?.stop();
  });

  it("delivers a real tool result to the model and persists the answer across reload", async () => {
    const page = harness.page;
    await page.goto(harness.baseUrl, { waitUntil: "networkidle" });
    await submitPrompt(page, QUOTE_PROMPT);
    await expectVisible(page.getByText("Stock quote").first(), 30_000);
    await expectVisible(page.getByText("$189.42").first(), 30_000);
    // Card-only tool-result values (absent from the scripted answer text).
    await expectVisible(page.getByText("Prev close").first(), 30_000);
    await expectVisible(page.getByText("$187.00").first(), 30_000);
    await expectVisible(
      page.getByText("AAPL is trading at $189.42 as of 2026-07-15T20:00:00.000Z.").first(),
    );
    await waitForRunIdle(page);

    // The real tool result reached the model as a tool message.
    expect(
      harness.modelServer.requests.some((request) =>
        request.messages.some(
          (message) => message.role === "tool" && JSON.stringify(message).includes("189.42"),
        ),
      ),
    ).toBe(true);

    const sessionId = sessionIdFromUrl(page);
    expect(sessionId).toBeTruthy();
    const entries = harness.readSessionEntries(sessionId);
    expect(entries.length).toBeGreaterThan(0);

    await page.reload({ waitUntil: "networkidle" });
    await expectVisible(page.getByText("$189.42").first(), 30_000);
    // Restored tool timelines start collapsed; expand the real persisted tool
    // run and assert card-only evidence (not in the scripted answer text) so
    // the check proves the tool event was rehydrated, not just the message.
    const restoredSteps = page.locator("button").filter({ hasText: "1 of 1 step" }).first();
    await expectVisible(restoredSteps, 30_000);
    await restoredSteps.click();
    await expectVisible(page.getByText("Stock quote").first(), 30_000);
    await expectVisible(page.getByText("Prev close").first(), 30_000);
    await expectVisible(page.getByText("$187.00").first(), 30_000);
    await expect(page.locator('[data-scroll-anchor="true"]').count()).resolves.toBe(1);
    expect(userMessageCount(harness, sessionId)).toBe(1);

    const transcript = JSON.stringify(entries);
    expect(transcript).toContain("get_stock_quote");
    expect(transcript).toContain("189.42");
    expect(transcript).toContain("2026-07-15T20:00:00.000Z");
    expect(transcript).not.toContain("test-gui-journey-key");
    expect(harness.unexpectedServerRequests()).toEqual([]);
    expect(harness.browserGuard.unexpected).toEqual([]);
  }, 90_000);

  it("keeps two sessions isolated when switching back and forth", async () => {
    const page = harness.page;
    await page.goto(harness.baseUrl, { waitUntil: "networkidle" });

    // This case seeds BOTH sessions itself; it depends on no other case.
    await startNewSession(page);
    await submitPrompt(page, QUOTE_PROMPT);
    await expectVisible(page.getByText("$189.42").first(), 30_000);
    await waitForRunIdle(page);
    const aaplSessionId = sessionIdFromUrl(page);

    // Reload so the sidebar lists freshly generated session titles.
    await page.reload({ waitUntil: "networkidle" });
    await startNewSession(page);
    await submitPrompt(page, SECOND_PROMPT);
    await expectVisible(page.getByText("$512.34").first(), 30_000);
    await waitForRunIdle(page);
    const msftSessionId = sessionIdFromUrl(page);
    await page.reload({ waitUntil: "networkidle" });

    await openSession(page, "AAPL quote journey");
    await expectVisible(page.getByText("$189.42").first(), 30_000);
    await expect(page.getByText("$512.34").count()).resolves.toBe(0);

    await expectVisible(
      page.getByRole("button", { name: "MSFT quote journey", exact: true }),
      15_000,
    );
    await openSession(page, "MSFT quote journey");
    await expectVisible(page.getByText("$512.34").first(), 30_000);
    await expect(page.getByText("$189.42").count()).resolves.toBe(0);

    // Each session persists exactly its own single user turn.
    expect(userMessageCount(harness, msftSessionId)).toBe(1);
    expect(userMessageCount(harness, aaplSessionId)).toBe(1);
  }, 90_000);

  it("persists a watchlist item and a learned preference across reopen", async () => {
    const page = harness.page;
    await page.goto(`${harness.baseUrl}/watchlists`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Add ticker" }).first().click();
    await page.getByRole("combobox", { name: "Search ticker or company" }).fill("AAPL");
    const option = page.getByRole("option", { name: /AAPL/ }).first();
    await expectVisible(option, 20_000);
    await option.click();
    await expectVisible(page.getByText("Selected AAPL").first(), 20_000);
    await page.getByRole("button", { name: "Close panel" }).click();

    await page.goto(harness.baseUrl, { waitUntil: "networkidle" });
    await submitPrompt(page, PREFERENCE_PROMPT);
    await waitForRunIdle(page);
    const preferences = await readPreferences(page);
    expect(JSON.stringify(preferences)).toContain("risk_profile");
    expect(JSON.stringify(preferences)).toContain("aggressive");

    // Reopen both surfaces: the watchlist row and the learned preference persist.
    await page.goto(`${harness.baseUrl}/watchlists`, { waitUntil: "networkidle" });
    await expectVisible(page.getByText("AAPL").first(), 20_000);
    await page.reload({ waitUntil: "networkidle" });
    await expectVisible(page.getByText("AAPL").first(), 20_000);
    const reopenedPreferences = await readPreferences(page);
    expect(JSON.stringify(reopenedPreferences)).toContain("aggressive");
    expect(harness.unexpectedServerRequests()).toEqual([]);
  }, 90_000);

  it("continues an ask_user clarification in the real composer", async () => {
    const page = harness.page;
    await page.goto(harness.baseUrl, { waitUntil: "networkidle" });
    await submitPrompt(page, ASK_USER_PROMPT);
    await expectVisible(page.getByText("Which horizon should the plan target?").first(), 30_000);
    await page.getByRole("button", { name: "1 year" }).click();
    await expectVisible(page.getByText(/Plan for a 1 year horizon/).first(), 30_000);
    await waitForRunIdle(page);

    // The ask_user answer reached the model as a tool result.
    expect(
      harness.modelServer.requests.some((request) =>
        request.messages.some(
          (message) => message.role === "tool" && JSON.stringify(message).includes("User answered"),
        ),
      ),
    ).toBe(true);
  }, 90_000);

  it("explicit Stop while an ask_user question is open ends the run and frees the session", async () => {
    const page = harness.page;
    await page.goto(harness.baseUrl, { waitUntil: "networkidle" });

    await startNewSession(page);
    const runActionId = await submitPromptAndCaptureRunActionId(page, ASK_USER_PROMPT);
    expect(runActionId).toMatch(/^chat-/);
    const stoppedSessionId = sessionIdFromUrl(page);
    await expectVisible(page.getByText("Which horizon should the plan target?").first(), 30_000);
    await expectVisible(page.getByRole("button", { name: "1 year" }), 15_000);

    await stopAndAwaitCancelAccepted(page, {
      sessionId: stoppedSessionId,
      targetActionId: runActionId,
    });

    // The server must actually retire the run, not just acknowledge the Stop:
    // the tool waiting on the open question settles as cancelled.
    expect(
      await waitForRunCancelReason(page, stoppedSessionId, runActionId, "no_active_run", 10_000),
    ).toBe(true);
    await expectVisible(page.getByRole("button", { name: "Send message" }), 15_000);

    // The stale question is no longer answerable.
    await page
      .getByRole("button", { name: "1 year" })
      .waitFor({ state: "detached", timeout: 10_000 });

    // The model never received an answer for the stopped question.
    expect(
      harness.modelServer.requests.some((request) =>
        request.messages.some(
          (message) => message.role === "tool" && JSON.stringify(message).includes("User answered"),
        ),
      ),
    ).toBe(false);

    // The same session accepts the next send (no 409 "still working").
    await submitPrompt(page, QUOTE_PROMPT);
    await expectVisible(
      page.getByText("AAPL is trading at $189.42 as of 2026-07-15T20:00:00.000Z.").first(),
      30_000,
    );
    await waitForRunIdle(page);
    expect(sessionIdFromUrl(page)).toBe(stoppedSessionId);
  }, 120_000);

  it("passive reload does not cancel; the held run completes normally", async () => {
    const page = harness.page;
    await page.goto(harness.baseUrl, { waitUntil: "networkidle" });

    // Establish an active run that has already produced the real tool result and
    // is mid native answer stream, then passively disconnect. This is the
    // preserved behavior: only explicit Stop cancels.
    await startNewSession(page);
    // Capture the hold baseline before submitting: the request can reach the
    // gate during the submit round-trip, so a post-submit baseline would wait
    // for a second request that never arrives.
    const waitCountBefore = answerHold.waitCount;
    await submitPrompt(page, STREAM_HOLD_PROMPT);
    const runSessionId = sessionIdFromUrl(page);
    await expectVisible(page.getByRole("button", { name: "Stop response" }), 30_000);
    await waitForCondition(() => answerHold.waitCount > waitCountBefore, 10_000);
    const heldSettlement = heldModelSettlement(harness, "Stream the NVDA answer", "native_answer");
    expect(heldSettlement).toBeDefined();

    // Passive disconnect: full page navigation away without pressing Stop.
    // This is intentionally NOT a cancel; the server-side run must keep going.
    await page.goto(harness.baseUrl, { waitUntil: "networkidle" });

    answerHold.release();
    // The held upstream request completes normally and the run finishes,
    // persisting the completed answer. (Currently RED: a passive disconnect
    // aborts the run at the application layer, so the native assistant message
    // persists with stopReason "aborted" and only the first streamed half. The
    // provider HTTP itself completes; only explicit Stop is supposed to cancel.)
    expect(await settlesWithin(heldSettlement!.completed, 10_000)).toBe(true);
    const completed = await waitFor(
      () => hasCompletedNvdaAnswer(harness.readSessionEntries(runSessionId)),
      15_000,
    );
    expect(completed).toBe(true);
    expect(hasCompletedNvdaAnswer(harness.readSessionEntries(runSessionId))).toBe(true);
  }, 120_000);

  it("explicit Stop cancels the run while the router is held", async () => {
    const page = harness.page;
    await page.goto(harness.baseUrl, { waitUntil: "networkidle" });

    // A saved session proves the owning server stays usable after the cancel.
    await startNewSession(page);
    await submitPrompt(page, SECOND_PROMPT);
    await expectVisible(page.getByText("$512.34").first(), 30_000);
    await waitForRunIdle(page);

    const nvdaRequestsBefore = nvdaQuoteRequests(harness);

    // Start a run whose router response is held so the run is genuinely active.
    await startNewSession(page);
    // Baseline before submit: the held router request can start during submit.
    const waitCountBefore = routerHold.waitCount;
    const runActionId = await submitPromptAndCaptureRunActionId(page, CANCEL_PROMPT);
    expect(runActionId).toMatch(/^chat-/);
    const cancelledSessionId = sessionIdFromUrl(page);
    await expectVisible(page.getByRole("button", { name: "Stop response" }), 30_000);
    await waitForCondition(() => routerHold.waitCount > waitCountBefore, 10_000);
    const heldSettlement = heldModelSettlement(harness, "Hold the NVDA router", "router");
    expect(heldSettlement).toBeDefined();

    // A distinct second chat prompt while this run is active is rejected with
    // 409 session_busy by the real server. It must not be queued to execute
    // after the first run settles.
    const secondChat = await postChatRun(page, cancelledSessionId, {
      actionId: `chat-queued-${Date.now()}`,
      prompt: DISTINCT_CHAT_PROMPT,
    });
    expect(secondChat.status).toBe(409);
    expect(secondChat.json).toMatchObject({ code: "session_busy" });
    expect(String(secondChat.json.error)).toContain("still working");

    try {
      // A stale target while the run is active is acknowledged without
      // cancelling: the Stop must name the run it is actually stopping.
      const stale = await postRunCancel(page, cancelledSessionId, {
        sessionId: cancelledSessionId,
        actionId: `stop-stale-${Date.now()}`,
        targetActionId: "chat-not-the-active-run",
      });
      expect(stale.status).toBe(200);
      expect(stale.json).toMatchObject({ ok: true, cancelled: false, reason: "stale_target" });

      // Only the explicit Stop control cancels. It must reach the server as an
      // authenticated cancel POST and succeed BEFORE the held model is released.
      // Passive navigation/disconnect never calls this and intentionally does
      // not cancel (covered by the passive test below).
      const { body: cancelBody } = await stopAndAwaitCancelAccepted(page, {
        sessionId: cancelledSessionId,
        targetActionId: runActionId,
      });
      expect(cancelBody).toMatchObject({ ok: true, cancelled: true, duplicate: false });
      await expectVisible(page.getByRole("button", { name: "Send message" }), 15_000);

      // Release the held model. Once the cancel signal reaches the provider
      // call, the upstream HTTP request is torn down: the socket closes before
      // the scripted response completes.
      routerHold.release();
      expect(await settlesWithin(heldSettlement!.aborted, 10_000)).toBe(true);

      // Terminal state from the server's own live session snapshot (the same
      // state the reopened transcript renders). The original input legitimately
      // still contains "NVDA"; assert no completed assistant answer, no later
      // quote-tool dispatch, and the exact cancelled marker.
      const snapshot = await waitForSessionEntries(
        page,
        cancelledSessionId,
        (entries) => findRunCancelledMarker(entries, CANCEL_PROMPT) !== undefined,
      );
      expect(findRunCancelledMarker(snapshot.entries, CANCEL_PROMPT)).toBeDefined();
      expect(hasCompletedNvdaAnswer(snapshot.entries)).toBe(false);
      expect(nvdaQuoteRequests(harness)).toBe(nvdaRequestsBefore);

      // Reopen the stopped session: the durable marker renders as a Stopped turn.
      await page.goto(`${harness.baseUrl}/sessions/${cancelledSessionId}`, {
        waitUntil: "networkidle",
      });
      await expectVisible(page.getByText("Stopped").first(), 15_000);
      await expectVisible(
        page.getByText("Run stopped before it produced an answer.").first(),
        15_000,
      );

      // Once the run is retired, the same target reports no active run.
      expect(
        await waitForRunCancelReason(
          page,
          cancelledSessionId,
          runActionId,
          "no_active_run",
          10_000,
        ),
      ).toBe(true);

      // The rejected second prompt never ran: no queued invocation reached the
      // model or produced a second user turn once the first run settled.
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(
        harness.modelServer.requests.some((request) =>
          JSON.stringify(request.messages).includes(DISTINCT_CHAT_PROMPT),
        ),
      ).toBe(false);
      expect(JSON.stringify(harness.readSessionEntries(cancelledSessionId))).not.toContain(
        DISTINCT_CHAT_PROMPT,
      );

      // The owning server is free again: a subsequent prompt runs to completion.
      await startNewSession(page);
      await submitPrompt(page, QUOTE_PROMPT);
      await expectVisible(
        page.getByText("AAPL is trading at $189.42 as of 2026-07-15T20:00:00.000Z.").first(),
        30_000,
      );
      await waitForRunIdle(page);
    } finally {
      routerHold.release();
    }
  }, 120_000);

  it("Retry on a stopped turn starts a fresh run with a new action id", async () => {
    const page = harness.page;
    await page.goto(harness.baseUrl, { waitUntil: "networkidle" });

    await startNewSession(page);
    const waitCountBefore = routerHold.waitCount;
    const runActionId = await submitPromptAndCaptureRunActionId(page, CANCEL_PROMPT);
    const stoppedSessionId = sessionIdFromUrl(page);
    await waitForCondition(() => routerHold.waitCount > waitCountBefore, 10_000);
    const heldSettlement = heldModelSettlement(harness, "Hold the NVDA router", "router");

    await stopAndAwaitCancelAccepted(page, {
      sessionId: stoppedSessionId,
      targetActionId: runActionId,
    });
    routerHold.release();
    expect(await settlesWithin(heldSettlement!.aborted, 10_000)).toBe(true);
    expect(
      await waitForRunCancelReason(page, stoppedSessionId, runActionId, "no_active_run", 10_000),
    ).toBe(true);

    // The live stopped turn offers Retry without a reload.
    await expectVisible(page.getByText("Stopped").first(), 15_000);
    const retry = page.getByRole("button", { name: "Retry" });
    await expectVisible(retry, 15_000);
    await expect(retry.isEnabled()).resolves.toBe(true);

    const retryRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname ===
          `/api/sessions/${encodeURIComponent(stoppedSessionId)}/runs`,
    );
    await retry.click();
    const retryBody = (await retryRequest).postDataJSON() as {
      actionId?: string;
      prompt?: string;
    };
    expect(retryBody.prompt).toBe(CANCEL_PROMPT);
    expect(String(retryBody.actionId)).toMatch(/^chat-/);
    expect(retryBody.actionId).not.toBe(runActionId);

    // The retried run actually runs to a completed answer.
    await expectVisible(
      page.getByText("NVDA is trading at $185.25 as of 2026-07-15T20:00:00.000Z.").first(),
      30_000,
    );
    await waitForRunIdle(page);
    expect(hasCompletedNvdaAnswer(harness.readSessionEntries(stoppedSessionId))).toBe(true);
  }, 120_000);

  it("explicit Stop cancels the run mid native answer stream", async () => {
    const page = harness.page;
    await page.goto(harness.baseUrl, { waitUntil: "networkidle" });

    await startNewSession(page);
    // Baseline before submit: the native answer request can start during submit.
    const waitCountBefore = answerHold.waitCount;
    const runActionId = await submitPromptAndCaptureRunActionId(page, STREAM_HOLD_PROMPT);
    expect(runActionId).toMatch(/^chat-/);
    const cancelledSessionId = sessionIdFromUrl(page);
    await expectVisible(page.getByRole("button", { name: "Stop response" }), 30_000);
    await waitForCondition(() => answerHold.waitCount > waitCountBefore, 10_000);

    // The tool already ran to produce the tool result that seeds the answer
    // stream. Capture the dispatch count now; Stop must not add another.
    const nvdaRequestsBefore = nvdaQuoteRequests(harness);

    // Distinguish the streams: this hold is on the NATIVE Pi answer request, not
    // the router response. The held request carries tools and the real quote
    // tool result, and is not a router prompt.
    const heldSettlement = heldModelSettlement(harness, "Stream the NVDA answer", "native_answer");
    expect(heldSettlement).toBeDefined();
    const heldRequestText = JSON.stringify(heldSettlement!.request.messages);
    expect(heldRequestText).not.toContain("routing agent");
    expect(heldSettlement!.request.tools?.length ?? 0).toBeGreaterThan(0);
    expect(
      heldSettlement!.request.messages.some(
        (message) => message.role === "tool" && JSON.stringify(message).includes("185.25"),
      ),
    ).toBe(true);

    try {
      await stopAndAwaitCancelAccepted(page, {
        sessionId: cancelledSessionId,
        targetActionId: runActionId,
      });
      await expectVisible(page.getByRole("button", { name: "Send message" }), 15_000);

      answerHold.release();
      expect(await settlesWithin(heldSettlement!.aborted, 10_000)).toBe(true);

      const snapshot = await waitForSessionEntries(page, cancelledSessionId, (entries) =>
        hasAbortedNvdaAnswer(entries),
      );
      // The mid-stream Stop settles the native Pi assistant turn as aborted:
      // the partial first half is durable with stopReason "aborted", and no
      // completed answer is ever persisted. (The input-phase
      // `opencandle-run-cancelled` marker belongs to a cancel that lands before
      // the agent run starts, not to an aborted native answer stream.)
      expect(hasAbortedNvdaAnswer(snapshot.entries)).toBe(true);
      expect(hasCompletedNvdaAnswer(snapshot.entries)).toBe(false);
      expect(nvdaQuoteRequests(harness)).toBe(nvdaRequestsBefore);
    } finally {
      answerHold.release();
    }
  }, 120_000);

  it("explicit Stop during a held tool fetch prevents any later answer", async () => {
    const page = harness.page;
    await page.goto(harness.baseUrl, { waitUntil: "networkidle" });

    // Arm the aux fixture so the real NVDA tool fetch is genuinely in flight.
    quoteHoldActive.value = true;
    const nvdaRequestsBefore = nvdaQuoteRequests(harness);
    await startNewSession(page);
    // Baseline before submit: the held tool fetch can open during submit.
    const waitCountBefore = toolHold.waitCount;
    const runActionId = await submitPromptAndCaptureRunActionId(page, TOOL_HOLD_PROMPT);
    expect(runActionId).toMatch(/^chat-/);
    const cancelledSessionId = sessionIdFromUrl(page);
    await expectVisible(page.getByRole("button", { name: "Stop response" }), 30_000);
    await waitForCondition(() => toolHold.waitCount > waitCountBefore, 10_000);

    // The real tool fetch opened; it is held, not faked or aborted.
    expect(nvdaQuoteRequests(harness)).toBe(nvdaRequestsBefore + 1);

    // Snapshot how many model requests have carried the NVDA tool result so far.
    const toolResultRequestsBefore = nvdaToolResultRequests(harness);

    try {
      await stopAndAwaitCancelAccepted(page, {
        sessionId: cancelledSessionId,
        targetActionId: runActionId,
      });
      await expectVisible(page.getByRole("button", { name: "Send message" }), 15_000);

      // Cooperative cancellation: release the held provider response and let the
      // in-flight read-only tool fetch settle. Stop must prevent continuation.
      toolHold.release();
      await new Promise((resolve) => setTimeout(resolve, 1_000));

      // No tool result was ever sent back to the model, and no completed answer
      // was produced. The underlying quote HTTP is NOT asserted to be aborted:
      // the read-only fetch may settle, but Stop must prevent continuation.
      expect(nvdaToolResultRequests(harness)).toBe(toolResultRequestsBefore);
      const snapshot = await fetchSessionSnapshot(page, cancelledSessionId);
      expect(hasCompletedNvdaAnswer(snapshot.entries)).toBe(false);

      // Known terminal settlement: the run retires, which frees the owning
      // session for the next prompt.
      expect(
        await waitForRunCancelReason(
          page,
          cancelledSessionId,
          runActionId,
          "no_active_run",
          10_000,
        ),
      ).toBe(true);

      // The owning server is free again: a subsequent prompt runs to completion.
      await startNewSession(page);
      await submitPrompt(page, QUOTE_PROMPT);
      await expectVisible(
        page.getByText("AAPL is trading at $189.42 as of 2026-07-15T20:00:00.000Z.").first(),
        30_000,
      );
      await waitForRunIdle(page);
    } finally {
      toolHold.release();
    }
  }, 120_000);
});

async function submitPrompt(page: Page, text: string): Promise<void> {
  await page.getByLabel("Message OpenCandle").fill(text);
  await page.getByRole("button", { name: "Send message" }).click();
}

async function waitForRunIdle(page: Page): Promise<void> {
  await expectVisible(page.getByRole("button", { name: "Send message" }), 90_000);
}

async function openSession(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name, exact: true }).click();
  await expectVisible(page.getByLabel("Message OpenCandle"), 15_000);
}

/** Creates a fresh session and waits for the composer to settle before prompting. */
async function startNewSession(page: Page): Promise<void> {
  const before = sessionIdFromUrl(page);
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await waitForCondition(() => {
    const current = sessionIdFromUrl(page);
    return current !== "" && current !== before;
  }, 15_000);
  await expectVisible(page.getByLabel("Message OpenCandle"), 15_000);
}

function sessionIdFromUrl(page: Page): string {
  const match = page.url().match(/\/sessions\/([^/?#]+)/);
  return match?.[1] ?? "";
}

function userMessageCount(harness: GuiJourneyHarness, sessionId: string): number {
  return harness
    .readSessionEntries(sessionId)
    .filter(
      (entry): entry is { type: string; message?: { role?: string } } =>
        typeof entry === "object" &&
        entry !== null &&
        (entry as { type?: string }).type === "message",
    )
    .filter((entry) => entry.message?.role === "user").length;
}

async function readPreferences(page: Page): Promise<unknown> {
  return page.evaluate(async () => {
    const response = await fetch("/api/preferences");
    return response.json();
  });
}

async function expectVisible(locator: Locator, timeout = 10_000): Promise<void> {
  await locator.waitFor({ state: "visible", timeout });
  await expect(locator.isVisible()).resolves.toBe(true);
}

async function waitForCondition(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for condition");
}

/** Bounded wait that returns whether the predicate became true (no throw). */
async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return predicate();
}

type HeldStreamKind = "router" | "native_answer";

/**
 * The held model request for a turn, classified by stream kind:
 *   - `router`: the auxiliary routing prompt (no tools, contains "routing agent")
 *   - `native_answer`: the real Pi answer request that follows the tool result
 *     (tools present and the quote tool result in its messages)
 */
function heldModelSettlement(harness: GuiJourneyHarness, needle: string, kind: HeldStreamKind) {
  return harness.modelServer.settlements.find((settlement) => {
    const messages = settlement.request.messages;
    const text = JSON.stringify(messages);
    if (!text.includes(needle)) return false;
    if (text.includes("routing agent")) return kind === "router";
    // The native answer request is the one that already carries the real tool
    // result; the earlier main-agent tool-call request does not.
    return kind === "native_answer" && messages.some((message) => message.role === "tool");
  });
}

/** Count of NVDA quote dispatches actually served by the external fixture. */
function nvdaQuoteRequests(harness: GuiJourneyHarness): number {
  return harness.aux.requests.filter((request) =>
    request.path.includes("/fixture/yahoo/v8/finance/chart/NVDA"),
  ).length;
}

/** Model requests that carried the real NVDA quote tool result back to the model. */
function nvdaToolResultRequests(harness: GuiJourneyHarness): number {
  return harness.modelServer.requests.filter((request) =>
    request.messages.some(
      (message) => message.role === "tool" && JSON.stringify(message).includes("185.25"),
    ),
  ).length;
}

interface RunCancelContract {
  sessionId: string;
  targetActionId: string;
}

function runCancelPath(sessionId: string): string {
  return `/api/sessions/${encodeURIComponent(sessionId)}/run-cancel`;
}

/**
 * Presses the explicit Stop control and validates the finalized authenticated
 * cancel contract end to end:
 *   POST /api/sessions/<encoded sessionId>/run-cancel
 *   body { sessionId, actionId: "stop-…", targetActionId: <chat run action id> }
 *   success { ok: true, cancelled: true, duplicate: false }
 */
async function stopAndAwaitCancelAccepted(
  page: Page,
  contract: RunCancelContract,
): Promise<{ response: PlaywrightResponse; body: Record<string, unknown> }> {
  const expectedPath = runCancelPath(contract.sessionId);
  const cancelResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === expectedPath,
    { timeout: 15_000 },
  );
  await page.getByRole("button", { name: "Stop response" }).click();
  const response = await cancelResponse;
  const requestBody = (response.request().postDataJSON() ?? {}) as Record<string, unknown>;
  expect(String(requestBody.sessionId)).toBe(contract.sessionId);
  expect(String(requestBody.actionId)).toMatch(/^stop-/);
  expect(String(requestBody.targetActionId)).toBe(contract.targetActionId);
  const body = (await response.json()) as Record<string, unknown>;
  expect(response.ok()).toBe(true);
  expect(body).toMatchObject({ ok: true, cancelled: true });
  expect(body.duplicate).toBe(false);
  return { response, body };
}

/** Posts the authenticated run-cancel route directly via the trusted browser cookie. */
async function postRunCancel(
  page: Page,
  sessionId: string,
  body: Record<string, unknown>,
): Promise<{ status: number; json: Record<string, unknown> }> {
  return page.evaluate(
    async ({ sessionId, body }) => {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/run-cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      let json: Record<string, unknown> = {};
      try {
        json = (await response.json()) as Record<string, unknown>;
      } catch {
        // A pre-patch server serves a non-JSON 404; the caller asserts on it.
      }
      return { status: response.status, json };
    },
    { sessionId, body },
  );
}

/** Posts a chat run over the trusted browser session, using the real runs route. */
async function postChatRun(
  page: Page,
  sessionId: string,
  body: Record<string, unknown>,
): Promise<{ status: number; json: Record<string, unknown> }> {
  return page.evaluate(
    async ({ sessionId: id, body: requestBody }) => {
      const response = await fetch(`/api/sessions/${encodeURIComponent(id)}/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      let json: Record<string, unknown> = {};
      try {
        json = (await response.json()) as Record<string, unknown>;
      } catch {
        // A rejected run may not carry JSON; the caller asserts on the status.
      }
      return { status: response.status, json };
    },
    { sessionId, body },
  );
}

/** Captures the original chat-run action id from the browser's runs POST. */
async function submitPromptAndCaptureRunActionId(page: Page, text: string): Promise<string> {
  const runRequest = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      /\/api\/sessions\/[^/]+\/runs$/.test(new URL(request.url()).pathname),
  );
  await submitPrompt(page, text);
  const body = (await runRequest).postDataJSON() as { actionId?: string };
  return String(body.actionId ?? "");
}

/** Bounded wait for a real settlement signal; never the sole success criterion. */
async function settlesWithin(promise: Promise<void>, timeoutMs: number): Promise<boolean> {
  return Promise.race([
    promise.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);
}

/** Live server session state for a session (what the reopened transcript renders). */
async function fetchSessionSnapshot(
  page: Page,
  sessionId: string,
): Promise<{ entries: unknown[]; events: unknown[] }> {
  return page.evaluate(async (id) => {
    const response = await fetch(`/api/sessions/${encodeURIComponent(id)}/bootstrap`);
    const payload = (await response.json()) as {
      snapshot?: { entries?: unknown[]; events?: unknown[] };
    };
    return {
      entries: Array.isArray(payload.snapshot?.entries) ? payload.snapshot.entries : [],
      events: Array.isArray(payload.snapshot?.events) ? payload.snapshot.events : [],
    };
  }, sessionId);
}

/** Polls the live session snapshot until the predicate holds (bounded). */
async function waitForSessionEntries(
  page: Page,
  sessionId: string,
  predicate: (entries: readonly unknown[]) => boolean,
  timeoutMs = 10_000,
): Promise<{ entries: unknown[]; events: unknown[] }> {
  const deadline = Date.now() + timeoutMs;
  let snapshot = await fetchSessionSnapshot(page, sessionId);
  while (Date.now() < deadline) {
    if (predicate(snapshot.entries)) return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 100));
    snapshot = await fetchSessionSnapshot(page, sessionId);
  }
  return snapshot;
}

/**
 * True only for a *completed* assistant answer about NVDA, never the user's
 * original input and never an aborted/errored in-stream message.
 */
function hasCompletedNvdaAnswer(entries: readonly unknown[]): boolean {
  return assistantMessages(entries).some((message) => {
    if (message.stopReason === "aborted" || message.stopReason === "error") return false;
    const text = messageContentText(message.content);
    return text.includes("NVDA is trading at") || text.includes("$185.25");
  });
}

/**
 * True only for a native Pi assistant turn that Stop aborted mid answer stream:
 * it carries NVDA answer text and its stopReason is exactly "aborted".
 */
function hasAbortedNvdaAnswer(entries: readonly unknown[]): boolean {
  return assistantMessages(entries).some((message) => {
    if (message.stopReason !== "aborted") return false;
    const text = messageContentText(message.content);
    return text.includes("NVDA is trading at") || text.includes("$185.25");
  });
}

function assistantMessages(
  entries: readonly unknown[],
): Array<{ content: unknown; stopReason?: unknown }> {
  const messages: Array<{ content: unknown; stopReason?: unknown }> = [];
  for (const entry of entries) {
    if (!isRecord(entry) || entry.type !== "message" || !isRecord(entry.message)) continue;
    if (entry.message.role !== "assistant") continue;
    messages.push({ content: entry.message.content, stopReason: entry.message.stopReason });
  }
  return messages;
}

function messageContentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .flatMap((block) =>
        isRecord(block) && block.type === "text" && typeof block.text === "string"
          ? [block.text]
          : [],
      )
      .join("");
  }
  return "";
}

/** Exact durable marker the finalized contract appends for a stopped turn. */
function findRunCancelledMarker(entries: readonly unknown[], expectedText: string): unknown {
  return entries.find((entry) => {
    if (!isRecord(entry) || entry.type !== "custom") return false;
    if (entry.customType !== "opencandle-run-cancelled") return false;
    return isRecord(entry.data) && entry.data.text === expectedText;
  });
}

/** Bounded poll for the documented no-active/stale run-cancel acknowledgement. */
async function waitForRunCancelReason(
  page: Page,
  sessionId: string,
  targetActionId: string,
  reason: "no_active_run" | "stale_target",
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const probe = await postRunCancel(page, sessionId, {
      sessionId,
      actionId: `stop-probe-${Date.now()}`,
      targetActionId,
    });
    if (probe.json.ok === true && probe.json.cancelled === false && probe.json.reason === reason) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
