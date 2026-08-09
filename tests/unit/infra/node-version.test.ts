import { describe, expect, it } from "vitest";
import {
  ensureNativeDependency,
  getNativeDependencyErrorMessage,
} from "../../../src/infra/native-dependencies.js";
import { getUnsupportedNodeVersionMessage } from "../../../src/infra/node-version.js";

describe("node version guard", () => {
  it("allows the supported Node range", () => {
    expect(getUnsupportedNodeVersionMessage("22.22.2")).toBeNull();
    expect(getUnsupportedNodeVersionMessage("22.22.1")).toContain("Use Node 22.22.2+ or 24.x-26.x");
    expect(getUnsupportedNodeVersionMessage("24.11.1")).toBeNull();
    expect(getUnsupportedNodeVersionMessage("25.9.0")).toBeNull();
  });

  it("rejects unsupported Node versions with an actionable install and rebuild message", () => {
    expect(getUnsupportedNodeVersionMessage("20.19.0")).toContain("Use Node 22.22.2+ or 24.x-26.x");
    expect(getUnsupportedNodeVersionMessage("22.21.0")).toContain("Use Node 22.22.2+ or 24.x-26.x");
    expect(getUnsupportedNodeVersionMessage("23.11.1")).toContain("Use Node 22.22.2+ or 24.x-26.x");
    expect(getUnsupportedNodeVersionMessage("27.0.0")).toContain(
      "reinstall dependencies under the active Node",
    );
  });
});

describe("native dependency guard", () => {
  it("recognizes Node ABI mismatches and gives a rebuild path", () => {
    const message = getNativeDependencyErrorMessage(
      new Error(
        "was compiled against a different Node.js version using NODE_MODULE_VERSION 127. This version of Node.js requires NODE_MODULE_VERSION 141.",
      ),
      "better-sqlite3",
    );

    expect(message).toContain("better-sqlite3 native binding was built for a different Node ABI");
    expect(message).toContain("npm rebuild better-sqlite3");
  });

  it("rebuilds once and retries when a native dependency has a stale Node ABI", async () => {
    const calls: string[] = [];

    await ensureNativeDependency({
      dependencyName: "better-sqlite3",
      async load() {
        calls.push("load");
        if (calls.length === 1) {
          throw new Error(
            "was compiled against a different Node.js version using NODE_MODULE_VERSION 127. This version of Node.js requires NODE_MODULE_VERSION 141.",
          );
        }
      },
      async rebuild(dependencyName) {
        calls.push(`rebuild:${dependencyName}`);
      },
      log() {},
    });

    expect(calls).toEqual(["load", "rebuild:better-sqlite3", "load"]);
  });
});
