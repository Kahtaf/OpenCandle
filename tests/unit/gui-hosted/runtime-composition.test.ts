import { describe, expect, it } from "vitest";
import { auditRuntimeComposition } from "../../../gui/hosted/scripts/runtime-composition.mjs";

function audit(inputs: string[]) {
  return auditRuntimeComposition({
    output: "",
    metafile: {
      inputs: Object.fromEntries(inputs.map((input) => [input, { bytes: 1, imports: [] }])),
    },
    sensitiveValues: [],
    maxBytes: 1_000,
  });
}

describe("auditRuntimeComposition", () => {
  it("ignores Pi provider support modules that do not implement a provider", () => {
    expect(
      audit([
        "node_modules/@earendil-works/pi-ai/dist/providers/anthropic.js",
        "node_modules/@earendil-works/pi-ai/dist/providers/radius-config.js",
      ]).piProviders,
    ).toEqual(["anthropic"]);
  });

  it("continues to reject bundled provider implementations outside the allowlist", () => {
    expect(() =>
      audit(["node_modules/@earendil-works/pi-ai/dist/providers/openrouter.js"]),
    ).toThrow("Unapproved Pi provider found: openrouter");
  });
});
