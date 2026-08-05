// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AlertsPage } from "../../../gui/web/src/features/market-state/AlertsPage.jsx";

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
