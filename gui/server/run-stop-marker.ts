import type { Message } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

/**
 * Durable record that the user pressed Stop on a GUI run. A Stop that lands
 * while a tool is executing lets the tool finish, and the next model request
 * then fails with an abort-shaped error persisted as `stopReason: "error"`
 * (not `"aborted"`). The marker names exactly those assistant entries so the
 * transcript renders them as Stopped. Genuine provider aborts and timeouts
 * the user did not initiate carry no marker and stay model failures.
 */
export const RUN_STOPPED_CUSTOM_TYPE = "opencandle-run-stopped";

export interface RunStoppedMarkerData {
  actionId: string;
  prompt: string;
  assistantEntryIds: string[];
}

// Abort errors from fetch/AbortController and the pi-ai adapters:
// "This operation was aborted", "Request aborted", "AbortError", ...
const ABORT_SHAPED_ERROR = /\babort(?:ed|error)?\b/i;

export function isAbortShapedAssistantError(message: Message): boolean {
  if (message.role !== "assistant" || message.stopReason !== "error") return false;
  const errorMessage = (message as { errorMessage?: unknown }).errorMessage;
  return typeof errorMessage === "string" && ABORT_SHAPED_ERROR.test(errorMessage);
}

/** Marker data for a stopped run from the entries that run appended. */
export function buildRunStoppedMarker(
  runEntries: readonly SessionEntry[],
  run: { actionId: string; prompt: string },
): RunStoppedMarkerData {
  return {
    actionId: run.actionId,
    prompt: run.prompt,
    assistantEntryIds: runEntries
      .filter(
        (entry) =>
          entry.type === "message" && isAbortShapedAssistantError(entry.message as Message),
      )
      .map((entry) => entry.id),
  };
}

/**
 * Assistant entry ids a recorded user Stop covers, mapped to the stopped
 * run's original prompt (for Retry). Only abort-shaped errors qualify.
 */
export function userStoppedAssistantEntries(
  entries: readonly SessionEntry[],
): Map<string, string | null> {
  const stoppedIds = new Map<string, string | null>();
  for (const entry of entries) {
    if (entry.type !== "custom") continue;
    const custom = entry as { customType?: unknown; data?: unknown };
    if (custom.customType !== RUN_STOPPED_CUSTOM_TYPE) continue;
    const data = (custom.data ?? {}) as Partial<RunStoppedMarkerData>;
    const prompt = typeof data.prompt === "string" && data.prompt.trim() ? data.prompt : null;
    for (const id of Array.isArray(data.assistantEntryIds) ? data.assistantEntryIds : []) {
      if (typeof id === "string") stoppedIds.set(id, prompt);
    }
  }
  if (stoppedIds.size === 0) return stoppedIds;
  for (const entry of entries) {
    if (!stoppedIds.has(entry.id)) continue;
    if (entry.type !== "message" || !isAbortShapedAssistantError(entry.message as Message)) {
      stoppedIds.delete(entry.id);
    }
  }
  return stoppedIds;
}
