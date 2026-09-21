import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import {
  buildDispatchedPrompt,
  disposeAfterSettled,
  parseChatRunBody,
} from "../../../gui/server/http-routes.js";
import { shouldPersistOriginalInputMarker } from "../../../gui/shared/chat-run-input.js";
import { MarketStateService } from "../../../src/market-state/service.js";
import { initDefaultDatabase } from "../../../src/memory/sqlite.js";

describe("GUI chat-run body parsing", () => {
  it("only pre-persists original input for commands that expand into workflow turns", () => {
    expect(shouldPersistOriginalInputMarker("/analyze $NVDA", [])).toBe(true);
    expect(shouldPersistOriginalInputMarker("/analyze", [])).toBe(false);
    expect(shouldPersistOriginalInputMarker("/setup", [])).toBe(false);
    expect(shouldPersistOriginalInputMarker("/connect openai", [])).toBe(false);
    expect(
      shouldPersistOriginalInputMarker("Review this", [{ kind: "portfolio", label: "P" }]),
    ).toBe(true);
  });

  it("bounds and deduplicates saved-state attachments", () => {
    expect(
      parseChatRunBody({
        prompt: "review",
        attachments: [
          { kind: "report", id: "latest" },
          { kind: "report", id: "latest" },
        ],
      }),
    ).toEqual({ ok: false, error: "Duplicate saved attachment" });
    expect(
      parseChatRunBody({
        prompt: "review",
        attachments: Array.from({ length: 9 }, (_, index) => ({
          kind: "report",
          id: String(index),
        })),
      }),
    ).toEqual({ ok: false, error: "Attach up to 8 saved items" });
  });

  it("expands saved-context attachments as data-only user blocks", async () => {
    const originalHome = process.env.OPENCANDLE_HOME;
    const home = mkdtempSync(join(tmpdir(), "opencandle-chat-run-body-"));
    process.env.OPENCANDLE_HOME = home;
    try {
      const db = initDefaultDatabase();
      const service = new MarketStateService(db);
      service.addPortfolioLot({
        instrument: {
          symbol: "ASTS",
          assetType: "equity",
          name: "AST SpaceMobile, Inc.",
          exchange: "NMS",
          currency: "USD",
          provider: "yahoo",
        },
        quantity: 40,
        avgCost: 28,
        currency: "USD",
      });
      db.close();

      const prompt = await buildDispatchedPrompt({
        prompt: "am I too concentrated?",
        images: [],
        attachments: [{ kind: "portfolio" }],
      });

      expect(prompt).toContain("[Attached by user — portfolio]");
      expect(prompt).toContain("- ASTS: 40 @ $28.00, cost basis $1120.00");
      expect(prompt).not.toContain("Use this saved user state");
    } finally {
      if (originalHome == null) {
        delete process.env.OPENCANDLE_HOME;
      } else {
        process.env.OPENCANDLE_HOME = originalHome;
      }
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("expands a selected portfolio attachment by id", async () => {
    const originalHome = process.env.OPENCANDLE_HOME;
    const home = mkdtempSync(join(tmpdir(), "opencandle-chat-run-body-"));
    process.env.OPENCANDLE_HOME = home;
    try {
      const db = initDefaultDatabase();
      const service = new MarketStateService(db);
      const trading = service.createPortfolio("Trading");
      service.addPortfolioLot({
        portfolioId: trading.id,
        instrument: {
          symbol: "TSLA",
          assetType: "equity",
          name: "Tesla, Inc.",
          exchange: "NMS",
          currency: "USD",
          provider: "yahoo",
        },
        quantity: 1,
        avgCost: 200,
        currency: "USD",
      });
      service.addPortfolioLot({
        instrument: {
          symbol: "VTI",
          assetType: "etf",
          name: "Vanguard Total Stock Market ETF",
          exchange: "PCX",
          currency: "USD",
          provider: "yahoo",
        },
        quantity: 2,
        avgCost: 250,
        currency: "USD",
      });
      db.close();

      const prompt = await buildDispatchedPrompt({
        prompt: "review this",
        images: [],
        attachments: [{ kind: "portfolio", id: String(trading.id) }],
      });

      expect(prompt).toContain("[Attached by user — portfolio]");
      expect(prompt).toContain("- TSLA: 1 @ $200.00, cost basis $200.00");
      expect(prompt).not.toContain("VTI");
    } finally {
      if (originalHome == null) {
        delete process.env.OPENCANDLE_HOME;
      } else {
        process.env.OPENCANDLE_HOME = originalHome;
      }
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("accepts prompt, valid images, and saved context attachments", () => {
    expect(
      parseChatRunBody({
        prompt: "review this",
        images: [{ data: Buffer.from("png").toString("base64"), mimeType: "image/png" }],
        attachments: [{ kind: "portfolio" }, { kind: "watchlist", id: "default" }],
      }),
    ).toEqual({
      ok: true,
      value: {
        prompt: "review this",
        images: [{ data: Buffer.from("png").toString("base64"), mimeType: "image/png" }],
        attachments: [{ kind: "portfolio" }, { kind: "watchlist", id: "default" }],
      },
    });
  });

  it("rejects attachments on slash commands so command arguments remain unchanged", () => {
    expect(
      parseChatRunBody({
        prompt: "/analyze NVDA",
        attachments: [{ kind: "portfolio" }],
      }),
    ).toEqual({
      ok: false,
      error: "Attachments are not supported for slash commands",
    });
    expect(
      parseChatRunBody({
        prompt: "/analyze NVDA",
        images: [{ data: Buffer.from("png").toString("base64"), mimeType: "image/png" }],
      }),
    ).toEqual({
      ok: false,
      error: "Attachments are not supported for slash commands",
    });
  });

  it("does not append saved-context blocks to slash-command prompt text", async () => {
    await expect(
      buildDispatchedPrompt({
        prompt: "/analyze NVDA",
        images: [],
        attachments: [{ kind: "portfolio" }],
      }),
    ).resolves.toBe("/analyze NVDA");
  });

  it.each([
    [{ prompt: "", images: [] }, "prompt is required"],
    [
      { prompt: "x", images: [{ data: "a", mimeType: "image/gif" }] },
      "Unsupported image mime type",
    ],
    [
      {
        prompt: "x",
        images: [
          { data: Buffer.alloc(5 * 1024 * 1024 + 1).toString("base64"), mimeType: "image/png" },
        ],
      },
      "Image attachment must be 5 MB or smaller",
    ],
    [
      {
        prompt: "x",
        images: Array.from({ length: 5 }, () => ({ data: "a", mimeType: "image/png" })),
      },
      "Attach up to 4 images",
    ],
    [
      { prompt: "x", images: [{ data: "!!!!", mimeType: "image/png" }] },
      "Image attachment data must be valid base64",
    ],
    [
      { prompt: "x", images: [{ data: "", mimeType: "image/png" }] },
      "Image attachment data must be valid base64",
    ],
    [{ prompt: "x", attachments: [{ kind: "analysis" }] }, "Unsupported attachment kind"],
    [{ prompt: "x", attachments: [{ kind: "watchlist" }] }, "watchlist attachment id is required"],
  ])("rejects invalid bodies with a specific reason", (body, error) => {
    expect(parseChatRunBody(body)).toEqual({ ok: false, error });
  });
});

describe("disposeAfterSettled", () => {
  // Regression coverage for the GUI/TUI parity gap: a chat run against a
  // non-current session creates an ephemeral AgentSession via
  // createSessionForManager and used to dispose it synchronously in the
  // request's finally block, right after the request's own first-step
  // settle-wait (promptAndSettle) returned. A multi-step workflow
  // (comprehensive_analysis, options_screener, ...) that session dispatched
  // keeps sending itself further steps well after that point; disposing
  // immediately tore it down silently mid-workflow, with no error or trace
  // entry (runner.start() resolves status "cancelled", which the coordinator
  // only logs for "completed"/"failed").
  it("disposes immediately when the session exposes no settlement signal", async () => {
    const dispose = vi.fn();
    await disposeAfterSettled({ session: { dispose } as unknown as AgentSession });
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("resolves without throwing for a null session (the common current-session case)", async () => {
    await expect(disposeAfterSettled(null)).resolves.toBeUndefined();
  });

  it("resolves only after waitForSettled resolves and dispose has run", async () => {
    const dispose = vi.fn();
    let resolveSettled: () => void = () => {};
    const waitForSettled = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSettled = resolve;
        }),
    );
    const disposal = disposeAfterSettled({
      session: { dispose } as unknown as AgentSession,
      waitForSettled,
    });
    let resolved = false;
    void disposal.then(() => {
      resolved = true;
    });

    expect(waitForSettled).toHaveBeenCalledTimes(1);
    // A still-running background workflow must not be torn out from under
    // itself, and the returned promise must not resolve before disposal.
    await Promise.resolve();
    await Promise.resolve();
    expect(dispose).not.toHaveBeenCalled();
    expect(resolved).toBe(false);

    resolveSettled();
    await disposal;
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(resolved).toBe(true);
  });

  it("resolves and still disposes when waiting for settlement rejects", async () => {
    const dispose = vi.fn();
    const waitForSettled = vi.fn(() => Promise.reject(new Error("boom")));

    await expect(
      disposeAfterSettled({ session: { dispose } as unknown as AgentSession, waitForSettled }),
    ).resolves.toBeUndefined();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("releases the deferred disposal when a session stops making progress", async () => {
    vi.useFakeTimers();
    try {
      const dispose = vi.fn();
      const unsubscribe = vi.fn();
      let resolveSettled: () => void = () => {};
      const waitForSettled = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveSettled = resolve;
          }),
      );
      const session = {
        dispose,
        subscribe: () => unsubscribe,
      } as unknown as AgentSession;
      let resolved = false;
      const disposal = disposeAfterSettled({ session, waitForSettled }).then(() => {
        resolved = true;
      });

      // A hung session must not hold the writer lock forever: once the stall
      // window passes with no session progress, disposal still runs.
      await vi.advanceTimersByTimeAsync(121_000);
      await disposal;
      expect(resolved).toBe(true);
      expect(dispose).toHaveBeenCalledTimes(1);
      expect(unsubscribe).toHaveBeenCalledTimes(1);
      resolveSettled();
    } finally {
      vi.useRealTimers();
    }
  });
});
