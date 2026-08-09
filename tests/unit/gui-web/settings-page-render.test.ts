import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const ReactModule = await import("react");
  return {
    Link: ({ to, params, children, ...props }) =>
      ReactModule.createElement(
        "a",
        { href: String(to).replace("$section", String(params?.section ?? "")), ...props },
        children,
      ),
  };
});

import { SettingsPage } from "../../../gui/web/src/features/settings/SettingsPage.jsx";
import {
  settingsSectionList,
  settingsSectionRegistry,
} from "../../../gui/web/src/features/settings/section-registry.jsx";
import { SETTINGS_SECTIONS } from "../../../gui/web/src/route-resolution.js";

function render(props: Record<string, unknown> = {}) {
  return renderToStaticMarkup(React.createElement(SettingsPage, { section: "model", ...props }));
}

function labelMarkup(label: string) {
  return `>${label.replace(/&/g, "&amp;")}<`;
}

describe("settings section registry", () => {
  it("carries one entry per slug, in rail order, each with a component", () => {
    expect(settingsSectionList.map((section) => section.slug)).toEqual(SETTINGS_SECTIONS);
    expect(settingsSectionList.map((section) => section.label)).toEqual([
      "Model",
      "Data providers",
      "Preferences",
      "Notifications & automation",
      "Diagnostics",
      "Data & privacy",
    ]);
    for (const slug of SETTINGS_SECTIONS) {
      expect(settingsSectionRegistry[slug].slug).toBe(slug);
      expect(typeof settingsSectionRegistry[slug].Component).toBe("function");
    }
  });
});

describe("SettingsPage", () => {
  it("renders the section rail in order with a link per section", () => {
    const html = render();

    expect(html).toContain('data-slot="settings-rail"');
    for (const section of settingsSectionList) {
      expect(html).toContain(`href="/settings/${section.slug}"`);
      expect(html).toContain(labelMarkup(section.label));
    }
    const order = settingsSectionList.map((section) => html.indexOf(labelMarkup(section.label)));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("marks the resolved section as the current one and renders its body", () => {
    const html = render({ section: "data" });

    expect(html).toContain('data-slot="settings-section" data-section="data"');
    expect(html).toMatch(/href="\/settings\/data"[^>]*aria-current="page"/);
    expect(html).not.toMatch(/href="\/settings\/model"[^>]*aria-current="page"/);
  });

  it("falls back to the first section when the slug is not one of ours", () => {
    const html = render({ section: "bogus" });

    expect(html).toContain('data-slot="settings-section" data-section="model"');
  });

  it("keeps the rail reachable at narrow widths without a page-wide sideways scroll", () => {
    const html = render();

    // One nav that is a scrollable strip above the content on phones and a
    // column beside it from md up.
    expect(html).toMatch(/data-slot="settings-rail"[^>]*class="[^"]*overflow-x-auto/);
    expect(html).toMatch(/data-slot="settings-rail"[^>]*class="[^"]*md:flex-col/);
    expect(html).toContain("min-w-0");
    expect(html).not.toContain("overflow-x-visible w-screen");
  });

  it("forwards data quality state to the section body", () => {
    const seen: Array<Record<string, unknown>> = [];
    const Section = (props: Record<string, unknown>) => {
      seen.push(props);
      return null;
    };
    const sections = [
      {
        slug: "diagnostics",
        label: "Diagnostics",
        icon: null,
        description: "",
        Component: Section,
      },
    ];
    render({
      section: "diagnostics",
      sections,
      dataQuality: { hardSkips: ["alpha_vantage"], softGaps: [] },
    });
    expect(seen.at(-1)?.dataQuality).toEqual({ hardSkips: ["alpha_vantage"], softGaps: [] });
  });

  it("renders every section body without throwing", () => {
    for (const slug of SETTINGS_SECTIONS) {
      const html = render({ section: slug });
      expect(html).toContain(`data-section="${slug}"`);
    }
  });
});
