import { describe, it, expect, vi } from "vitest";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerAskUserTool } from "../../../src/tools/interaction/ask-user.js";
import type { AskUserHandler } from "../../../src/types/index.js";

function createMockCtx(hasUI: boolean) {
  return {
    hasUI,
    ui: {
      select: vi.fn(),
      input: vi.fn(),
      confirm: vi.fn(),
      notify: vi.fn(),
    },
  };
}

function captureRegisteredTool(askUserHandler?: AskUserHandler) {
  let captured: any = null;
  const mockPi = {
    registerTool: (tool: any) => { captured = tool; },
  } as unknown as ExtensionAPI;
  registerAskUserTool(mockPi, askUserHandler);
  return captured;
}

describe("ask_user tool", () => {
  const tool = captureRegisteredTool();

  it("has correct tool metadata", () => {
    expect(tool.name).toBe("ask_user");
    expect(tool.label).toBe("Ask User");
    expect(tool.description).toBeTruthy();
    expect(tool.promptSnippet).toContain("ask_user");
  });

  it("returns no-UI fallback when ctx.hasUI is false", async () => {
    const ctx = createMockCtx(false);
    const result = await tool.execute(
      "call-1",
      { question: "Which ticker?", question_type: "select", options: ["AAPL", "MSFT"] },
      undefined, undefined, ctx,
    );
    expect(result.details.cancelled).toBe(true);
    expect(result.details.answer).toBeNull();
    expect(result.content[0].text).toContain("UI not available");
  });

  it("returns no-UI fallback when ctx is undefined", async () => {
    const result = await tool.execute(
      "call-1",
      { question: "Which ticker?", question_type: "text" },
      undefined, undefined, undefined,
    );
    expect(result.details.cancelled).toBe(true);
    expect(result.content[0].text).toContain("UI not available");
  });

  it("select — returns chosen option", async () => {
    const ctx = createMockCtx(true);
    ctx.ui.select.mockResolvedValue("Technology");
    const result = await tool.execute(
      "call-1",
      { question: "Which sector?", question_type: "select", options: ["Technology", "Healthcare", "Energy"] },
      undefined, undefined, ctx,
    );
    expect(result.details.cancelled).toBe(false);
    expect(result.details.answer).toBe("Technology");
    expect(result.content[0].text).toContain("Technology");
    expect(ctx.ui.select).toHaveBeenCalledWith("Which sector?", ["Technology", "Healthcare", "Energy"]);
  });

  it("select — returns cancelled when user dismisses", async () => {
    const ctx = createMockCtx(true);
    ctx.ui.select.mockResolvedValue(undefined);
    const result = await tool.execute(
      "call-1",
      { question: "Which sector?", question_type: "select", options: ["Tech", "Health"] },
      undefined, undefined, ctx,
    );
    expect(result.details.cancelled).toBe(true);
    expect(result.details.answer).toBeNull();
    expect(result.content[0].text).toContain("cancelled");
  });

  it("select — errors when options array is empty", async () => {
    const ctx = createMockCtx(true);
    const result = await tool.execute(
      "call-1",
      { question: "Pick one", question_type: "select", options: [] },
      undefined, undefined, ctx,
    );
    expect(result.details.cancelled).toBe(true);
    expect(result.content[0].text).toContain("No options provided");
  });

  it("text — returns user input", async () => {
    const ctx = createMockCtx(true);
    ctx.ui.input.mockResolvedValue("AAPL");
    const result = await tool.execute(
      "call-1",
      { question: "Enter a ticker symbol", question_type: "text", placeholder: "e.g. AAPL" },
      undefined, undefined, ctx,
    );
    expect(result.details.cancelled).toBe(false);
    expect(result.details.answer).toBe("AAPL");
    expect(ctx.ui.input).toHaveBeenCalledWith("Enter a ticker symbol", "e.g. AAPL");
  });

  it("text — returns cancelled when user dismisses", async () => {
    const ctx = createMockCtx(true);
    ctx.ui.input.mockResolvedValue(undefined);
    const result = await tool.execute(
      "call-1",
      { question: "Enter a ticker", question_type: "text" },
      undefined, undefined, ctx,
    );
    expect(result.details.cancelled).toBe(true);
    expect(result.details.answer).toBeNull();
  });

  it("text — returns cancelled when user submits empty string", async () => {
    const ctx = createMockCtx(true);
    ctx.ui.input.mockResolvedValue("   ");
    const result = await tool.execute(
      "call-1",
      { question: "Enter a ticker", question_type: "text" },
      undefined, undefined, ctx,
    );
    expect(result.details.cancelled).toBe(true);
    expect(result.details.answer).toBeNull();
  });

  it("confirm — returns Yes", async () => {
    const ctx = createMockCtx(true);
    ctx.ui.confirm.mockResolvedValue(true);
    const result = await tool.execute(
      "call-1",
      { question: "Include options analysis?", question_type: "confirm", reason: "Options data adds depth" },
      undefined, undefined, ctx,
    );
    expect(result.details.cancelled).toBe(false);
    expect(result.details.answer).toBe("Yes");
    expect(ctx.ui.confirm).toHaveBeenCalledWith("Include options analysis?", "Options data adds depth");
  });

  it("confirm — returns No", async () => {
    const ctx = createMockCtx(true);
    ctx.ui.confirm.mockResolvedValue(false);
    const result = await tool.execute(
      "call-1",
      { question: "Proceed?", question_type: "confirm" },
      undefined, undefined, ctx,
    );
    expect(result.details.cancelled).toBe(false);
    expect(result.details.answer).toBe("No");
  });
});

