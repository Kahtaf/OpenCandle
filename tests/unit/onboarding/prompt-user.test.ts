import { afterEach, describe, expect, it, vi } from "vitest";
import { promptUser } from "../../../src/onboarding/prompt-user.js";
import type { AskUserHandler } from "../../../src/types/index.js";

function createUi(overrides: Partial<any> = {}) {
  return {
    select: vi.fn(),
    input: vi.fn(),
    notify: vi.fn(),
    confirm: vi.fn(),
    custom: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("promptUser — select branch", () => {
  it("routes to ctx.ui.select with the question and options", async () => {
    const ui = createUi();
    ui.select.mockResolvedValueOnce("Option B");
    const ctx = { hasUI: true, ui } as any;

    const result = await promptUser(ctx, {
      question: "Pick one",
      questionType: "select",
      options: ["Option A", "Option B", "Option C"],
    });

    expect(ui.select).toHaveBeenCalledWith("Pick one", ["Option A", "Option B", "Option C"]);
    expect(result).toEqual({ answer: "Option B", cancelled: false });
  });

  it("returns cancelled when user dismisses the select", async () => {
    const ui = createUi();
    ui.select.mockResolvedValueOnce(undefined);
    const ctx = { hasUI: true, ui } as any;

    const result = await promptUser(ctx, {
      question: "Pick one",
      questionType: "select",
      options: ["a", "b"],
    });

    expect(result).toEqual({ answer: null, cancelled: true });
  });

  it("returns an error answer when select is called without options", async () => {
    const ui = createUi();
    const ctx = { hasUI: true, ui } as any;

    const result = await promptUser(ctx, {
      question: "Bad call",
      questionType: "select",
    });

    expect(result.cancelled).toBe(true);
    expect(ui.select).not.toHaveBeenCalled();
  });
});

describe("promptUser — text branch", () => {
  it("routes to ctx.ui.input and trims the answer", async () => {
    const ui = createUi();
    ui.input.mockResolvedValueOnce("  paste-here  ");
    const ctx = { hasUI: true, ui } as any;

    const result = await promptUser(ctx, {
      question: "Paste your key",
      questionType: "text",
      placeholder: "sk-...",
    });

    expect(ui.input).toHaveBeenCalledWith("Paste your key", "sk-...");
    expect(result).toEqual({ answer: "paste-here", cancelled: false });
  });

  it("returns cancelled when input is empty", async () => {
    const ui = createUi();
    ui.input.mockResolvedValueOnce("   ");
    const ctx = { hasUI: true, ui } as any;

    const result = await promptUser(ctx, {
      question: "Paste your key",
      questionType: "text",
    });

    expect(result).toEqual({ answer: null, cancelled: true });
  });

  it("returns cancelled when input is undefined", async () => {
    const ui = createUi();
    ui.input.mockResolvedValueOnce(undefined);
    const ctx = { hasUI: true, ui } as any;

    const result = await promptUser(ctx, {
      question: "Paste your key",
      questionType: "text",
    });

    expect(result).toEqual({ answer: null, cancelled: true });
  });
});

describe("promptUser — confirm branch", () => {
  it("routes to ctx.ui.confirm and returns Yes/No", async () => {
    const ui = createUi();
    ui.confirm.mockResolvedValueOnce(true);
    const ctx = { hasUI: true, ui } as any;

    const result = await promptUser(ctx, {
      question: "Are you sure?",
      questionType: "confirm",
      reason: "This deletes data",
    });

    expect(ui.confirm).toHaveBeenCalledWith("Are you sure?", "This deletes data");
    expect(result).toEqual({ answer: "Yes", cancelled: false });
  });

  it("returns No when user declines", async () => {
    const ui = createUi();
    ui.confirm.mockResolvedValueOnce(false);
    const ctx = { hasUI: true, ui } as any;

    const result = await promptUser(ctx, {
      question: "Are you sure?",
      questionType: "confirm",
    });

    expect(result).toEqual({ answer: "No", cancelled: false });
  });
});

describe("promptUser — headless fallback (no UI)", () => {
  it("returns cancelled when ctx.hasUI is false and no handler is injected", async () => {
    const ctx = { hasUI: false, ui: {} } as any;

    const result = await promptUser(ctx, {
      question: "Pick one",
      questionType: "select",
      options: ["a", "b"],
    });

    expect(result).toEqual({ answer: null, cancelled: true });
  });
});

describe("promptUser — injected askUserHandler", () => {
  it("consults the injected handler and bypasses ctx.ui entirely", async () => {
    const ui = createUi();
    ui.select.mockResolvedValueOnce("should not be called");

    const handler: AskUserHandler = vi.fn(async () => ({
      answer: "Option C",
      cancelled: false,
    }));

    const ctx = { hasUI: true, ui } as any;

    const result = await promptUser(
      ctx,
      {
        question: "Pick one",
        questionType: "select",
        options: ["Option A", "Option B", "Option C"],
      },
      handler,
    );

    expect(handler).toHaveBeenCalledWith({
      question: "Pick one",
      questionType: "select",
      options: ["Option A", "Option B", "Option C"],
      placeholder: undefined,
      reason: undefined,
    });
    expect(ui.select).not.toHaveBeenCalled();
    expect(result).toEqual({ answer: "Option C", cancelled: false });
  });

  it("returns cancelled when the injected handler cancels", async () => {
    const handler: AskUserHandler = vi.fn(async () => ({
      answer: null,
      cancelled: true,
    }));
    const ctx = { hasUI: false, ui: {} } as any;

    const result = await promptUser(ctx, { question: "Q", questionType: "text" }, handler);

    expect(result).toEqual({ answer: null, cancelled: true });
  });
});

describe("promptUser — abort signal", () => {
  it("returns cancelled without asking when the run was already stopped", async () => {
    const handler: AskUserHandler = vi.fn(async () => ({ answer: "late", cancelled: false }));
    const ui = createUi();
    const controller = new AbortController();
    controller.abort();

    const result = await promptUser(
      { hasUI: true, ui } as any,
      { question: "Q", questionType: "select", options: ["a"] },
      handler,
      controller.signal,
    );

    expect(result).toEqual({ answer: null, cancelled: true });
    expect(handler).not.toHaveBeenCalled();
    expect(ui.select).not.toHaveBeenCalled();
  });

  it("forwards the run signal to the injected handler", async () => {
    const handler: AskUserHandler = vi.fn(async () => ({ answer: "a", cancelled: false }));
    const controller = new AbortController();

    await promptUser(
      { hasUI: false, ui: {} } as any,
      { question: "Q", questionType: "select", options: ["a"] },
      handler,
      controller.signal,
    );

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ question: "Q" }), {
      signal: controller.signal,
    });
  });

  it("dismisses the TUI dialog and reports cancelled when the run is stopped", async () => {
    const controller = new AbortController();
    const ui = createUi();
    ui.confirm.mockImplementationOnce(
      (_title: string, _message: string, opts?: { signal?: AbortSignal }) =>
        new Promise<boolean>((resolve) => {
          opts?.signal?.addEventListener("abort", () => resolve(false), { once: true });
        }),
    );

    const pending = promptUser(
      { hasUI: true, ui } as any,
      { question: "Proceed?", questionType: "confirm" },
      undefined,
      controller.signal,
    );
    controller.abort();

    await expect(pending).resolves.toEqual({ answer: null, cancelled: true });
    expect(ui.confirm).toHaveBeenCalledWith("Proceed?", "", { signal: controller.signal });
  });
});
