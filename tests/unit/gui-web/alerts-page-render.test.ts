// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AlertsPage } from "../../../gui/web/src/features/market-state/AlertsPage.jsx";
import {
  ALERT_CONDITION_OPTIONS,
  AlertCreateForm,
  alertThresholdPrefill,
  nextAlertThreshold,
} from "../../../gui/web/src/features/market-state/MarketStatePage.jsx";
import { RuntimeTransportContext } from "../../../gui/web/src/runtime/runtime-transport-context.js";

const ARMED_RULE = {
  id: 1,
  scopeType: "instrument",
  instrumentId: 7,
  conditionType: "price_crosses_above",
  conditionJson: { threshold: 55, field: "last_price" },
  enabled: true,
  retriggerMode: "recurring",
  lastCheckedAt: new Date().toISOString(),
  lastObservedJson: { field: "last_price", value: 70.31, at: new Date().toISOString() },
};

function alertsPageProps(state = {}) {
  return {
    state: {
      alerts: [ARMED_RULE],
      alertEvents: [],
      alertCheckRuns: [],
      instruments: [{ id: 7, symbol: "RKLB" }],
      notifications: [],
      notificationDeliveryAttempts: [],
      ...state,
    },
    filter: "",
    setFilter: () => undefined,
    readOnly: false,
    openPanel: () => undefined,
    invokeTool: () => undefined,
  };
}

describe("AlertsPage rule rows", () => {
  it("leads with the rule sentence and one short status", () => {
    const html = renderToStaticMarkup(React.createElement(AlertsPage, alertsPageProps()));

    expect(html).toContain("Price crosses above $55.00");
    expect(html).toContain("Armed · checked just now");
    // The observed-value chain is available, but not in the resting row.
    expect(html).not.toContain("waiting for next upward cross");
    expect(html).toContain('aria-expanded="false"');
  });

  it("keeps a paused rule readable without an action chain", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        AlertsPage,
        alertsPageProps({ alerts: [{ ...ARMED_RULE, enabled: false }] }),
      ),
    );

    expect(html).toContain(">Paused<");
    expect(html).toContain('aria-label="Resume RKLB alert"');
  });

  it("collapses an empty activity feed to one line once rules exist", () => {
    const html = renderToStaticMarkup(React.createElement(AlertsPage, alertsPageProps()));

    expect(html).toContain("Activity");
    expect(html).toContain("Alert firings and unavailable checks appear here.");
    expect(html).not.toContain('data-slot="activity-row"');
  });

  it("shows one activity row for a firing instead of an alert log and a notification", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        AlertsPage,
        alertsPageProps({
          alertEvents: [
            {
              id: 4,
              alertRuleId: 1,
              instrumentId: 7,
              status: "triggered",
              message: "crossed above $55.00",
              observedAt: "2026-08-04T14:00:00.000Z",
              triggeredAt: "2026-08-04T14:00:00.000Z",
            },
          ],
          notifications: [
            {
              id: 22,
              sourceType: "alert_event",
              sourceId: 4,
              status: "unread",
              severity: "warning",
              title: "Alert triggered",
              createdAt: "2026-08-04T14:00:00.000Z",
            },
          ],
        }),
      ),
    );

    expect(html.match(/data-slot="activity-row"/g)).toHaveLength(1);
    expect(html).toContain("RKLB crossed above $55.00");
    expect(html).toContain('aria-label="Mark read: RKLB crossed above $55.00"');
    expect(html).not.toContain("Alert triggered");
    expect(html).not.toContain("in-app");
  });
});

