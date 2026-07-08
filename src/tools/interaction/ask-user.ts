import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { promptUser } from "../../onboarding/prompt-user.js";
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
    {
      description:
        "Type of answer expected: select (pick from options), text (free input), or confirm (yes/no)",
    },
  ),
  options: Type.Optional(
    Type.Array(Type.String(), { description: "Choices for select-type questions" }),
  ),
  placeholder: Type.Optional(Type.String({ description: "Hint text for text input" })),
  reason: Type.Optional(
    Type.String({ description: "Brief context for why this clarification is needed" }),
  ),
});

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

      // Preserve the pre-refactor error message for the specific misuse case
      // where the model asks a select question with no options — this is a
      // model/caller bug, not a cancellation.
      if (questionType === "select" && (!params.options || params.options.length === 0)) {
        return {
          content: [
            {
              type: "text",
              text: "Error: No options provided for select question. Provide options or use text type instead.",
            },
          ],
          details: { question, questionType, answer: null, cancelled: true } as AskUserDetails,
        };
      }

      if (!ctx && !askUserHandler) {
        return {
          content: [
            {
              type: "text",
              text: "UI not available (non-interactive mode). Proceed with your best judgment and clearly disclose your assumption.",
            },
          ],
          details: { question, questionType, answer: null, cancelled: true } as AskUserDetails,
        };
      }

      const result = await promptUser(
        ctx,
        {
          question,
          questionType,
          options: params.options,
          placeholder: params.placeholder,
          reason: params.reason,
        },
        askUserHandler,
      );

      if (result.cancelled) {
        const text =
          !askUserHandler && !ctx?.hasUI
            ? "UI not available (non-interactive mode). Proceed with your best judgment and clearly disclose your assumption."
            : "User cancelled the selection. Proceed with your best judgment and disclose your assumption.";
        return {
          content: [{ type: "text", text }],
          details: { question, questionType, answer: null, cancelled: true } as AskUserDetails,
        };
      }

      return {
        content: [{ type: "text", text: `User answered: ${result.answer}` }],
        details: {
          question,
          questionType,
          answer: result.answer,
          cancelled: false,
        } as AskUserDetails,
      };
    },
  });
}
