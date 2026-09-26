// Shared prompt primitive used by both the `ask_user` tool and the
// credential-interception handler in the Pi `tool_result` hook.
//
// The original `ask_user` tool embedded its UI routing in a closure inside
// `execute()`. Extracting it here means the `tool_result` handler can call
// the same logic without synthesizing a fake tool call (Pi has no "execute
// a tool now" API), and the headless harness's `askUserHandler` injection
// point is preserved for automated flows.

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AskUserHandler } from "../types/index.js";

export interface PromptOptions {
  question: string;
  questionType: "select" | "text" | "confirm";
  options?: string[];
  placeholder?: string;
  reason?: string;
}

export interface PromptResult {
  answer: string | null;
  cancelled: boolean;
}

/**
 * Ask the user a structured question, routing to the appropriate UI primitive
 * (`ctx.ui.select` / `ctx.ui.input` / `ctx.ui.confirm`).
 *
 * When an `askUserHandler` is injected (test harness, programmatic runs), the
 * handler takes precedence over `ctx.ui` and provides the answer directly.
 *
 * When neither a handler nor a UI is available, returns `{answer: null, cancelled: true}`.
 *
 * `signal` is the asking tool's run signal: a stopped run never opens a new
 * question, and an open one is dismissed and reported as cancelled.
 */
export async function promptUser(
  ctx: ExtensionContext | undefined,
  opts: PromptOptions,
  handler?: AskUserHandler,
  signal?: AbortSignal,
): Promise<PromptResult> {
  if (signal?.aborted) return { answer: null, cancelled: true };
  const result = await askOnce(ctx, opts, handler, signal);
  return signal?.aborted ? { answer: null, cancelled: true } : result;
}

async function askOnce(
  ctx: ExtensionContext | undefined,
  opts: PromptOptions,
  handler: AskUserHandler | undefined,
  signal: AbortSignal | undefined,
): Promise<PromptResult> {
  const dialogOptions = signal ? [{ signal }] : [];
  // Priority: injected handler > UI > no-UI fallback.
  if (handler) {
    const result = await handler(
      {
        question: opts.question,
        questionType: opts.questionType,
        options: opts.options,
        placeholder: opts.placeholder,
        reason: opts.reason,
      },
      ...dialogOptions,
    );
    if (result.cancelled) {
      return { answer: null, cancelled: true };
    }
    return { answer: result.answer ?? null, cancelled: false };
  }

  if (!ctx?.hasUI) {
    return { answer: null, cancelled: true };
  }

  switch (opts.questionType) {
    case "select": {
      const options = opts.options ?? [];
      if (options.length === 0) {
        return { answer: null, cancelled: true };
      }
      const choice = await ctx.ui.select(opts.question, options, ...dialogOptions);
      if (choice === undefined) {
        return { answer: null, cancelled: true };
      }
      return { answer: choice, cancelled: false };
    }

    case "text": {
      const input = await ctx.ui.input(opts.question, opts.placeholder ?? "", ...dialogOptions);
      if (input === undefined || input.trim() === "") {
        return { answer: null, cancelled: true };
      }
      return { answer: input.trim(), cancelled: false };
    }

    case "confirm": {
      const confirmed = await ctx.ui.confirm(opts.question, opts.reason ?? "", ...dialogOptions);
      return { answer: confirmed ? "Yes" : "No", cancelled: false };
    }
  }
}