describe("AlertsPage rule row disclosure", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("explains why an armed rule has not fired yet", () => {
    act(() => root.render(React.createElement(AlertsPage, alertsPageProps())));

    const disclosure = container.querySelector<HTMLButtonElement>(
      '[data-slot="alert-status-disclosure"]',
    );
    expect(disclosure).not.toBeNull();
    expect(container.querySelector('[data-slot="alert-status-detail"]')).toBeNull();

    act(() => disclosure?.click());

    const detail = container.querySelector('[data-slot="alert-status-detail"]');
    expect(detail?.textContent).toContain("above $55.00, waiting for next upward cross");
    expect(disclosure?.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("create alert sheet", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("describes every condition in one line", () => {
    expect(ALERT_CONDITION_OPTIONS.map((option) => option.value)).toContain("create_price_above");
    for (const option of ALERT_CONDITION_OPTIONS) {
      expect(option.description).toBeTruthy();
      expect(option.description).not.toContain("—");
      expect(option.description.split(" ").length).toBeLessThanOrEqual(12);
    }
    expect(
      ALERT_CONDITION_OPTIONS.find((option) => option.value === "create_price_above")?.description,
    ).toBe("The first time price crosses your level going up.");
    expect(
      ALERT_CONDITION_OPTIONS.find((option) => option.value === "create_volume_spike")?.description,
    ).toBe("Volume runs above its recent average by your multiple.");
  });

  it("leads with the rule sentence and its repeat window", () => {
    const html = renderToStaticMarkup(
      React.createElement(AlertCreateForm, {
        disabled: false,
        invokeTool: () => true,
        symbol: "NVDA",
      }),
    );

    expect(html).toContain('data-slot="alert-preview"');
    expect(html).toContain("Price crosses above a price you set");
    expect(html).toContain("Repeats at most once an hour while OpenCandle is open");
  });

  it("asks for a symbol before it can preview a rule", () => {
    const html = renderToStaticMarkup(
      React.createElement(AlertCreateForm, { disabled: false, invokeTool: () => true }),
    );

    expect(html).toContain("Search for a symbol to preview this rule.");
  });

  it("prefills the threshold from the current quote and states the distance", async () => {
    const transport = {
      kind: "loopback",
      getInstrumentQuote: async () => ({ status: "ok", price: 204.25, currency: "USD" }),
      searchInstruments: async () => ({ candidates: [] }),
    };

    await act(async () => {
      root.render(
        React.createElement(
          RuntimeTransportContext.Provider,
          { value: transport },
          React.createElement(AlertCreateForm, {
            disabled: false,
            invokeTool: () => true,
            symbol: "NVDA",
          }),
        ),
      );
    });

    const threshold = container.querySelector<HTMLInputElement>('input[type="number"]');
    expect(threshold?.value).toBe("204.25");
    expect(container.querySelector('[data-slot="threshold-hint"]')?.textContent).toBe(
      "Current $204.25 · at the current price",
    );
    expect(container.querySelector('[data-slot="alert-preview"]')?.textContent).toContain(
      "Price crosses above $204.25",
    );
  });

  it("drops an auto-filled level when the symbol it came from is replaced", async () => {
    const transport = {
      kind: "loopback",
      getInstrumentQuote: async () => ({ status: "ok", price: 204.25, currency: "USD" }),
      searchInstruments: async () => ({ candidates: [] }),
    };

    await act(async () => {
      root.render(
        React.createElement(
          RuntimeTransportContext.Provider,
          { value: transport },
          React.createElement(AlertCreateForm, {
            disabled: false,
            invokeTool: () => true,
            symbol: "NVDA",
          }),
        ),
      );
    });

    const threshold = container.querySelector<HTMLInputElement>('input[type="number"]');
    expect(threshold?.value).toBe("204.25");

    const search = container.querySelector<HTMLInputElement>('input[role="combobox"]');
    if (!search) throw new Error("symbol search input not rendered");
    const setValue = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setValue?.call(search, "MS");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // NVDA's price must not stay in the field once NVDA is no longer the symbol,
    // or a level nobody chose can be saved against whatever is picked next.
    expect(container.querySelector<HTMLInputElement>('input[type="number"]')?.value).toBe("");
    expect(container.querySelector('[data-slot="threshold-hint"]')).toBeNull();
  });

  it("keeps a level handed over by a link through its own symbol's quote", async () => {
    const transport = {
      kind: "loopback",
      getInstrumentQuote: async () => ({ status: "ok", price: 204.25, currency: "USD" }),
      searchInstruments: async () => ({ candidates: [] }),
    };

    await act(async () => {
      root.render(
        React.createElement(
          RuntimeTransportContext.Provider,
          { value: transport },
          React.createElement(AlertCreateForm, {
            disabled: false,
            invokeTool: () => true,
            symbol: "NVDA",
            threshold: "401.15",
          }),
        ),
      );
    });

    expect(container.querySelector<HTMLInputElement>('input[type="number"]')?.value).toBe("401.15");
  });

  it("drops a level handed over by a link once its symbol is replaced", async () => {
    const transport = {
      kind: "loopback",
      getInstrumentQuote: async () => ({ status: "ok", price: 204.25, currency: "USD" }),
      searchInstruments: async () => ({ candidates: [] }),
    };

    await act(async () => {
      root.render(
        React.createElement(
          RuntimeTransportContext.Provider,
          { value: transport },
          React.createElement(AlertCreateForm, {
            disabled: false,
            invokeTool: () => true,
            symbol: "NVDA",
            threshold: "401.15",
          }),
        ),
      );
    });

    const search = container.querySelector<HTMLInputElement>('input[role="combobox"]');
    if (!search) throw new Error("symbol search input not rendered");
    const setValue = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setValue?.call(search, "MS");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // NVDA's 50-day average must not become a level saved against whatever is
    // picked next.
    expect(container.querySelector<HTMLInputElement>('input[type="number"]')?.value).toBe("");
  });

  it("keeps a sub-cent quote out of a zero threshold", () => {
    expect(alertThresholdPrefill(204.25)).toBe("204.25");
    expect(alertThresholdPrefill(1)).toBe("1.00");
    // Rounding to cents would write 0.00, which saves as a level the price has
    // already crossed instead of an alert at the quoted price.
    expect(alertThresholdPrefill(0.0031)).toBe("0.0031");
    expect(alertThresholdPrefill(0.000004215)).toBe("0.000004215");
    expect(alertThresholdPrefill(0)).toBe("");
    expect(alertThresholdPrefill(Number.NaN)).toBe("");
  });

  it("names the currency the price threshold is entered in", async () => {
    const transport = {
      kind: "loopback",
      getInstrumentQuote: async () => ({ status: "ok", price: 168.64, currency: "EUR" }),
      searchInstruments: async () => ({ candidates: [] }),
    };

    await act(async () => {
      root.render(
        React.createElement(
          RuntimeTransportContext.Provider,
          { value: transport },
          React.createElement(AlertCreateForm, {
            disabled: false,
            invokeTool: () => true,
            symbol: "SAP.DE",
          }),
        ),
      );
    });

    expect(container.textContent).toContain("Price threshold (EUR)");
    expect(container.textContent).not.toContain("Price threshold ($)");
  });

  it("does not carry a price level into a condition that measures something else", () => {
    expect(nextAlertThreshold("create_price_above", "create_price_below", "204.25")).toBe("204.25");
    expect(nextAlertThreshold("create_price_above", "create_rsi_below", "204.25")).toBe("");
    expect(nextAlertThreshold("create_price_above", "create_volume_spike", "204.25")).toBe("2");
    expect(nextAlertThreshold("create_rsi_above", "create_rsi_below", "70")).toBe("70");
  });
});
