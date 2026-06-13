import { describe, expect, it } from "vitest";
import { runSubprocess } from "../../evals/subprocess-runner.js";

describe("subprocess runner", () => {
  it("reports command timeouts without hanging the caller", () => {
    const result = runSubprocess(process.execPath, ["-e", "setTimeout(() => {}, 10_000);"], {
      workdir: process.cwd(),
      stdio: "pipe",
      timeoutMs: 50,
    });

    expect(result.timedOut).toBe(true);
    expect(result.status).toBeNull();
  });
});
