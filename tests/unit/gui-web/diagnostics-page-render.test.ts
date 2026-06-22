import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DiagnosticsPage } from "../../../gui/web/src/features/diagnostics/DiagnosticsPage.jsx";

describe("DiagnosticsPage rendering", () => {
  it("renders report sections and remediation actions", () => {
    const html = renderToStaticMarkup(
      React.createElement(DiagnosticsPage, {
        role: "writer",
        initialReport: {
          schemaVersion: 1,
          generatedAt: "2026-06-22T12:00:00.000Z",
          status: "degraded",
          summary: "OpenCandle is usable with degraded capabilities.",
          metadata: {
            cwd: "/repo",
            opencandleHome: "/tmp/opencandle",
            opencandleHomeSource: "default",
          },
          sections: [
            {
              id: "runtime",
              label: "Runtime",
              status: "ready",
              checks: [
                {
                  id: "runtime.node",
                  label: "Node.js",
                  status: "pass",
                  capability: "core",
                  summary: "Node v22.22.0",
                },
              ],
            },
            {
              id: "model",
              label: "Model",
              status: "blocked",
              checks: [
                {
                  id: "model.readiness",
                  label: "Model readiness",
                  status: "fail",
                  capability: "core",
                  summary: "No usable model credentials are configured",
                  remediation: "Run /setup.",
                },
              ],
            },
            {
              id: "providers",
              label: "Providers",
              status: "degraded",
              checks: [
                {
                  id: "provider.reddit.session",
                  label: "Reddit browser session",
                  status: "unknown",
                  capability: "optional",
                  summary: "Not checked",
                  remediation: "Run opencandle doctor --sessions.",
                  metadata: { providerId: "reddit" },
                },
              ],
            },
          ],
        },
      }),
    );

    expect(html).toContain("Diagnostics");
    expect(html).toContain("Runtime");
    expect(html).toContain("Model");
    expect(html).toContain("Providers");
    expect(html).toContain("Model setup");
    expect(html).toContain("Providers");
    expect(html).toContain("Check sessions");
  });
});
