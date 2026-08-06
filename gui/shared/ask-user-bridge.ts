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
  getPrompts: () => GuiAskUserPrompt[];
} {
  let nextId = 1;
  const prompts = new Map<string, GuiAskUserPrompt>();
  const pending = new Map<string, PendingPrompt>();

  const createAskHandler =
    (resolveSessionId: () => string): AskUserHandler =>
    async (params) => {
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

      return new Promise<AskUserResult>((resolve) => {
        pending.set(id, { prompt, resolve });
      });
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
    getPrompts() {
      return [...prompts.values()];
    },
  };
}
