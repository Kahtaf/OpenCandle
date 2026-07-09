import { describe, expect, it } from "vitest";
import {
  normalizeWatchlistOptions,
  watchlistAttachmentForOption,
} from "../../../gui/web/src/features/chat/watchlist-options.js";

describe("GUI watchlist options", () => {
  it("normalizes named watchlists for chat controls", () => {
    expect(
      normalizeWatchlistOptions([
        { id: 7, name: "MAG7" },
        { id: 8, name: " ETFs " },
        { id: 9, name: "" },
      ]),
    ).toEqual([
      { id: "7", name: "MAG7" },
      { id: "8", name: "ETFs" },
    ]);
  });

  it("falls back to the default watchlist when state has not loaded", () => {
    expect(normalizeWatchlistOptions([])).toEqual([{ id: "default", name: "Default" }]);
  });

  it("labels watchlist chat attachments with the selected list name", () => {
    expect(watchlistAttachmentForOption({ id: "7", name: "MAG7" })).toEqual({
      kind: "watchlist",
      id: "7",
      label: "Watchlist: MAG7",
    });
  });
});
