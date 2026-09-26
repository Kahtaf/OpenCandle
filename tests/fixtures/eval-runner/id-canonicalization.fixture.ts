import { describe, it } from "vitest";

/**
 * Tiny real Vitest suite used by release-eval-evidence tests to prove that
 * `vitest list --staticParse=false --json` names and `--reporter=json`
 * fullNames canonicalize to the same ids. It is intentionally NOT under
 * tests/unit (or any default project include) so its empty harness bodies
 * never inflate the default unit pass count.
 */
describe("release eval id fixture", () => {
  describe("nested group", () => {
    it("plain case", () => {});

    it.each(["alpha", "beta"])("parameter case %s", () => {});
  });

  it("top level case", () => {});
});
