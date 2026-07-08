import { describe, expect, it } from "vitest";
import {
  detectCashtagFragment,
  insertAcceptedCashtag,
} from "../../../gui/web/src/features/chat/cashtag-autocomplete-helpers.js";

describe("cashtag autocomplete helpers", () => {
  it("detects a start-of-text cashtag fragment", () => {
    expect(detectCashtagFragment("$n", 2)).toEqual({ fragment: "n", start: 0, end: 2 });
  });

  it("detects a mid-sentence cashtag fragment", () => {
    expect(detectCashtagFragment("compare $nv", 11)).toEqual({
      fragment: "nv",
      start: 8,
      end: 11,
    });
  });

  it("does not trigger for a dollar sign inside a word", () => {
    expect(detectCashtagFragment("cash$nv", 7)).toBeNull();
  });

  it("detects the fragment when the caret is inside a longer cashtag", () => {
    expect(detectCashtagFragment("$NVDA now", 3)).toEqual({ fragment: "NV", start: 0, end: 3 });
  });

  it("inserts an accepted candidate as an uppercase cashtag with trailing space", () => {
    expect(
      insertAcceptedCashtag("compare $nv vs AMD", { fragment: "nv", start: 8, end: 11 }, "nvda"),
    ).toEqual({ text: "compare $NVDA  vs AMD", caretIndex: 14 });
  });
});
