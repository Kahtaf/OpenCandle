import { EventEmitter } from "node:events";
import { setImmediate } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import { createGracefulShutdown } from "../../../gui/server/shutdown.js";

describe("createGracefulShutdown", () => {
  it("runs cleanup and closes the server only once for repeated signals", async () => {
    const server = new EventEmitter() as EventEmitter & {
      close: (callback: () => void) => void;
      closeAllConnections: () => void;
    };
    const close = vi.fn((callback: () => void) => callback());
    server.close = close;
    server.closeAllConnections = vi.fn();
    const cleanup = vi.fn();
    const exit = vi.fn();
    const shutdown = createGracefulShutdown({ server, cleanup, exit });

    shutdown();
    shutdown();
    await setImmediate();

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(server.closeAllConnections).not.toHaveBeenCalled();
  });

  it("forces exit when server close waits on open connections", async () => {
    vi.useFakeTimers();
    const server = new EventEmitter() as EventEmitter & {
      close: (callback: () => void) => void;
      closeAllConnections: () => void;
    };
    server.close = vi.fn();
    server.closeAllConnections = vi.fn();
    const shutdown = createGracefulShutdown({
      server,
      cleanup: vi.fn(),
      exit: vi.fn(),
      timeoutMs: 50,
    });

    shutdown();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(50);

    expect(server.close).toHaveBeenCalledTimes(1);
    expect(server.closeAllConnections).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
