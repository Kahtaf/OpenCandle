import { describe, expect, it } from "vitest";
import {
  activeToolsForBundles,
  TOOL_BUNDLE_TOOLS,
  WORKFLOW_CAPABILITY_MANIFEST,
} from "../../../src/routing/route-manifest.js";

describe("tool bundles", () => {
  it("exposes event probabilities through the macro bundle", () => {
    expect(TOOL_BUNDLE_TOOLS.macro).toContain("get_event_probabilities");
  });

  it("keeps event probabilities available to general finance answers through macro tools", () => {
    expect(WORKFLOW_CAPABILITY_MANIFEST.general_finance_qa.toolBundles).toContain("macro");
    expect(activeToolsForBundles(["macro"])).toContain("get_event_probabilities");
  });
});
