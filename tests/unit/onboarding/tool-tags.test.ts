import { describe, expect, it } from "vitest";
import {
  buildConnectedTag,
  buildCredentialRequiredTag,
  buildExternalToolRequiredTag,
  buildSkippedTag,
  buildSoftDegradedTag,
  parseToolTag,
} from "../../../src/onboarding/tool-tags.js";

describe("tool-tags — builder output format", () => {
  it("buildCredentialRequiredTag produces the canonical single-line format", () => {
    const tag = buildCredentialRequiredTag({
      provider: "alpha_vantage",
      reason: "missing",
      unlocks: ["fundamentals", "DCF"],
      fallback: null,
    });
    expect(tag).toMatch(
      /^\[OPENCANDLE_CREDENTIAL_REQUIRED provider=alpha_vantage reason=missing .+\]$/,
    );
    expect(tag).toContain('unlocks="fundamentals, DCF"');
    expect(tag).toContain("fallback=none");
  });

  it("buildCredentialRequiredTag with reason=stale and httpStatus", () => {
    const tag = buildCredentialRequiredTag({
      provider: "finnhub",
      reason: "stale",
      unlocks: ["news"],
      fallback: null,
      httpStatus: 401,
    });
    expect(tag).toContain("reason=stale");
    expect(tag).toContain("httpStatus=401");
  });

  it("buildSoftDegradedTag produces the canonical format", () => {
    const tag = buildSoftDegradedTag({
      provider: "brave",
      fallback: "ddg",
      remediation: "run /connect search",
    });
    expect(tag).toMatch(/^\[OPENCANDLE_SOFT_DEGRADED provider=brave .+\]$/);
    expect(tag).toContain("fallback=ddg");
    expect(tag).toContain('remediation="run /connect search"');
  });

  it("buildSkippedTag produces the canonical format", () => {
    const tag = buildSkippedTag({
      provider: "fred",
      reason: "credential_not_provided",
      remediation: "run /connect economy",
    });
    expect(tag).toMatch(/^\[OPENCANDLE_SKIPPED provider=fred .+\]$/);
    expect(tag).toContain("reason=credential_not_provided");
    expect(tag).toContain('remediation="run /connect economy"');
  });

  it("buildSkippedTag supports the silenced flag for never-ask providers", () => {
    const tag = buildSkippedTag({
      provider: "brave",
      reason: "credential_not_provided",
      remediation: "run /connect search",
      silenced: true,
    });
    expect(tag).toContain("silenced=true");
  });

  it("buildConnectedTag produces the canonical format", () => {
    const tag = buildConnectedTag({ provider: "alpha_vantage" });
    expect(tag).toMatch(/^\[OPENCANDLE_CONNECTED provider=alpha_vantage.*\]$/);
  });

  it("buildExternalToolRequiredTag produces the canonical format", () => {
    const tag = buildExternalToolRequiredTag({
      provider: "reddit",
      reason: "not_installed",
      installCmd: "uv tool install rdt-cli",
      loginCmd: "rdt login",
      fallback: "twitter-web-news",
    });
    expect(tag).toMatch(/^\[OPENCANDLE_EXTERNAL_TOOL_REQUIRED provider=reddit .+\]$/);
    expect(tag).toContain("reason=not_installed");
    expect(tag).toContain('installCmd="uv tool install rdt-cli"');
    expect(tag).toContain('loginCmd="rdt login"');
  });
});

describe("tool-tags — parser", () => {
  it("parses a credential-required tag and preserves every field", () => {
    const built = buildCredentialRequiredTag({
      provider: "alpha_vantage",
      reason: "missing",
      unlocks: ["fundamentals"],
      fallback: null,
    });
    const parsed = parseToolTag(built);
    expect(parsed).toEqual({
      kind: "credential_required",
      provider: "alpha_vantage",
      reason: "missing",
      unlocks: ["fundamentals"],
      fallback: null,
    });
  });

  it("roundtrips a stale credential-required tag with httpStatus", () => {
    const built = buildCredentialRequiredTag({
      provider: "finnhub",
      reason: "stale",
      unlocks: ["news"],
      fallback: null,
      httpStatus: 401,
    });
    const parsed = parseToolTag(built);
    expect(parsed?.kind).toBe("credential_required");
    if (parsed?.kind === "credential_required") {
      expect(parsed.reason).toBe("stale");
      expect(parsed.httpStatus).toBe(401);
    }
  });

  it("roundtrips a soft-degraded tag with remediation containing spaces", () => {
    const built = buildSoftDegradedTag({
      provider: "brave",
      fallback: "ddg",
      remediation: "run /connect search",
    });
    const parsed = parseToolTag(built);
    expect(parsed).toEqual({
      kind: "soft_degraded",
      provider: "brave",
      fallback: "ddg",
      remediation: "run /connect search",
    });
  });

  it("roundtrips a skipped tag with silenced=true", () => {
    const built = buildSkippedTag({
      provider: "brave",
      reason: "credential_not_provided",
      remediation: "run /connect search",
      silenced: true,
    });
    const parsed = parseToolTag(built);
    expect(parsed).toEqual({
      kind: "skipped",
      provider: "brave",
      reason: "credential_not_provided",
      remediation: "run /connect search",
      silenced: true,
    });
  });

  it("roundtrips a connected tag", () => {
    const built = buildConnectedTag({ provider: "fred" });
    const parsed = parseToolTag(built);
    expect(parsed).toEqual({ kind: "connected", provider: "fred" });
  });

  it("roundtrips an external-tool-required tag", () => {
    const built = buildExternalToolRequiredTag({
      provider: "reddit",
      reason: "session_missing",
      installCmd: "uv tool install rdt-cli",
      loginCmd: "rdt login",
      fallback: null,
    });
    const parsed = parseToolTag(built);
    expect(parsed).toEqual({
      kind: "external_tool_required",
      provider: "reddit",
      reason: "session_missing",
      installCmd: "uv tool install rdt-cli",
      loginCmd: "rdt login",
      fallback: null,
    });
  });

  it("returns undefined for non-tag text", () => {
    expect(parseToolTag("this is a normal sentence")).toBeUndefined();
    expect(parseToolTag("")).toBeUndefined();
    expect(parseToolTag("[NOT_AN_OPENCANDLE_TAG provider=foo]")).toBeUndefined();
  });

  it("tolerates unknown fields", () => {
    const input =
      '[OPENCANDLE_CREDENTIAL_REQUIRED provider=alpha_vantage reason=missing unlocks="fundamentals" fallback=none extra_field=ignored]';
    const parsed = parseToolTag(input);
    expect(parsed?.kind).toBe("credential_required");
    if (parsed?.kind === "credential_required") {
      expect(parsed.provider).toBe("alpha_vantage");
    }
  });

  it("finds the tag anywhere in a multi-line content block", () => {
    const multi =
      "Some leading natural-language text describing the gap.\n\n" +
      '[OPENCANDLE_SKIPPED provider=fred reason=credential_not_provided remediation="run /connect economy"]\n\n' +
      "And a trailing paragraph.";
    const parsed = parseToolTag(multi);
    expect(parsed?.kind).toBe("skipped");
    if (parsed?.kind === "skipped") {
      expect(parsed.provider).toBe("fred");
    }
  });
});
