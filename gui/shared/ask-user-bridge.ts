import type { AskUserHandler } from "../../src/types/index.js";

type AskUserParams = Parameters<AskUserHandler>[0];
type AskUserResult = Awaited<ReturnType<AskUserHandler>>;

export interface GuiAskUserPrompt extends AskUserParams {
  id: string;
  sessionId: string;
  status: "pending" | "answered" | "cancelled";
  answer: string | null;
}

interface PendingPrompt {
  prompt: GuiAskUserPrompt;
  resolve: (result: AskUserResult) => void;
}

/** Shared interactive-prompt state machine for local and hosted GUIs. */
export function createAskUserBridge({
  broadcast,
  getSessionId,
}: {
  broadcast: (message: unknown) => void;
  getSessionId: () => string;
}): {
  ask: AskUserHandler;
  askForSession: (sessionId: string) => AskUserHandler;
  answer: (id: string, answer: string) => boolean;
  cancel: (id: string) => boolean;
  /**
   * Cancel every open question for a session (its run was stopped), so the
   * tool waiting on each one settles as cancelled. Returns how many settled.
   */
  cancelForSession: (sessionId: string) => number;
  getPrompts: () => GuiAskUserPrompt[];
} {
  let nextId = 1;
  const prompts = new Map<string, GuiAskUserPrompt>();
  const pending = new Map<string, PendingPrompt>();

  const createAskHandler =
    (resolveSessionId: () => string): AskUserHandler =>
    async (params, options) => {
      const signal = options?.signal;
      // A stopped run never opens a question it cannot wait for.
      if (signal?.aborted) return { answer: null, cancelled: true };
      const id = `ask-user-${Date.now()}-${nextId++}`;
      const prompt: GuiAskUserPrompt = {
        id,
        sessionId: resolveSessionId(),
        question: params.question,
        questionType: params.questionType,
        options: params.options,
        placeholder: params.placeholder,
        reason: params.reason,
        status: "pending",
        answer: null,
      };
      prompts.set(id, prompt);
      broadcast({ type: "ask_user.prompt", prompt });

      const settled = new Promise<AskUserResult>((resolve) => {
        pending.set(id, { prompt, resolve });
      });
      const cancelOnAbort = () => resolvePrompt(id, { answer: null, cancelled: true });
      signal?.addEventListener("abort", cancelOnAbort, { once: true });
      return settled.finally(() => signal?.removeEventListener("abort", cancelOnAbort));
    };
  const ask = createAskHandler(getSessionId);

  const resolvePrompt = (id: string, result: AskUserResult): boolean => {
    const item = pending.get(id);
    if (!item) return false;
    pending.delete(id);
    const prompt: GuiAskUserPrompt = {
      ...item.prompt,
      status: result.cancelled ? "cancelled" : "answered",
      answer: result.cancelled ? null : (result.answer ?? null),
    };
    prompts.set(id, prompt);
    broadcast({ type: "ask_user.resolved", prompt });
    item.resolve(result);
    return true;
  };

  return {
    ask,
    askForSession(sessionId) {
      return createAskHandler(() => sessionId);
    },
    answer(id, answer) {
      return resolvePrompt(id, { answer, cancelled: false });
    },
    cancel(id) {
      return resolvePrompt(id, { answer: null, cancelled: true });
    },
    cancelForSession(sessionId) {
      let cancelled = 0;
      for (const [id, item] of [...pending]) {
        if (item.prompt.sessionId !== sessionId) continue;
        if (resolvePrompt(id, { answer: null, cancelled: true })) cancelled += 1;
      }
      return cancelled;
    },
    getPrompts() {
      return [...prompts.values()];
    },
  };
}
