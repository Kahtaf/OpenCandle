import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../../../gui/web/src/components/ui/tooltip.jsx";
import { FinancialContextContent } from "../../../gui/web/src/features/context-panel/FinancialContextPanel.jsx";

describe("FinancialContextDrawer", () => {
  function renderDrawer(state: Record<string, unknown>) {
    return renderToStaticMarkup(
      React.createElement(
        TooltipProvider,
        null,
        React.createElement(FinancialContextContent, {
          state,
          catalog: { providers: [] },
          onConfigureProvider: vi.fn(),
          onOpenMarketState: vi.fn(),
        }),
      ),
    );
  }

  it("renders last-turn and receipts above existing drawer sections", () => {
    const html = renderDrawer({
      watchlist: [],
      activeAnalyses: [
        {
          workflowId: "wf-1",
          workflow: "portfolio_builder",
          analystsTotal: 5,
          analystsDone: 2,
          startedAt: "2026-07-05T12:00:00.000Z",
        },
      ],
      recentResearch: [],
      dataQuality: { softGaps: [], hardSkips: [] },
      lastTurn: {
        routeKind: "workflow",
        workflow: "portfolio_builder",
        symbols: ["AAPL", "MSFT"],
        slotSources: { user: 1, default: 1 },
        priorTurnCount: 2,
        savedStateIncluded: true,
        attachmentCount: 1,
        validation: { passed: false, mismatchCount: 2 },
      },
    });

    expect(html).toContain("What the agent sees");
    expect(html).toContain("Last turn");
    expect(html).toContain("Portfolio builder");
    expect(html).toContain("AAPL, MSFT");
    expect(html).toContain("user 1");
    expect(html).toContain("default 1");
    expect(html).toContain("Attachments");
    expect(html).toContain("Receipts");
    expect(html).toContain("2 mismatches");
    expect(html.indexOf("Last turn")).toBeLessThan(html.indexOf("Saved state"));
  });

  it("states when validation did not run instead of defaulting to zero mismatches", () => {
    const html = renderDrawer({
      watchlist: [],
      activeAnalyses: [],
      recentResearch: [],
      dataQuality: { softGaps: [], hardSkips: [] },
      lastTurn: {
        routeKind: "agent_task",
        symbols: [],
        slotSources: {},
        priorTurnCount: 0,
      },
    });

    expect(html).toContain("No validation ran");
    expect(html).not.toContain("0 mismatches");
  });
});
