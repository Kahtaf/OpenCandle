import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  AlertCreateForm,
  clampComboboxActiveIndex,
  HoldingForm,
  invokeMarketStateMutation,
  MarketStatePage,
  nextComboboxActiveIndex,
  PortfolioRenameForm,
  SymbolActionPanel,
  SymbolSearchInput,
  WatchlistRenameForm,
} from "../../../gui/web/src/features/market-state/MarketStatePage.jsx";

describe("MarketStatePage rendering", () => {
  it("offers a skip-for-now path on the empty portfolio page", () => {
    const html = renderToStaticMarkup(
      React.createElement(MarketStatePage, {
        domain: "portfolios",
        role: "writer",
        send: () => false,
        navigate: () => undefined,
        setToast: () => undefined,
      }),
    );

    expect(html).toContain("No holdings yet");
    expect(html).toContain("Skip For Now");
  });

  it("uses the shared app shell chrome without duplicate section tabs", () => {
    const html = renderToStaticMarkup(
      React.createElement(MarketStatePage, {
        domain: "watchlists",
        role: "writer",
        send: () => false,
        navigate: () => undefined,
        setToast: () => undefined,
        onOpenSidebar: () => undefined,
      }),
    );

    expect(html).toContain('aria-label="Open sidebar"');
    expect(html).not.toContain('aria-label="Market state sections"');
  });

  it("renders named watchlists as tabs with a new-watchlist action", () => {
    const html = renderToStaticMarkup(
      React.createElement(MarketStatePage, {
        domain: "watchlists",
        role: "writer",
        send: () => false,
        navigate: () => undefined,
        setToast: () => undefined,
      }),
    );

    expect(html).toContain("New Watchlist");
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tab"');
    expect(html).toContain("Default");
    expect(html).toContain("Add ticker");
    expect(html).toContain('aria-label="Rename Default"');
    expect(html).not.toContain("To target");
    expect(html).not.toContain("Thesis");
  });

  it("renders named portfolios as tabs with create, rename, and add-holding actions", () => {
    const html = renderToStaticMarkup(
      React.createElement(MarketStatePage, {
        domain: "portfolios",
        role: "writer",
        send: () => false,
        navigate: () => undefined,
        setToast: () => undefined,
      }),
    );

    expect(html).toContain("New Portfolio");
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tab"');
    expect(html).toContain("Default");
    expect(html).toContain("Add holding");
    expect(html).toContain('aria-label="Rename Default"');
  });

  it("renders a focused watchlist rename form", () => {
    const html = renderToStaticMarkup(
      React.createElement(WatchlistRenameForm, {
        disabled: false,
        watchlist: { id: 1, name: "MAG7", isDefault: false },
        onSubmit: () => true,
      }),
    );

    expect(html).toContain("Name");
    expect(html).toContain('value="MAG7"');
    expect(html).toContain("Rename watchlist");
  });

  it("renders a focused portfolio rename form", () => {
    const html = renderToStaticMarkup(
      React.createElement(PortfolioRenameForm, {
        disabled: false,
        portfolio: { id: 1, name: "Trading", isDefault: false, baseCurrency: "USD" },
        onSubmit: () => true,
      }),
    );

    expect(html).toContain("Name");
    expect(html).toContain('value="Trading"');
    expect(html).toContain("Rename portfolio");
  });

  it("renders the report schedule and generate action as durable report state", () => {
    const html = renderToStaticMarkup(
      React.createElement(MarketStatePage, {
        domain: "reports",
        role: "writer",
        send: () => false,
        navigate: () => undefined,
        setToast: () => undefined,
      }),
    );

    expect(html).toContain("Generate today");
    expect(html).toContain("History");
  });

  it("refreshes quotes in the background instead of offering manual refresh buttons", () => {
    const html = renderToStaticMarkup(
      React.createElement(MarketStatePage, {
        domain: "watchlists",
        role: "writer",
        send: () => false,
        navigate: () => undefined,
        setToast: () => undefined,
      }),
    );

    expect(html).not.toContain("Refresh prices");
    expect(html).not.toContain(">Refresh<");
    expect(html).toContain("Awaiting quotes");
    expect(html).not.toContain("SQLite-backed");
    expect(html).not.toContain("Search Yahoo candidates before saving");
  });

  it("renders the alert log as durable alert state", () => {
    const html = renderToStaticMarkup(
      React.createElement(MarketStatePage, {
        domain: "alerts",
        role: "writer",
        send: () => false,
        navigate: () => undefined,
        setToast: () => undefined,
      }),
    );

    expect(html).toContain("Active rules");
    expect(html).toContain("Alert log");
    expect(html).not.toContain("Instrument #");
  });

  it("keeps reconnecting market-state pages readable while disabling mutation actions", () => {
    const html = renderToStaticMarkup(
      React.createElement(MarketStatePage, {
        domain: "alerts",
        role: "follower",
        send: () => false,
        navigate: () => undefined,
        setToast: () => undefined,
      }),
    );

    expect(html).toContain("Saved-state changes are unavailable");
    expect(html).toContain("Create alert");
    expect(html).toContain("disabled");
  });

  it("keeps connecting and disconnected market-state mutations unavailable", () => {
    for (const role of ["connecting", "disconnected"]) {
      const html = renderToStaticMarkup(
        React.createElement(MarketStatePage, {
          domain: "watchlists",
          role,
          send: () => false,
          navigate: () => undefined,
          setToast: () => undefined,
        }),
      );

      expect(html).toContain("Saved-state changes");
      expect(html).toContain("disabled");
    }
  });

  it("renders symbol search with combobox semantics", () => {
    const html = renderToStaticMarkup(
      React.createElement(SymbolSearchInput, {
        query: "AA",
        selected: "",
        disabled: false,
        onQueryChange: () => undefined,
        onSelectedChange: () => undefined,
      }),
    );

    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-autocomplete="list"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("aria-controls=");
  });

  it("derives combobox active index without prop-change state syncing", () => {
    expect(clampComboboxActiveIndex(3, 2)).toBe(1);
    expect(clampComboboxActiveIndex(-1, 2)).toBe(-1);
    expect(clampComboboxActiveIndex(0, 0)).toBe(-1);

    expect(nextComboboxActiveIndex(-1, 3, "next")).toBe(0);
    expect(nextComboboxActiveIndex(2, 3, "next")).toBe(0);
    expect(nextComboboxActiveIndex(-1, 3, "previous")).toBe(2);
    expect(nextComboboxActiveIndex(0, 3, "previous")).toBe(2);
  });

  it("keeps holding forms out of the first viewport", () => {
    const html = renderToStaticMarkup(
      React.createElement(MarketStatePage, {
        domain: "portfolios",
        role: "writer",
        send: () => false,
        navigate: () => undefined,
        setToast: () => undefined,
      }),
    );

    expect(html).toContain("Add holding");
    expect(html).toContain("Portfolios");
    expect(html).not.toContain("Use the lot id shown in the portfolio table");
  });

  it("rejects market-state mutations without acknowledged invoke support", async () => {
    const setPendingMutationCalls = [];
    const toastCalls = [];
    const saved = await invokeMarketStateMutation({
      readOnly: false,
      toolName: "manage_watchlist",
      args: { action: "add", symbol: "AAPL" },
      setPendingMutation: (value) => setPendingMutationCalls.push(value),
      setToast: (message, options) => toastCalls.push({ message, options }),
      refresh: () => {
        throw new Error("unexpected refresh");
      },
    });

    expect(saved).toBe(false);
    expect(setPendingMutationCalls).toEqual([{ toolName: "manage_watchlist" }, null]);
    expect(toastCalls).toEqual([
      expect.objectContaining({
        message:
          "Market-state mutations require acknowledged tool invocation support. Reconnect the GUI and try again.",
      }),
    ]);
  });

  it("refreshes quotes immediately after acknowledged market-state mutations", async () => {
    const refresh = vi.fn();
    const refreshQuotes = vi.fn();
    const invokeToolRequest = vi.fn(async () => undefined);

    const saved = await invokeMarketStateMutation({
      readOnly: false,
      toolName: "manage_watchlist",
      args: { action: "add", symbol: "AAPL" },
      invokeToolRequest,
      refresh,
      refreshQuotes,
    });

    expect(saved).toBe(true);
    expect(invokeToolRequest).toHaveBeenCalledWith("manage_watchlist", {
      action: "add",
      symbol: "AAPL",
    }, "", { recordTranscript: false });
    expect(refresh).toHaveBeenCalledOnce();
    expect(refreshQuotes).toHaveBeenCalledOnce();
  });

  it("names market-state form controls for assistive technology", () => {
    const alertHtml = renderToStaticMarkup(
      React.createElement(AlertCreateForm, {
        disabled: false,
        invokeTool: () => true,
        onSaved: () => undefined,
      }),
    );
    const symbolHtml = renderToStaticMarkup(
      React.createElement(SymbolActionPanel, {
        disabled: false,
        onSubmit: () => true,
      }),
    );
    const holdingHtml = renderToStaticMarkup(
      React.createElement(HoldingForm, {
        disabled: false,
        onSubmit: () => true,
      }),
    );

    expect(alertHtml).toContain(">Condition<select");
    expect(alertHtml).toContain(">Threshold<input");
    // Period only renders for SMA/RSI/volume conditions; the default price-above
    // condition hides it instead of showing a disabled field.
    expect(alertHtml).not.toContain(">Period (days)<input");
    expect(alertHtml).toContain(">Cooldown between triggers (seconds)<input");
    expect(symbolHtml).toContain("Search ticker or company");
    expect(holdingHtml).toContain(">Quantity<input");
    expect(holdingHtml).toContain(">Average cost per share<input");
    expect(holdingHtml).toContain(">Currency<input");
    expect(symbolHtml).not.toContain(">Target<input");
    expect(symbolHtml).not.toContain(">Thesis<textarea");
  });
});
