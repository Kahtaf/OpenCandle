/**
 * File-based askUserHandler that bridges the IPC channel and trace collector.
 * Writes question.json via IPC, polls for answer.json, records interactions in trace.
 */
import type { AskUserHandler } from "../../src/types/index.js";
import type { IpcChannel } from "./ipc.js";
import type { TraceCollector } from "./trace-collector.js";

export function createIpcAskHandler(
  ipc: IpcChannel,
  traceCollector: TraceCollector,
  timeoutMs = 300_000,
): AskUserHandler {
  return async (params) => {
    ipc.writeQuestion({
      question: params.question,
      questionType: params.questionType,
      options: params.options,
      placeholder: params.placeholder,
      reason: params.reason,
    });

    const result = await ipc.pollForAnswer(timeoutMs);

    if (!result) {
      // Timeout
      ipc.setStatus("running");
      traceCollector.addInteraction({
        question: params.question,
        method: params.questionType,
        options: params.options,
        answer: null,
      });
      return { answer: null, cancelled: true };
    }

    ipc.setStatus("running");
    traceCollector.addInteraction({
      question: params.question,
      method: params.questionType,
      options: params.options,
      answer: result.value,
    });
    return { answer: result.value, cancelled: false };
  };
}
