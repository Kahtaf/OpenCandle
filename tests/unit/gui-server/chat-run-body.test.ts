import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDispatchedPrompt, parseChatRunBody } from "../../../gui/server/http-routes.js";
import { MarketStateService } from "../../../src/market-state/service.js";
import { initDefaultDatabase } from "../../../src/memory/sqlite.js";

describe("GUI chat-run body parsing", () => {
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
    [{ prompt: "x", attachments: [{ kind: "analysis" }] }, "Unsupported attachment kind"],
    [{ prompt: "x", attachments: [{ kind: "watchlist" }] }, "watchlist attachment id is required"],
  ])("rejects invalid bodies with a specific reason", (body, error) => {
    expect(parseChatRunBody(body)).toEqual({ ok: false, error });
  });
});
