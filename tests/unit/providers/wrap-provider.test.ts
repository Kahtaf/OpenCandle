import { describe, it, expect } from "vitest";
import { wrapProvider } from "../../../src/providers/wrap-provider.js";

describe("wrapProvider", () => {
  it("returns ok result on success", async () => {
    const result = await wrapProvider("yahoo-finance", async () => ({
      price: 185.5,
    }));

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data).toEqual({ price: 185.5 });
      expect(result.timestamp).toBeTruthy();
    }
  });

  it("returns unavailable result on thrown error", async () => {
    const result = await wrapProvider("alpha-vantage", async () => {
      throw new Error("rate_limited");
    });

    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") {
      expect(result.reason).toBe("rate_limited");
      expect(result.provider).toBe("alpha-vantage");
    }
  });

  it("handles non-Error throws", async () => {
    const result = await wrapProvider("fred", async () => {
      throw "string_error";
    });

    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") {
      expect(result.reason).toBe("unknown_error");
      expect(result.provider).toBe("fred");
    }
  });
});
