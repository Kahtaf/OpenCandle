// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { settingsSectionRegistry } from "../../../gui/web/src/features/settings/section-registry.jsx";
import { PreferencesSection } from "../../../gui/web/src/features/settings/sections/PreferencesSection.jsx";
import { RuntimeTransportProvider } from "../../../gui/web/src/runtime/runtime-transport-provider.jsx";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

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
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const SNAPSHOT = {
  preferences: [
    {
      namespace: "global",
      key: "risk_profile",
      value: "balanced",
      source: "explicit",
      confidence: "high",
      updatedAt: "2026-08-01T10:00:00.000Z",
    },
    {
      namespace: "global",
      key: "position_sizing",
      value: { maxPct: 8, floor: null },
      source: "inferred",
      confidence: "low",
      updatedAt: "2026-08-02T10:00:00.000Z",
    },
  ],
  toolDefaults: [
    {
      toolName: "get_stock_history",
      paramPath: "range",
      value: "6mo",
      setAt: "2026-08-01T10:00:00.000Z",
    },
  ],
};

const EMPTY = { preferences: [], toolDefaults: [] };

function renderSection(transport: Record<string, unknown>, props: Record<string, unknown> = {}) {
  const setToast = vi.fn();
  act(() => {
    root.render(
      React.createElement(
        RuntimeTransportProvider,
        { transport },
        React.createElement(PreferencesSection, { role: "writer", setToast, ...props }),
      ),
    );
  });
  return { setToast };
}

