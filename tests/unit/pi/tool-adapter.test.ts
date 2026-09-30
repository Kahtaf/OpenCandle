import { Type } from "@sinclair/typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import { httpGet } from "../../../src/infra/http-client.js";
import { agentToolToPiTool, getOpenCandleToolDefinitions } from "../../../src/pi/tool-adapter.js";
import { getAllTools } from "../../../src/tools/index.js";

describe("tool adapter", () => {
  it("maps an OpenCandle tool to a Pi tool with the same public shape", async () => {
    const execute = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
      details: { symbol: "MSFT" },
    });
    const source = {
      name: "fake_tool",
      label: "Fake Tool",
      description: "A fake tool for adapter tests",
      parameters: Type.Object({
        symbol: Type.String(),
      }),
      execute,
    };

    const adapted = agentToolToPiTool(source);
    const ctx = {} as never;
    const result = await adapted.execute("tool-1", { symbol: "MSFT" }, undefined, undefined, ctx);

    expect(execute).toHaveBeenCalledWith("tool-1", { symbol: "MSFT" }, undefined, undefined, ctx);
    expect(adapted.name).toBe(source.name);
    expect(adapted.label).toBe(source.label);
    expect(adapted.description).toBe(source.description);
    expect(adapted.parameters).toBe(source.parameters);
    expect(adapted.promptSnippet).toContain(source.name);
    expect(result.content[0].type).toBe("text");
  });

  it("exposes every OpenCandle tool as a Pi tool definition", () => {
    const sourceNames = getAllTools()
      .map((tool) => tool.name)
      .sort();
    const adaptedNames = getOpenCandleToolDefinitions()
      .map((tool) => tool.name)
      .sort();

    expect(adaptedNames).toEqual(sourceNames);
  });

  it("strips tool metadata defaults before wrapping tool params", async () => {
    vi.resetModules();
    const defaultsPassedToWrapper: Array<Record<string, unknown>> = [];
    const fakeTool = {
      name: "fake_tool",
      label: "Fake Tool",
      description: "Fake tool",
      parameters: Type.Object({ symbol: Type.String() }),
      execute: vi.fn(),
    };

    vi.doMock("../../../src/tools/index.js", () => ({
      getAllTools: () => [fakeTool],
    }));
    vi.doMock("../../../src/memory/tool-defaults.js", () => ({
      getDefaults: () => ({ __enabled: true, symbol: "NVDA" }),
    }));
    vi.doMock("../../../src/runtime/tool-defaults-wrapper.js", () => ({
      wrapWithDefaults: (tool: typeof fakeTool, defaults: Record<string, unknown>) => {
        defaultsPassedToWrapper.push(defaults);
        return tool;
      },
    }));

    const { getOpenCandleToolDefinitions: getDefinitions } = await import(
      "../../../src/pi/tool-adapter.js"
    );

    expect(getDefinitions().map((tool) => tool.name)).toEqual(["fake_tool"]);
    expect(defaultsPassedToWrapper).toEqual([{ symbol: "NVDA" }]);

    vi.doUnmock("../../../src/tools/index.js");
    vi.doUnmock("../../../src/memory/tool-defaults.js");
    vi.doUnmock("../../../src/runtime/tool-defaults-wrapper.js");
    vi.resetModules();
  });

  describe("Stop while a tool is executing", () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    function toolWith(execute: (...args: unknown[]) => Promise<unknown>) {
      return agentToolToPiTool({
        name: "slow_tool",
        label: "Slow Tool",
        description: "A tool that may ignore its abort signal",
        parameters: Type.Object({}),
        execute,
      } as never);
    }

    it("settles promptly as aborted when the tool ignores the run's abort signal", async () => {
      const adapted = toolWith(() => new Promise(() => {}));
      const controller = new AbortController();
      const run = adapted.execute("tool-1", {}, controller.signal, undefined, {} as never);
      const settled = run.then(
        () => "resolved",
        (error: Error) => error.message,
      );
      controller.abort();
      const outcome = await Promise.race([
        settled,
        new Promise((resolve) => setTimeout(() => resolve("still running"), 2_000)),
      ]);
      expect(outcome).toMatch(/aborted/i);
    });

    it("does not start a tool whose run was already stopped", async () => {
      const execute = vi.fn(async () => ({ content: [], details: {} }));
      const controller = new AbortController();
      controller.abort();
      await expect(
        toolWith(execute).execute("tool-1", {}, controller.signal, undefined, {} as never),
      ).rejects.toThrow(/aborted/i);
      expect(execute).not.toHaveBeenCalled();
    });

    it("keeps the result of a tool that settles cooperatively on abort", async () => {
      const adapted = toolWith(
        (_id, _params, signal) =>
          new Promise((resolve) => {
            (signal as AbortSignal).addEventListener("abort", () =>
              resolve({ content: [{ type: "text", text: "User cancelled" }], details: {} }),
            );
          }),
      );
      const controller = new AbortController();
      const run = adapted.execute("tool-1", {}, controller.signal, undefined, {} as never);
      controller.abort();
      await expect(run).resolves.toMatchObject({
        content: [{ type: "text", text: "User cancelled" }],
      });
    });

    it("aborts the provider fetch the tool has in flight", async () => {
      let fetchSignal: AbortSignal | undefined;
      globalThis.fetch = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
        fetchSignal = init?.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("This operation was aborted", "AbortError")),
          );
        });
      }) as typeof fetch;
      const adapted = toolWith(() => httpGet("https://api.example.com/slow"));
      const controller = new AbortController();
      const run = adapted.execute("tool-1", {}, controller.signal, undefined, {} as never);
      run.catch(() => {});
      await vi.waitFor(() => expect(fetchSignal).toBeDefined());
      expect(fetchSignal?.aborted).toBe(false);
      controller.abort();
      await expect(run).rejects.toThrow(/aborted/i);
      expect(fetchSignal?.aborted).toBe(true);
      // An aborted run is never retried.
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });
  });
});
