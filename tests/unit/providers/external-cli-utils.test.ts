import { describe, expect, it } from "vitest";
import {
  normalizeExternalTimestamp,
  parseCliErrorEnvelope,
} from "../../../src/providers/external-cli-utils.js";

describe("external CLI normalization", () => {
  it("parses structured CLI errors without accepting unrelated JSON", () => {
    expect(
      parseCliErrorEnvelope(
        JSON.stringify({
          ok: false,
          error: { code: "session_missing", message: "Sign in again" },
        }),
      ),
    ).toEqual({ code: "session_missing", message: "Sign in again" });
    expect(parseCliErrorEnvelope(JSON.stringify({ ok: true, error: { message: "ignored" } }))).toBe(
      null,
    );
    expect(parseCliErrorEnvelope("not-json")).toBe(null);
  });

  it("normalizes seconds, milliseconds, and date strings to ISO timestamps", () => {
    expect(normalizeExternalTimestamp(1_700_000_000)).toBe("2023-11-14T22:13:20.000Z");
    expect(normalizeExternalTimestamp(1_700_000_000_000)).toBe("2023-11-14T22:13:20.000Z");
    expect(normalizeExternalTimestamp("2024-01-02T03:04:05Z")).toBe("2024-01-02T03:04:05.000Z");
    expect(normalizeExternalTimestamp(Number.NaN)).toBe("1970-01-01T00:00:00.000Z");
    expect(normalizeExternalTimestamp("invalid")).toBe("1970-01-01T00:00:00.000Z");
  });
});
