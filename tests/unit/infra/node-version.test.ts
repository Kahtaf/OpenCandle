import { describe, expect, it } from "vitest";
import { getUnsupportedNodeVersionMessage } from "../../../src/infra/node-version.js";

describe("node version guard", () => {
  it("allows Node 22", () => {
    expect(getUnsupportedNodeVersionMessage("22.22.0")).toBeNull();
  });

  it("rejects other Node majors with an actionable message", () => {
    expect(getUnsupportedNodeVersionMessage("25.9.0")).toContain("Run `nvm use`");
  });
});
