import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetConfigCache } from "../../../src/config.js";
import { cache } from "../../../src/infra/cache.js";
import {
  getOpenCandleToolDefinitions,
  READ_ONLY_TOOL_NAMES,
} from "../../../src/pi/tool-adapter.js";
import { DATA_PROVIDER_ENV_NAMES } from "../../support/env.js";

// Stop aborts a read-only tool's provider fetches, and every fetch the tool
// still has in flight then fails with the run's abort reason. A tool that
// started one of those requests without anything awaiting it yet leaks an
// unhandled rejection, which exits the process that hosts the session (#263).
describe("Stop during a read-only tool", () => {
  let openCandleHome: string;
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);

  beforeAll(() => {
    openCandleHome = mkdtempSync(join(tmpdir(), "opencandle-tool-abort-"));
    process.on("unhandledRejection", onUnhandled);
  });

  beforeEach(() => {
    vi.stubEnv("OPENCANDLE_HOME", openCandleHome);
    // Configure every keyed provider so the keyed branches run too.
    for (const name of DATA_PROVIDER_ENV_NAMES) vi.stubEnv(name, "test-key");
    resetConfigCache();
    cache.clear();
    unhandled.length = 0;
    // A request that carries the run's signal fails with its abort reason on
    // Stop, as a real fetch does; one without a signal never answers.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal;
            if (signal?.aborted) return reject(signal.reason);
            signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
          }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    resetConfigCache();
    cache.clear();
  });

  afterAll(() => {
    process.off("unhandledRejection", onUnhandled);
    rmSync(openCandleHome, { recursive: true, force: true });
  });

  const tools = getOpenCandleToolDefinitions().filter((tool) =>
    READ_ONLY_TOOL_NAMES.has(tool.name),
  );

  it.each(tools.map((tool) => [tool.name, tool] as const))(
    "%s leaves no unhandled rejection behind",
    async (_name, tool) => {
      const args = {
        symbol: "ZZTEST",
        symbols: ["ZZTEST", "ZZTESTB"],
        query: "ZZTEST",
        holdings: [{ symbol: "ZZTEST", shares: 1 }],
      };
      const run = new AbortController();
      const outcome = tool
        .execute("tool-1", args as never, run.signal, undefined, {} as never)
        .then(
          () => "settled",
          () => "settled",
        );
      await new Promise((resolve) => setTimeout(resolve, 10));
      run.abort();
      await outcome;
      // Unhandled rejections are reported once the microtask queue drains.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).toEqual([]);
    },
  );
});