function makeTransport(overrides: Record<string, unknown> = {}) {
  return {
    kind: "loopback",
    getPreferences: vi.fn(async () => structuredClone(SNAPSHOT)),
    deletePreference: vi.fn(async () => structuredClone(EMPTY)),
    deleteToolDefault: vi.fn(async () => structuredClone(EMPTY)),
    ...overrides,
  };
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function query<T extends Element>(selector: string): T | null {
  return document.body.querySelector<T>(selector);
}

function queryAll<T extends Element>(selector: string): T[] {
  return [...document.body.querySelectorAll<T>(selector)];
}

function click(element: Element | null | undefined) {
  act(() => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function buttonNamed(text: string) {
  return queryAll<HTMLButtonElement>("button").find(
    (button) => button.textContent?.trim() === text,
  );
}

describe("Settings preferences section", () => {
  it("is the registered component for the preferences section", () => {
    expect(settingsSectionRegistry.preferences.Component).toBe(PreferencesSection);
  });

  it("lists both stores under their own headings with readable values", async () => {
    renderSection(makeTransport());
    await settle();

    const groups = queryAll('[data-slot="preferences-group"]');
    expect(groups.map((group) => group.querySelector("h3")?.textContent?.trim())).toEqual([
      "Preferences",
      "Tool defaults",
    ]);

    const rows = queryAll('[data-slot="preference-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("risk_profile");
    expect(rows[0].textContent).toContain("balanced");
    expect(rows[0].textContent).toContain("explicit");
    expect(rows[0].textContent).toContain("high");
    // A structured value renders as compact JSON, not [object Object].
    expect(rows[1].textContent).toContain('{"maxPct":8,"floor":null}');
    expect(document.body.textContent).not.toContain("[object Object]");

    const toolRows = queryAll('[data-slot="tool-default-row"]');
    expect(toolRows).toHaveLength(1);
    expect(toolRows[0].textContent).toContain("get_stock_history");
    expect(toolRows[0].textContent).toContain("range");
    expect(toolRows[0].textContent).toContain("6mo");
  });

  it("renders one explanatory line and no table chrome when both stores are empty", async () => {
    renderSection(makeTransport({ getPreferences: vi.fn(async () => structuredClone(EMPTY)) }));
    await settle();

    const empty = query('[data-slot="preferences-empty"]');
    expect(empty?.textContent).toContain("OpenCandle saves preferences it learns from your");
    expect(empty?.textContent).not.toContain("—");
    expect(queryAll('[data-slot="preferences-group"]')).toHaveLength(0);
    expect(query("table")).toBe(null);
  });

  it("deletes a preference only after the dialog is confirmed, then refetches", async () => {
    const transport = makeTransport();
    renderSection(transport);
    await settle();
    expect(transport.getPreferences).toHaveBeenCalledTimes(1);

    click(queryAll('[data-slot="preference-delete"]')[0]);
    expect(query('[role="alertdialog"]')).toBeTruthy();

    click(buttonNamed("Cancel"));
    await settle();
    expect(transport.deletePreference).not.toHaveBeenCalled();

    click(queryAll('[data-slot="preference-delete"]')[0]);
    click(query('[data-slot="preference-delete-confirm"]'));
    await settle();

    expect(transport.deletePreference).toHaveBeenCalledWith({
      namespace: "global",
      key: "risk_profile",
    });
    expect(transport.getPreferences).toHaveBeenCalledTimes(2);
  });

  it("deletes a tool default through its own confirmed action", async () => {
    const transport = makeTransport();
    renderSection(transport);
    await settle();

    click(queryAll('[data-slot="tool-default-delete"]')[0]);
    click(query('[data-slot="tool-default-delete-confirm"]'));
    await settle();

    expect(transport.deleteToolDefault).toHaveBeenCalledWith({
      toolName: "get_stock_history",
      paramPath: "range",
    });
  });

  it("reports a failed delete through the toast surface and keeps the row", async () => {
    const transport = makeTransport({
      deletePreference: vi.fn(async () => {
        throw new Error("OpenCandle is reconnecting to this session.");
      }),
    });
    const { setToast } = renderSection(transport);
    await settle();

    click(queryAll('[data-slot="preference-delete"]')[0]);
    click(query('[data-slot="preference-delete-confirm"]'));
    await settle();

    expect(setToast).toHaveBeenCalledWith("OpenCandle is reconnecting to this session.", {
      destructive: true,
    });
    expect(queryAll('[data-slot="preference-row"]')).toHaveLength(2);
  });

  it("keeps a local follower read-only while still listing what is saved", async () => {
    const transport = makeTransport();
    renderSection(transport, { role: "follower" });
    await settle();

    expect(queryAll('[data-slot="preference-row"]')).toHaveLength(2);
    expect(
      queryAll<HTMLButtonElement>('[data-slot="preference-delete"]').every(
        (button) => button.disabled,
      ),
    ).toBe(true);
    expect(document.body.textContent).toContain("unavailable in this window");
  });

  it("keeps an offline hosted tab read-only for deletes", async () => {
    const transport = makeTransport({ kind: "hosted" });
    renderSection(transport, { role: "offline" });
    await settle();

    expect(query('[data-slot="preferences-read-only"]')).toBeTruthy();
    const deleteButton = queryAll<HTMLButtonElement>('[data-slot="preference-delete"]')[0];
    expect(deleteButton?.disabled).toBe(true);
  });

  it("keeps a hosted follower able to delete", async () => {
    const transport = makeTransport({ kind: "hosted" });
    renderSection(transport, { role: "follower" });
    await settle();

    expect(
      queryAll<HTMLButtonElement>('[data-slot="preference-delete"]').every(
        (button) => button.disabled,
      ),
    ).toBe(false);
    expect(document.body.textContent).not.toContain("unavailable in this window");
  });

  it("adopts a pushed preferences broadcast without refetching", async () => {
    const transport = makeTransport();
    renderSection(transport);
    await settle();
    expect(document.body.textContent).toContain("risk_profile");

    renderSection(transport, {
      preferencesSnapshot: {
        preferences: [
          {
            namespace: "workflow",
            key: "moneyness_preference",
            value: "itm",
            source: "conversation",
            confidence: "high",
            updatedAt: "2026-08-06T00:00:00.000Z",
          },
        ],
        toolDefaults: [],
      },
    });
    await settle();
    expect(document.body.textContent).toContain("moneyness_preference");
    expect(document.body.textContent).not.toContain("risk_profile");
    expect(transport.getPreferences).toHaveBeenCalledTimes(1);
  });

  it("reports a failed load without pretending both stores are empty", async () => {
    const transport = makeTransport({
      getPreferences: vi.fn(async () => {
        throw new Error("Preferences are unavailable right now.");
      }),
    });
    renderSection(transport);
    await settle();

    expect(query('[data-slot="preferences-error"]')?.textContent).toContain(
      "Preferences are unavailable right now.",
    );
    expect(query('[data-slot="preferences-empty"]')).toBe(null);
  });
});
