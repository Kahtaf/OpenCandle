import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  confirmSessionCheck,
  DiagnosticsPage,
} from "../../../gui/web/src/features/diagnostics/DiagnosticsPage.jsx";

describe("DiagnosticsPage rendering", () => {
  it("renders report sections and remediation actions", () => {
    const html = renderToStaticMarkup(
      React.createElement(DiagnosticsPage, {
        role: "writer",
        dataQuality: { hardSkips: [{ provider: "fred" }], softGaps: [] },
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
                  remediation:
                    "Run `opencandle doctor --sessions` to check browser-cookie session readiness.",
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
    expect(html).toContain("Data quality: 1 provider needs setup.");
    expect(html).toContain("rounded-xl");
    expect(html).toContain("text-balance");
    expect(html).toContain("tabular-nums");
  });

  it("uses the browser-session confirmation result", () => {
    expect(confirmSessionCheck(vi.fn(() => true))).toBe(true);
    expect(confirmSessionCheck(vi.fn(() => false))).toBe(false);
  });

  it("renders unknown-only checks as ready grouped rows with neutral zero counts", () => {
    const html = renderToStaticMarkup(
      React.createElement(DiagnosticsPage, {
        role: "writer",
        initialReport: {
          schemaVersion: 1,
          generatedAt: "2026-06-22T12:00:00.000Z",
          status: "ready",
          summary: "OpenCandle core health is ready with 1 optional capability unchecked.",
          metadata: {
            cwd: "/repo",
            opencandleHome: "/tmp/opencandle",
            opencandleHomeSource: "default",
          },
          sections: [
            {
              id: "sessions",
              label: "Sessions",
              status: "ready",
              checks: [
                {
                  id: "provider.reddit.session",
                  label: "Reddit browser session",
                  status: "unknown",
                  capability: "optional",
                  summary: "Not checked",
                },
              ],
            },
          ],
        },
      }),
    );

    expect(html).toContain("Ready");
    expect(html).toContain("OpenCandle core health is ready with 1 optional capability unchecked.");
    expect(html).toContain("<table");
    expect(html).not.toContain("rounded-lg border");
    expect(html).toMatch(/Failures<\/div><div class="[^"]*text-muted-foreground[^"]*">0<\/div>/);
    expect(html).toMatch(/Warnings<\/div><div class="[^"]*text-muted-foreground[^"]*">0<\/div>/);
  });
});