describe("ask_user tool with injected handler", () => {
  it("handler receives correct params and answer flows back", async () => {
    const handler = vi.fn<Parameters<AskUserHandler>, ReturnType<AskUserHandler>>()
      .mockResolvedValue({ answer: "Technology", cancelled: false });

    const tool = captureRegisteredTool(handler);
    const ctx = createMockCtx(true);

    const result = await tool.execute(
      "call-1",
      {
        question: "Which sector?",
        question_type: "select",
        options: ["Technology", "Healthcare"],
        placeholder: "pick one",
        reason: "need to narrow search",
      },
      undefined, undefined, ctx,
    );

    // Handler receives all params correctly
    expect(handler).toHaveBeenCalledWith({
      question: "Which sector?",
      questionType: "select",
      options: ["Technology", "Healthcare"],
      placeholder: "pick one",
      reason: "need to narrow search",
    });

    // Answer flows back to tool result
    expect(result.details.cancelled).toBe(false);
    expect(result.details.answer).toBe("Technology");
    expect(result.content[0].text).toContain("Technology");

    // UI methods are NOT called — handler takes priority
    expect(ctx.ui.select).not.toHaveBeenCalled();
  });

  it("handler cancelled result returns cancelled tool result", async () => {
    const handler = vi.fn<Parameters<AskUserHandler>, ReturnType<AskUserHandler>>()
      .mockResolvedValue({ answer: null, cancelled: true });

    const tool = captureRegisteredTool(handler);
    const result = await tool.execute(
      "call-1",
      { question: "Risk tolerance?", question_type: "text" },
      undefined, undefined, undefined,
    );

    expect(result.details.cancelled).toBe(true);
    expect(result.details.answer).toBeNull();
    expect(result.content[0].text).toContain("cancelled");
  });

  it("handler takes priority over ctx.hasUI", async () => {
    const handler = vi.fn<Parameters<AskUserHandler>, ReturnType<AskUserHandler>>()
      .mockResolvedValue({ answer: "Yes", cancelled: false });

    const tool = captureRegisteredTool(handler);
    const ctx = createMockCtx(true); // UI available, but handler should still win

    const result = await tool.execute(
      "call-1",
      { question: "Proceed?", question_type: "confirm" },
      undefined, undefined, ctx,
    );

    expect(handler).toHaveBeenCalled();
    expect(result.details.answer).toBe("Yes");
    expect(ctx.ui.confirm).not.toHaveBeenCalled();
  });

  it("handler takes priority over no-UI fallback", async () => {
    const handler = vi.fn<Parameters<AskUserHandler>, ReturnType<AskUserHandler>>()
      .mockResolvedValue({ answer: "AAPL", cancelled: false });

    const tool = captureRegisteredTool(handler);
    // No ctx at all — without handler, would return no-UI fallback
    const result = await tool.execute(
      "call-1",
      { question: "Enter ticker", question_type: "text" },
      undefined, undefined, undefined,
    );

    expect(result.details.cancelled).toBe(false);
    expect(result.details.answer).toBe("AAPL");
  });
});
