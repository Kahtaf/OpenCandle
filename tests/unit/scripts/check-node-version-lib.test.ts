import { describe, expect, it, vi } from "vitest";
import { ensureNativeDependency } from "../../../scripts/check-node-version-lib.mjs";

describe("check-node-version native dependency repair", () => {
  it("rebuilds once and retries when a native binding has a stale Node ABI", async () => {
    const load = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(
        new Error(
          "was compiled against a different Node.js version using NODE_MODULE_VERSION 127. This version of Node.js requires NODE_MODULE_VERSION 141.",
        ),
      )
      .mockResolvedValueOnce(undefined);
    const rebuild = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    await ensureNativeDependency({
      dependencyName: "better-sqlite3",
      load,
      rebuild,
      log: vi.fn(),
    });

    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
