import { describe, expect, it } from "vitest";
import { createBrowserModelRuntime } from "../../../gui/hosted/runtime/browser-model-runtime.js";

describe("browser Pi model runtime", () => {
  it("stores credentials per provider and exposes their installed Pi models", async () => {
    const runtime = await createBrowserModelRuntime({
      openai: "openai-key",
      anthropic: "anthropic-key",
    });

    expect(runtime.hasConfiguredAuth("openai")).toBe(true);
    expect(runtime.hasConfiguredAuth("anthropic")).toBe(true);
    expect(runtime.hasConfiguredAuth("google")).toBe(false);
    expect(runtime.getAvailableSnapshot().some((model) => model.provider === "openai")).toBe(true);
    expect(runtime.getAvailableSnapshot().some((model) => model.provider === "anthropic")).toBe(
      true,
    );
    expect(runtime.constructor.name).toBe("ModelRuntime");
  });
});
