// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../../../gui/web/src/components/ui/tooltip.jsx";
import { ChatPanel } from "../../../gui/web/src/features/chat/ChatPanel.jsx";
import { ToolDrawerProvider } from "../../../gui/web/src/features/chat/tool-drawer-context.jsx";
import { notifySessionActionError } from "../../../gui/web/src/lib/session-action-errors.js";

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

const pendingTextPrompt = {
  id: "ask-1",
  sessionId: "s1",
  question: "Which ticker?",
  questionType: "text",
  status: "pending",
  answer: null,
};

function renderChatPanel(send: (type: string, payload: unknown) => boolean) {
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
            askUserPrompts: [pendingTextPrompt],
            modelSetup: { requirement: "ready", providers: [], availableModels: [] },
            role: "writer",
            runState: "running",
            catalog: { tools: [], workflows: [], providers: [] },
            send,
            startChatRun: vi.fn(),
            setToast: vi.fn(),
            onOpenCommandPalette: vi.fn(),
            sessionId: "s1",
          }),
        ),
      ),
    );
  });
}

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("ask_user prompt card", () => {
  it("keeps the typed answer until the question actually resolves", () => {
    const send = vi.fn(() => true);
    renderChatPanel(send);
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Which ticker?"]');
    expect(input).not.toBeNull();
    if (!input) return;

    typeInto(input, "AAPL");
    const submit = container.querySelector<HTMLButtonElement>('button[aria-label="Send answer"]');
    act(() => submit?.click());

    expect(send).toHaveBeenCalledWith("ask_user.answer", {
      id: "ask-1",
      sessionId: "s1",
      answer: "AAPL",
      actionId: expect.stringMatching(/^ask-user-answer-/),
    });
    // The server may still reject the answer (error toast); the question is
    // still pending, so the user's draft must survive for a retry.
    expect(input.value).toBe("AAPL");
  });

  it("sends an answer once while it is in flight, and allows a retry after it is rejected", () => {
    const send = vi.fn(() => true);
    renderChatPanel(send);
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Which ticker?"]');
    if (!input) throw new Error("answer input missing");
    typeInto(input, "AAPL");
    const submit = () =>
      container.querySelector<HTMLButtonElement>('button[aria-label="Send answer"]')?.click();

    // A double click (or a second Enter) before the question resolves must
    // not send a second answer that fails as "Unknown or resolved question".
    act(() => submit());
    act(() => submit());
    expect(send).toHaveBeenCalledTimes(1);
    const firstActionId = (send.mock.calls[0] as unknown[])[1] as { actionId: string };

    // An unrelated request's failure does not re-enable the answer.
    act(() => notifySessionActionError("some-other-action"));
    act(() => submit());
    expect(send).toHaveBeenCalledTimes(1);

    // The server rejected this answer: the kept draft can be sent again.
    act(() => notifySessionActionError(firstActionId.actionId));
    expect(input.value).toBe("AAPL");
    act(() => submit());
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("allows a retry when the answer never left the browser", () => {
    const send = vi.fn(() => false);
    renderChatPanel(send);
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Which ticker?"]');
    if (!input) throw new Error("answer input missing");
    typeInto(input, "AAPL");
    const submit = () =>
      container.querySelector<HTMLButtonElement>('button[aria-label="Send answer"]')?.click();
    act(() => submit());
    act(() => submit());
    expect(send).toHaveBeenCalledTimes(2);
  });
});
