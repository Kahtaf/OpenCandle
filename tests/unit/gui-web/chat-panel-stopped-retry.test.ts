// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../../../gui/web/src/components/ui/tooltip.jsx";
import { ChatPanel } from "../../../gui/web/src/features/chat/ChatPanel.jsx";
import { ToolDrawerProvider } from "../../../gui/web/src/features/chat/tool-drawer-context.jsx";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({}), { headers: { "content-type": "application/json" } }),
      ),
  );
  // jsdom has no layout; the transcript scroller needs this before mounting.
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stoppedEvents(prompt?: string) {
  return [
    {
      type: "custom.message",
      sessionId: "s1",
      messageId: "stopped-1",
      customType: "opencandle-run-cancelled",
      content: [{ type: "text", text: "Run stopped before it produced an answer." }],
      details: { reason: "aborted", ...(prompt === undefined ? {} : { prompt }) },
      seq: 1,
    },
  ];
}

function renderChatPanel(props: Record<string, unknown>) {
  act(() => {
    root.render(
      React.createElement(
        TooltipProvider,
        null,
        React.createElement(
          ToolDrawerProvider,
          null,
          React.createElement(ChatPanel, {
            events: [],
            liveEvents: [],
            askUserPrompts: [],
            modelSetup: { requirement: "ready", providers: [], availableModels: [] },
            role: "writer",
            runState: "ready",
            catalog: { tools: [], workflows: [], providers: [] },
            send: vi.fn(),
            startChatRun: vi.fn(),
            setToast: vi.fn(),
            onOpenCommandPalette: vi.fn(),
            sessionId: "s1",
            ...props,
          }),
        ),
      ),
    );
  });
}

function clickRetry() {
  const button = [...document.body.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === "Retry",
  );
  expect(button).toBeTruthy();
  act(() => {
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("ChatPanel Retry on a stopped turn", () => {
  it("re-runs the session's latest run through retryRun when the stopped prompt matches it", () => {
    const retryRun = vi.fn();
    const startChatRun = vi.fn();
    renderChatPanel({
      events: stoppedEvents("compare AAPL and MSFT"),
      lastPrompt: "compare AAPL and MSFT",
      retryRun,
      startChatRun,
    });

    clickRetry();

    expect(retryRun).toHaveBeenCalledTimes(1);
    expect(startChatRun).not.toHaveBeenCalled();
  });

  it("re-sends a stopped turn from an earlier page load as its own prompt", () => {
    const retryRun = vi.fn();
    const startChatRun = vi.fn();
    renderChatPanel({
      events: stoppedEvents("  quote NVDA  "),
      lastPrompt: "",
      retryRun,
      startChatRun,
    });

    clickRetry();

    expect(retryRun).not.toHaveBeenCalled();
    expect(startChatRun).toHaveBeenCalledTimes(1);
    expect(startChatRun.mock.calls[0]?.[0]).toBe("quote NVDA");
  });

  it("falls back to the last prompt when the stopped marker carries none", () => {
    const retryRun = vi.fn();
    renderChatPanel({ events: stoppedEvents(), lastPrompt: "analyze MSFT", retryRun });

    clickRetry();

    expect(retryRun).toHaveBeenCalledTimes(1);
  });

  it("does nothing when there is no prompt to retry", () => {
    const retryRun = vi.fn();
    const startChatRun = vi.fn();
    renderChatPanel({ events: stoppedEvents(), lastPrompt: "", retryRun, startChatRun });

    clickRetry();

    expect(retryRun).not.toHaveBeenCalled();
    expect(startChatRun).not.toHaveBeenCalled();
  });

  it("does not retry while another run is active", () => {
    const retryRun = vi.fn();
    const startChatRun = vi.fn();
    renderChatPanel({
      events: stoppedEvents("quote NVDA"),
      lastPrompt: "quote NVDA",
      runState: "streaming",
      retryRun,
      startChatRun,
    });

    clickRetry();

    expect(retryRun).not.toHaveBeenCalled();
    expect(startChatRun).not.toHaveBeenCalled();
  });
});
