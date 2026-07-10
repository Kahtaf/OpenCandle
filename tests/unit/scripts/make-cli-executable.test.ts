import { describe, expect, it, vi } from "vitest";
import { makeCliExecutable } from "../../../scripts/make-cli-executable.mjs";

describe("make-cli-executable", () => {
  it("does nothing on Windows", () => {
    const chmod = vi.fn();

    makeCliExecutable({ platform: "win32", chmod });

    expect(chmod).not.toHaveBeenCalled();
  });
});
