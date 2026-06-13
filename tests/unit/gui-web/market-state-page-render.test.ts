import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  AlertCreateForm,
  buildWatchlistMutationArgs,
  buildWatchlistRowActions,
  clampComboboxActiveIndex,
  HoldingForm,
  invokeMarketStateMutation,
  MarketStatePage,
  nextComboboxActiveIndex,
  SymbolActionPanel,
  SymbolSearchInput,
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

  it("frames predictions as scoreable calls with one consistent name", () => {
    const html = renderToStaticMarkup(
      React.createElement(MarketStatePage, {
        domain: "predictions",
        role: "writer",
        send: () => false,
        navigate: () => undefined,
        setToast: () => undefined,
      }),
    );

    expect(html).toContain("Predictions");
    expect(html).toContain("Record prediction");
    expect(html).not.toContain("Thesis Tracker");
  });

  it("keeps follower mode readable while disabling mutation actions", () => {
    const html = renderToStaticMarkup(
      React.createElement(MarketStatePage, {
        domain: "alerts",
        role: "follower",
        send: () => false,
        navigate: () => undefined,
        setToast: () => undefined,
      }),
    );

    expect(html).toContain("Follower mode: read-only");
    expect(html).toContain("Create alert");
    expect(html).toContain("disabled");
  });

  it("keeps connecting and disconnected market-state pages read-only", () => {
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

      expect(html).toContain("read-only");
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

  it("does not create a watchlist alert without an explicit target", () => {
    const invokeTool = () => {
      throw new Error("unexpected invoke");
    };

    const actions = buildWatchlistRowActions(
      {
        symbol: "AAPL",
        targetPrice: null,
      },
      invokeTool,
    );

    expect(actions[0]).toEqual(
      expect.objectContaining({
        label: "Set target first",
        disabled: true,
      }),
    );
  });

  it("creates a watchlist alert with the saved target as threshold", () => {
    const calls = [];
    const actions = buildWatchlistRowActions(
      {
        symbol: "AAPL",
        targetPrice: 250,
      },
      (toolName, args) => calls.push({ toolName, args }),
    );

    actions[0].onClick();

    expect(calls).toEqual([
      {
        toolName: "manage_alerts",
        args: { action: "create_price_above", symbol: "AAPL", threshold: 250 },
      },
    ]);
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
    expect(html).toContain("Holdings");
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

    const saved = await invokeMarketStateMutation({
      readOnly: false,
      toolName: "manage_watchlist",
      args: { action: "add", symbol: "AAPL" },
      invokeToolRequest: async () => undefined,
      refresh,
      refreshQuotes,
    });

    expect(saved).toBe(true);
    expect(refresh).toHaveBeenCalledOnce();
    expect(refreshQuotes).toHaveBeenCalledOnce();
  });

  it("sends explicit clear values for blank watchlist edit fields", () => {
    const addArgs = buildWatchlistMutationArgs("watchlist-add", {
      symbol: "AAPL",
      target_price: "",
      stop_price: "",
      thesis: "",
      notes: "",
      tags: "",
    });
    const editArgs = buildWatchlistMutationArgs("watchlist-edit", {
      symbol: "AAPL",
      target_price: "",
      stop_price: "",
      thesis: "",
      notes: "",
      tags: "",
    });

    expect(addArgs).toMatchObject({
      action: "add",
      symbol: "AAPL",
      target_price: undefined,
      stop_price: undefined,
      thesis: undefined,
      notes: undefined,
      tags: undefined,
    });
    expect(editArgs).toEqual({
      action: "update",
      symbol: "AAPL",
      target_price: null,
      stop_price: null,
      thesis: null,
      notes: null,
      tags: [],
    });
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
        title: "Add ticker",
        disabled: false,
        fields: [
          { name: "target_price", label: "Target", type: "number" },
          { name: "thesis", label: "Thesis", multiline: true },
        ],
        onSubmit: () => true,
      }),
    );
    const holdingHtml = renderToStaticMarkup(
      React.createElement(HoldingForm, {
        disabled: false,
        onSubmit: () => true,
      }),
    );

    expect(alertHtml).toContain('aria-label="Alert condition"');
    expect(alertHtml).toContain('aria-label="Alert threshold"');
    // Period only renders for SMA/RSI/volume conditions; the default price-above
    // condition hides it instead of showing a disabled field.
    expect(alertHtml).not.toContain('aria-label="Alert period"');
    expect(alertHtml).toContain('aria-label="Alert cooldown seconds"');
    expect(symbolHtml).toContain('aria-label="Target"');
    expect(symbolHtml).toContain('aria-label="Thesis"');
    expect(holdingHtml).toContain('aria-label="Quantity"');
    expect(holdingHtml).toContain('aria-label="Average cost"');
    expect(holdingHtml).toContain('aria-label="Currency"');
  });
});
