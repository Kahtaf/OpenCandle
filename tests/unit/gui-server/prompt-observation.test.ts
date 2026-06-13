import { describe, expect, it } from "vitest";
import {
  createPromptObservation,
  observePromptEvent,
  selectReplayPrompt,
} from "../../../gui/server/prompt-observation.js";

describe("prompt observation replay selection", () => {
  it("selects a transformed workflow prompt when no assistant or tool event follows", () => {
    const observation = createPromptObservation();

    observePromptEvent(observation, {
      type: "message_start",
      message: {
        role: "user",
        content: [{ type: "text", text: "Screen and rank options contracts for AMD" }],
      },
    } as any);

    expect(selectReplayPrompt(observation, "What protective put should I buy?")).toBe(
      "Screen and rank options contracts for AMD",
    );
  });

  it("does not replay when an assistant turn starts", () => {
    const observation = createPromptObservation();

    observePromptEvent(observation, {
      type: "message_start",
      message: { role: "user", content: [{ type: "text", text: "workflow prompt" }] },
    } as any);
    observePromptEvent(observation, {
      type: "message_start",
      message: { role: "assistant", content: [] },
    } as any);

    expect(selectReplayPrompt(observation, "original")).toBeUndefined();
  });

  it("does not replay the original prompt", () => {
    const observation = createPromptObservation();

    observePromptEvent(observation, {
      type: "message_start",
      message: { role: "user", content: [{ type: "text", text: "same prompt" }] },
    } as any);

    expect(selectReplayPrompt(observation, "same prompt")).toBeUndefined();
  });
});
