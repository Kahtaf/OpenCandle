import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDispatchedPrompt, parseChatRunBody } from "../../../gui/server/http-routes.js";
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
