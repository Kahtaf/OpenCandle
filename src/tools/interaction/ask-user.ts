import { Type } from "@sinclair/typebox";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { AskUserHandler } from "../../types/index.js";

interface AskUserDetails {
  question: string;
  questionType: string;
  answer: string | null;
  cancelled: boolean;
}

const AskUserParams = Type.Object({
  question: Type.String({ description: "The question to ask the user" }),
  question_type: Type.Union(
    [Type.Literal("select"), Type.Literal("text"), Type.Literal("confirm")],
    { description: "Type of answer expected: select (pick from options), text (free input), or confirm (yes/no)" },
  ),
  options: Type.Optional(
    Type.Array(Type.String(), { description: "Choices for select-type questions" }),
  ),
  placeholder: Type.Optional(
    Type.String({ description: "Hint text for text input" }),
  ),
  reason: Type.Optional(
    Type.String({ description: "Brief context for why this clarification is needed" }),
  ),
});

function cancelledResult(question: string, questionType: string): {
  content: { type: "text"; text: string }[];
  details: AskUserDetails;
} {
  return {
    content: [{ type: "text", text: "User cancelled the selection. Proceed with your best judgment and disclose your assumption." }],
    details: { question, questionType, answer: null, cancelled: true },
  };
}

function answerResult(question: string, questionType: string, answer: string): {
  content: { type: "text"; text: string }[];
  details: AskUserDetails;
} {
  return {
    content: [{ type: "text", text: `User answered: ${answer}` }],
    details: { question, questionType, answer, cancelled: false },
  };
}

function noUiResult(question: string, questionType: string): {
  content: { type: "text"; text: string }[];
  details: AskUserDetails;
} {
  return {
    content: [{ type: "text", text: "UI not available (non-interactive mode). Proceed with your best judgment and clearly disclose your assumption." }],
    details: { question, questionType, answer: null, cancelled: true },
  };
}

export function registerAskUserTool(pi: ExtensionAPI, askUserHandler?: AskUserHandler): void {
  pi.registerTool({
    name: "ask_user",
    label: "Ask User",
    description:
      "Ask the user a clarification question when their request is ambiguous or missing key details. Use select for multiple-choice, text for free input, or confirm for yes/no.",
    promptSnippet:
      "ask_user: Ask the user a clarification question when their request is ambiguous or missing key details",
    parameters: AskUserParams,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { question, question_type: questionType } = params;

      // Priority: injected handler > UI > no-UI fallback
      if (askUserHandler) {
        const result = await askUserHandler({
          question,
          questionType,
          options: params.options,
          placeholder: params.placeholder,
          reason: params.reason,
        });
        if (result.cancelled) return cancelledResult(question, questionType);
        return answerResult(question, questionType, result.answer!);
      }

      if (!ctx?.hasUI) {
        return noUiResult(question, questionType);
      }

      switch (questionType) {
        case "select": {
          const options = params.options ?? [];
          if (options.length === 0) {
            return {
              content: [{ type: "text", text: "Error: No options provided for select question. Provide options or use text type instead." }],
              details: { question, questionType, answer: null, cancelled: true } as AskUserDetails,
            };
          }
          const choice = await ctx.ui.select(question, options);
          if (choice === undefined) {
            return cancelledResult(question, questionType);
          }
          return answerResult(question, questionType, choice);
        }

        case "text": {
          const input = await ctx.ui.input(question, params.placeholder ?? "");
          if (input === undefined || input.trim() === "") {
            return cancelledResult(question, questionType);
          }
          return answerResult(question, questionType, input.trim());
        }

        case "confirm": {
          const confirmed = await ctx.ui.confirm(question, params.reason ?? "");
          return answerResult(question, questionType, confirmed ? "Yes" : "No");
        }

        default:
          return {
            content: [{ type: "text", text: `Unknown question type: ${questionType}. Use select, text, or confirm.` }],
            details: { question, questionType, answer: null, cancelled: true } as AskUserDetails,
          };
      }
    },
  });
}
