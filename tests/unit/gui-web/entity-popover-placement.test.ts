import { describe, expect, it } from "vitest";
import { computeEntityPopoverPlacement } from "../../../gui/web/src/features/chat/entity-popover.jsx";

describe("entity popover placement", () => {
  it("anchors the callout near the clicked ticker on desktop", () => {
    const placement = computeEntityPopoverPlacement(
      { left: 110, right: 158, top: 420, bottom: 442, width: 48, height: 22 },
      { width: 1440, height: 900 },
    );

    expect(placement.anchorStyle.left).toBe(162);
    expect(placement.anchorStyle.top).toBe(442);
    expect(placement.side).toBe("bottom");
  });

  it("keeps the callout inside the mobile viewport", () => {
    const placement = computeEntityPopoverPlacement(
      { left: 4, right: 52, top: 620, bottom: 642, width: 48, height: 22 },
      { width: 375, height: 700 },
    );

    expect(placement.anchorStyle.left).toBeGreaterThanOrEqual(150);
    expect(placement.anchorStyle.left).toBeLessThanOrEqual(225);
    expect(placement.side).toBe("top");
    expect(placement.contentStyle.width).toBe(351);
  });
});
