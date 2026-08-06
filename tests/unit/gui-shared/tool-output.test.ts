import { describe, expect, it } from "vitest";
import { toolOutcomeNeedsInput } from "../../../gui/shared/tool-output.js";

describe("tool outcome helpers", () => {
  it.each(["needs_selection", "needs_currency", "needs_lot_id"])(
    "treats %s as requiring more user input",
    (status) => {
      expect(toolOutcomeNeedsInput({ details: { status } })).toBe(true);
    },
  );

  it("does not classify successful tool details as requiring input", () => {
    expect(toolOutcomeNeedsInput({ details: { status: "completed" } })).toBe(false);
  });
});
