import { describe, expect, it } from "vitest";
import { serializeToolValue, truncateToolValue } from "../../../src/runtime/tool-evidence-utils.js";

describe("tool evidence utilities", () => {
  it("serializes strings, structured values, and circular values safely", () => {
    expect(serializeToolValue("already text")).toBe("already text");
    expect(serializeToolValue({ symbol: "AAPL", price: 123 })).toBe(
      '{"symbol":"AAPL","price":123}',
    );
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(serializeToolValue(circular)).toBe("[object Object]");
  });

  it("caps evidence previews without changing shorter values", () => {
    expect(truncateToolValue("abcdef", 3)).toBe("abc");
    expect(truncateToolValue("abc", 3)).toBe("abc");
  });
});
