import { describe, expect, it } from "vitest";
import { getNativeDependencyErrorMessage } from "../../../src/infra/native-dependencies.js";
import { getUnsupportedNodeVersionMessage } from "../../../src/infra/node-version.js";

describe("node version guard", () => {
  it("allows the supported Node range", () => {
    expect(getUnsupportedNodeVersionMessage("20.19.0")).toBeNull();
    expect(getUnsupportedNodeVersionMessage("22.22.0")).toBeNull();
    expect(getUnsupportedNodeVersionMessage("24.11.1")).toBeNull();
    expect(getUnsupportedNodeVersionMessage("25.9.0")).toBeNull();
  });

  it("rejects unsupported Node versions with an actionable install and rebuild message", () => {
    expect(getUnsupportedNodeVersionMessage("20.18.0")).toContain(
      "Use Node 20.19+, 22.12+, or 24.x-26.x",
    );
    expect(getUnsupportedNodeVersionMessage("23.11.1")).toContain(
      "Use Node 20.19+, 22.12+, or 24.x-26.x",
    );
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
});
