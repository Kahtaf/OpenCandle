import { describe, expect, it } from "vitest";
import {
  attachmentLabel,
  attachmentsForOptimisticMessage,
  attachmentsForRequest,
  attachmentsFromImageFiles,
  imageFilesFromClipboardData,
  MAX_IMAGE_ATTACHMENTS,
  MAX_IMAGE_BYTES,
  validateImageFiles,
} from "../../../gui/web/src/features/chat/attachments.js";
import {
  normalizePortfolioOptions,
  portfolioAttachmentForOption,
} from "../../../gui/web/src/features/chat/watchlist-options.js";

describe("GUI chat attachments", () => {
  it("validates image mime type, size, and total count", () => {
    const errors = validateImageFiles(
      [
        { name: "quote.gif", type: "image/gif", size: 1024 },
        { name: "huge.png", type: "image/png", size: MAX_IMAGE_BYTES + 1 },
      ],
      MAX_IMAGE_ATTACHMENTS - 1,
    );

    expect(errors).toContain("Attach up to 4 images.");
    expect(errors).toContain("quote.gif must be PNG, JPEG, or WebP.");
    expect(errors).toContain("huge.png must be 5 MB or smaller.");
  });

  it("builds the chat-run request attachment fields without image bytes in saved metadata", () => {
    expect(
      attachmentsForRequest([
        { kind: "image", name: "chart.png", data: "base64", mimeType: "image/png" },
        { kind: "portfolio", id: "3", label: "Portfolio: Trading" },
        { kind: "watchlist", id: "7", label: "Watchlist 7" },
      ]),
    ).toEqual({
      images: [{ data: "base64", mimeType: "image/png" }],
      attachments: [
        { kind: "portfolio", id: "3" },
        { kind: "watchlist", id: "7" },
      ],
    });
  });

  it("labels saved context and image attachments for chips", () => {
    expect(attachmentLabel({ kind: "portfolio" })).toBe("Portfolio");
    expect(attachmentLabel({ kind: "report" })).toBe("Latest report");
    expect(attachmentLabel({ kind: "image", name: "chart.webp" })).toBe("chart.webp");
  });

  it("normalizes portfolio attachment options with labels and ids", () => {
    const options = normalizePortfolioOptions([{ id: 3, name: "Trading" }]);

    expect(options).toEqual([{ id: "3", name: "Trading" }]);
    expect(portfolioAttachmentForOption(options[0])).toEqual({
      kind: "portfolio",
      id: "3",
      label: "Portfolio: Trading",
    });
  });

  it("builds optimistic message attachment chips without image bytes", () => {
    expect(
      attachmentsForOptimisticMessage([
        { kind: "image", name: "chart.png", data: "base64", mimeType: "image/png" },
        { kind: "watchlist", id: "7", label: "Watchlist 7" },
      ]),
    ).toEqual([
      { kind: "image", label: "chart.png" },
      { kind: "watchlist", label: "Watchlist 7" },
    ]);
  });

  it("extracts image files from clipboard items without treating pasted text as an attachment", () => {
    const png = new File([new Uint8Array([1, 2, 3])], "clipboard.png", { type: "image/png" });
    const text = new File(["hello"], "note.txt", { type: "text/plain" });

    const files = imageFilesFromClipboardData({
      files: [text],
      items: [
        { kind: "string", type: "text/plain", getAsFile: () => text },
        { kind: "file", type: "image/png", getAsFile: () => png },
      ],
    });

    expect(files).toEqual([png]);
  });

  it("encodes pasted image files as pending image attachments", async () => {
    const png = new File([new Uint8Array([1, 2, 3])], "clipboard.png", { type: "image/png" });

    await expect(attachmentsFromImageFiles([png])).resolves.toEqual([
      {
        kind: "image",
        name: "clipboard.png",
        data: "AQID",
        mimeType: "image/png",
      },
    ]);
  });
});
