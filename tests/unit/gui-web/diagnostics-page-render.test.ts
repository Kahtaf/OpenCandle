import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const dialogMocks = vi.hoisted(() => ({
  Action: vi.fn(),
  Root: vi.fn(),
}));

vi.mock("../../../gui/web/src/components/ui/alert-dialog.jsx", async () => {
  const ReactModule = await import("react");
  const element =
    (tag) =>
    ({ children, ...props }) =>
      ReactModule.createElement(tag, props, children);
  return {
    AlertDialog: (props) => {
      dialogMocks.Root(props);
      return ReactModule.createElement("div", { "data-dialog": "root" }, props.children);
    },
    AlertDialogAction: (props) => {
      dialogMocks.Action(props);
      return ReactModule.createElement("button", props, props.children);
    },
    AlertDialogCancel: element("button"),
    AlertDialogContent: element("div"),
    AlertDialogDescription: element("p"),
    AlertDialogFooter: element("footer"),
    AlertDialogHeader: element("header"),
    AlertDialogTitle: element("h2"),
  };
});

import {
  DiagnosticsContent,
  SessionCheckDialog,
} from "../../../gui/web/src/features/diagnostics/DiagnosticsPage.jsx";

describe("DiagnosticsContent rendering", () => {
  it("renders report sections and remediation actions", () => {
    const html = renderToStaticMarkup(
      React.createElement(DiagnosticsContent, {
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
                  id: "provider.alpha_vantage.credential",
                  label: "Alpha Vantage",
                  status: "skip",
                  capability: "optional",
                  summary: "Not connected — optional.",
                  remediation: "Free, about 30 seconds. Run /connect alpha_vantage.",
                  metadata: {
                    providerId: "alpha_vantage",
                    unlocks: ["company fundamentals"],
                  },
                },
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

    expect(html).toContain("OpenCandle is usable with degraded capabilities.");
    expect(html).toContain("Runtime");
    expect(html).toContain("Model");
    expect(html).toContain("Providers");
    expect(html).toContain("Model setup");
    expect(html).toContain("Connect");
    expect(html).toContain("Connect in OpenCandle to enable company fundamentals.");
    expect(html).not.toContain("Run /connect alpha_vantage");
    expect(html).toContain("Providers");
    expect(html).toContain("Check sessions");
    expect(html).toContain("Data quality: 1 provider needs setup.");
    expect(html).toContain("rounded-xl");
    expect(html).toContain("text-balance");
    expect(html).toContain("tabular-nums");
    // The report is a settings section now: the page frame belongs to the shell.
    expect(html).not.toContain("<main");
    expect(html).toContain("TradingView Lightweight Charts");
    expect(html).toContain("Copyright (c) 2025 TradingView, Inc.");
    expect(html).toContain("https://www.tradingview.com/");
  });

  it("renders the sessions warning with cancel and confirm actions", () => {
    dialogMocks.Action.mockClear();
    dialogMocks.Root.mockClear();
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();
    const html = renderToStaticMarkup(
      React.createElement(SessionCheckDialog, { open: true, onOpenChange, onConfirm }),
    );

    expect(html).toContain("Session checks may read browser cookies");
    expect(html).toContain("Cancel");
    expect(html).toContain("Continue");
    dialogMocks.Action.mock.calls[0][0].onClick();
    dialogMocks.Root.mock.calls[0][0].onOpenChange(false);
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders unknown-only checks as ready grouped rows with neutral zero counts", () => {
    const html = renderToStaticMarkup(
      React.createElement(DiagnosticsContent, {
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

  it("does not show local reconnect or browser-cookie controls to hosted followers", () => {
    const html = renderToStaticMarkup(
      React.createElement(DiagnosticsContent, {
        role: "follower",
        initialReport: {
          runtime: "hosted-web",
          status: "degraded",
          summary: "The browser runtime is ready.",
          sections: [
            {
              id: "hosted-runtime",
              label: "Hosted runtime",
              status: "ready",
              checks: [
                {
                  id: "browser-node",
                  label: "Browser-hosted Node and Pi",
                  status: "pass",
                  detail: "v22",
                },
              ],
            },
          ],
        },
      }),
    );

    expect(html).toContain("Browser-hosted Node and Pi");
    expect(html).not.toContain("reconnects local access");
    expect(html).not.toContain("Check sessions");
  });
});
