import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
  installUnhandledRejectionGuard,
  isAbortRejection,
} from "../../../gui/server/unhandled-rejection-guard.js";

function abortReason(): unknown {
  const controller = new AbortController();
  controller.abort();
  return controller.signal.reason;
}

describe("GUI server unhandled rejection guard", () => {
  it("recognises the abort reasons a stopped run's requests fail with", () => {
    expect(isAbortRejection(abortReason())).toBe(true);
    const named = new Error("router LLM call aborted");
    named.name = "AbortError";
    expect(isAbortRejection(named)).toBe(true);
    expect(isAbortRejection(new Error("This operation was aborted"))).toBe(false);
    expect(isAbortRejection(new TypeError("fetch failed"))).toBe(false);
    expect(isAbortRejection("AbortError")).toBe(false);
    expect(isAbortRejection(undefined)).toBe(false);
  });

  it("logs a leaked abort rejection as a distinct event and keeps the server running", () => {
    const target = new EventEmitter();
    const lines: string[] = [];
    installUnhandledRejectionGuard({ target, log: (line) => lines.push(line), execArgv: [] });

    expect(() => target.emit("unhandledRejection", abortReason(), Promise.resolve())).not.toThrow();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("unhandled_abort_rejection");
    expect(lines[0]).toContain("AbortError");
  });

  it("still fails the process on any other unhandled rejection", () => {
    const target = new EventEmitter();
    const lines: string[] = [];
    installUnhandledRejectionGuard({ target, log: (line) => lines.push(line), execArgv: [] });
    const bug = new TypeError("Cannot read properties of undefined");

    // Throwing from the listener is what turns the rejection into an uncaught
    // exception, which is Node's default exit behaviour.
    expect(() => target.emit("unhandledRejection", bug, Promise.resolve())).toThrow(bug);
    expect(lines).toEqual([]);
  });

  it("leaves an explicit --unhandled-rejections mode to Node", () => {
    const target = new EventEmitter();
    const installed = installUnhandledRejectionGuard({
      target,
      log: () => {},
      execArgv: ["--unhandled-rejections=warn"],
    });

    expect(installed).toBe(false);
    expect(target.listenerCount("unhandledRejection")).toBe(0);
  });
});
